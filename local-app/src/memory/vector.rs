//! 向量化和语义搜索

use sqlx::{SqlitePool, Row};

/// 保存向量
pub async fn save_vector(
    pool: &SqlitePool,
    agent_id: &str,
    content: &str,
    embedding: Vec<u8>,
) -> Result<(), sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO vectors
        (id, agent_id, content, embedding, created_at)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(agent_id)
    .bind(content)
    .bind(&embedding)
    .bind(now)
    .execute(pool)
    .await?;

    log::info!(
        "向量已保存: agent_id={}, vector_id={}, embedding_size={}",
        agent_id,
        id,
        embedding.len()
    );

    Ok(())
}

/// 搜索向量
pub async fn search_vectors(
    pool: &SqlitePool,
    agent_id: &str,
    limit: i64,
) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT content
        FROM vectors
        WHERE agent_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        "#,
    )
    .bind(agent_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let results = rows.into_iter().map(|row| row.get(0)).collect();

    Ok(results)
}

/// 获取向量
pub async fn get_vector(
    pool: &SqlitePool,
    vector_id: &str,
) -> Result<Option<(String, Vec<u8>)>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT content, embedding FROM vectors WHERE id = ?",
    )
    .bind(vector_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        let content: String = r.get(0);
        let embedding: Vec<u8> = r.get(1);
        (content, embedding)
    }))
}

/// 删除向量
pub async fn delete_vector(pool: &SqlitePool, vector_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM vectors WHERE id = ?")
        .bind(vector_id)
        .execute(pool)
        .await?;

    log::info!("向量已删除: vector_id={}", vector_id);

    Ok(())
}

/// 清空 Agent 的所有向量
pub async fn clear_agent_vectors(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM vectors WHERE agent_id = ?")
        .bind(agent_id)
        .execute(pool)
        .await?;

    log::info!("Agent 的所有向量已清空: agent_id={}", agent_id);

    Ok(())
}

/// 混合搜索：关键词 + 向量相似度
///
/// 如果提供了 query_embedding，使用余弦相似度排序
/// 否则回退到关键词 LIKE 搜索
pub async fn hybrid_search(
    pool: &SqlitePool,
    agent_id: &str,
    keyword: &str,
    query_embedding: Option<&[f32]>,
    limit: i64,
) -> Result<Vec<(String, String, f32)>, String> {
    // 获取候选向量
    let rows = sqlx::query_as::<_, (String, String, Vec<u8>)>(
        "SELECT id, content, embedding FROM vectors WHERE agent_id = ? ORDER BY created_at DESC LIMIT 200"
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("向量搜索失败: {}", e))?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // 如果有 query embedding，使用余弦相似度
    if let Some(query_emb) = query_embedding {
        let mut scored: Vec<(String, String, f32)> = rows.into_iter()
            .map(|(id, content, emb_bytes)| {
                let emb = super::embedding::bytes_to_embedding(&emb_bytes);
                let score = super::embedding::cosine_similarity(query_emb, &emb);
                (id, content, score)
            })
            .collect();

        // 按相似度降序排序
        scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit as usize);
        return Ok(scored);
    }

    // 回退：关键词搜索（转义 LIKE 通配符）
    let escaped_keyword = keyword.replace('%', "\\%").replace('_', "\\_");
    let keyword_rows = sqlx::query_as::<_, (String, String)>(
        "SELECT id, content FROM vectors WHERE agent_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?"
    )
    .bind(agent_id)
    .bind(format!("%{}%", escaped_keyword))
    .bind(limit)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("关键词搜索失败: {}", e))?;

    Ok(keyword_rows.into_iter().map(|(id, content)| (id, content, 1.0)).collect())
}

/// 获取向量统计信息
pub async fn get_vector_stats(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<(i64, i64), sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT COUNT(*), SUM(LENGTH(embedding))
        FROM vectors
        WHERE agent_id = ?
        "#,
    )
    .bind(agent_id)
    .fetch_one(pool)
    .await?;

    let count: i64 = row.get(0);
    let total_size: Option<i64> = row.get(1);

    Ok((count, total_size.unwrap_or(0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_vector_operations() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();

        crate::db::schema::init_schema(&pool).await.unwrap();

        // 创建测试用 Agent 记录（满足外键约束）
        let now = chrono::Utc::now().timestamp_millis();
        sqlx::query(
            "INSERT INTO agents (id, name, system_prompt, model, temperature, max_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind("agent1").bind("test").bind("prompt").bind("gpt-4").bind(0.7).bind(2048).bind(now).bind(now)
        .execute(&pool).await.unwrap();

        // 保存向量
        let embedding = vec![1, 2, 3, 4, 5];
        let result = save_vector(&pool, "agent1", "test content", embedding).await;
        assert!(result.is_ok());

        // 搜索向量
        let results = search_vectors(&pool, "agent1", 10).await.unwrap();
        assert_eq!(results.len(), 1);
    }
}
