//! 响应缓存
//!
//! 缓存 LLM 响应，相同请求直接返回缓存结果。
//! 使用 SHA-256(model + system_prompt + messages_hash) 作为缓存 key。
//! SQLite 存储，TTL 1 小时，最多 1000 条，LRU 淘汰。

use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

/// 缓存 TTL（毫秒）：1 小时
const CACHE_TTL_MS: i64 = 3_600_000;
/// 最大缓存条目数
const MAX_CACHE_ENTRIES: i64 = 1000;

/// 响应缓存
pub struct ResponseCache {
    pool: SqlitePool,
}

impl ResponseCache {
    /// 创建响应缓存
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// 生成缓存 key
    ///
    /// SHA-256(model + system_prompt + messages_json)
    pub fn cache_key(model: &str, system_prompt: &str, messages: &[serde_json::Value]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(model.as_bytes());
        hasher.update(b"|");
        hasher.update(system_prompt.as_bytes());
        hasher.update(b"|");
        // 序列化消息（稳定排序）
        let messages_str = serde_json::to_string(messages).unwrap_or_default();
        hasher.update(messages_str.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// 查询缓存
    ///
    /// 如果缓存存在且未过期，更新 last_used_at 并返回缓存的响应
    pub async fn get(&self, cache_key: &str) -> Result<Option<String>, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let min_time = now - CACHE_TTL_MS;

        let row = sqlx::query_as::<_, (String,)>(
            "SELECT response FROM response_cache WHERE cache_key = ? AND created_at > ?"
        )
        .bind(cache_key)
        .bind(min_time)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("查询缓存失败: {}", e))?;

        if let Some((response,)) = row {
            // 更新使用时间和计数
            let _ = sqlx::query(
                "UPDATE response_cache SET last_used_at = ?, use_count = use_count + 1 WHERE cache_key = ?"
            )
            .bind(now)
            .bind(cache_key)
            .execute(&self.pool)
            .await;

            log::debug!("响应缓存命中: key={}", &cache_key[..16]);
            Ok(Some(response))
        } else {
            Ok(None)
        }
    }

    /// 写入缓存
    pub async fn put(&self, cache_key: &str, model: &str, response: &str) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();

        // UPSERT
        sqlx::query(
            r#"
            INSERT INTO response_cache (cache_key, model, response, created_at, last_used_at, use_count)
            VALUES (?, ?, ?, ?, ?, 1)
            ON CONFLICT(cache_key) DO UPDATE SET
                response = excluded.response,
                created_at = excluded.created_at,
                last_used_at = excluded.last_used_at,
                use_count = use_count + 1
            "#
        )
        .bind(cache_key)
        .bind(model)
        .bind(response)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| format!("写入缓存失败: {}", e))?;

        // LRU 淘汰：超过最大条目数时删除最旧的
        let _ = self.evict().await;

        Ok(())
    }

    /// LRU 淘汰
    async fn evict(&self) -> Result<(), String> {
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM response_cache")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| format!("查询缓存数量失败: {}", e))?;

        if count.0 > MAX_CACHE_ENTRIES {
            let to_delete = count.0 - MAX_CACHE_ENTRIES;
            sqlx::query(
                "DELETE FROM response_cache WHERE cache_key IN (SELECT cache_key FROM response_cache ORDER BY last_used_at ASC LIMIT ?)"
            )
            .bind(to_delete)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("淘汰缓存失败: {}", e))?;

            log::info!("已淘汰 {} 条过期缓存", to_delete);
        }

        Ok(())
    }

    /// 清除所有缓存
    pub async fn clear(&self) -> Result<(), String> {
        sqlx::query("DELETE FROM response_cache")
            .execute(&self.pool)
            .await
            .map_err(|e| format!("清除缓存失败: {}", e))?;
        Ok(())
    }

    /// 清除过期缓存
    pub async fn cleanup_expired(&self) -> Result<u64, String> {
        let now = chrono::Utc::now().timestamp_millis();
        let min_time = now - CACHE_TTL_MS;

        let result = sqlx::query("DELETE FROM response_cache WHERE created_at < ?")
            .bind(min_time)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("清理过期缓存失败: {}", e))?;

        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> ResponseCache {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::schema::init_schema(&pool).await.unwrap();
        ResponseCache::new(pool)
    }

    #[test]
    fn test_cache_key_deterministic() {
        let key1 = ResponseCache::cache_key("gpt-4", "system", &[serde_json::json!({"role": "user", "content": "hello"})]);
        let key2 = ResponseCache::cache_key("gpt-4", "system", &[serde_json::json!({"role": "user", "content": "hello"})]);
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_cache_key_different_inputs() {
        let key1 = ResponseCache::cache_key("gpt-4", "system", &[serde_json::json!({"role": "user", "content": "hello"})]);
        let key2 = ResponseCache::cache_key("gpt-4", "system", &[serde_json::json!({"role": "user", "content": "world"})]);
        assert_ne!(key1, key2);
    }

    #[tokio::test]
    async fn test_cache_put_and_get() {
        let cache = setup().await;

        let key = "test_key_123";
        cache.put(key, "gpt-4", "Hello response").await.unwrap();

        let result = cache.get(key).await.unwrap();
        assert_eq!(result, Some("Hello response".to_string()));
    }

    #[tokio::test]
    async fn test_cache_miss() {
        let cache = setup().await;
        let result = cache.get("nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_cache_clear() {
        let cache = setup().await;
        cache.put("k1", "gpt-4", "r1").await.unwrap();
        cache.put("k2", "gpt-4", "r2").await.unwrap();

        cache.clear().await.unwrap();

        assert!(cache.get("k1").await.unwrap().is_none());
        assert!(cache.get("k2").await.unwrap().is_none());
    }
}
