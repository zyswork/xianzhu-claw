//! 智能记忆淘汰
//!
//! 基于多维度评分决定哪些记忆应该被淘汰：
//! - 优先级（priority）
//! - 访问频率（access_count）
//! - 新鲜度（last_accessed / created_at）
//! - 语义去重（相似记忆合并）

use sqlx::SqlitePool;

/// 记忆淘汰配置
pub struct EvictionConfig {
    /// 最大记忆条数
    pub max_memories: usize,
    /// 过期天数（超过此天数的低优先级记忆可被淘汰）
    pub stale_days: i64,
    /// 相似度阈值（超过此值的记忆视为重复）
    pub similarity_threshold: f64,
}

impl Default for EvictionConfig {
    fn default() -> Self {
        Self {
            max_memories: 500,
            stale_days: 30,
            similarity_threshold: 0.85,
        }
    }
}

/// 记忆评分（分数越低越该淘汰）
#[derive(Debug)]
struct MemoryScore {
    id: String,
    content_prefix: String,
    priority: i64,
    access_count: i64,
    age_days: f64,
    /// 综合评分（0.0-1.0）
    score: f64,
}

/// 执行智能淘汰
///
/// 返回被淘汰的记忆数量
pub async fn run_eviction(pool: &SqlitePool, agent_id: &str, config: &EvictionConfig) -> usize {
    // 1. 加载所有记忆的元数据
    let memories: Vec<(String, String, i64, i64, i64)> = sqlx::query_as(
        "SELECT id, substr(content, 1, 100), COALESCE(priority, 1), COALESCE(access_count, 0), created_at FROM memories WHERE agent_id = ? ORDER BY created_at DESC"
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if memories.len() <= config.max_memories {
        return 0; // 未超限，不需要淘汰
    }

    let now = chrono::Utc::now().timestamp_millis();
    let day_ms = 86_400_000i64;

    // 2. 计算每条记忆的综合评分
    let mut scored: Vec<MemoryScore> = memories.iter().map(|(id, content, priority, access_count, created_at)| {
        let age_days = (now - created_at) as f64 / day_ms as f64;

        // 评分公式：
        // - 优先级权重 40%（Critical=3 → 1.0, Low=0 → 0.0）
        // - 新鲜度权重 30%（0天=1.0, 30天=0.5, 90天=0.1）
        // - 访问频率权重 30%（10次=1.0, 0次=0.0）
        let priority_score = (*priority as f64 / 3.0).min(1.0);
        let freshness_score = (1.0 / (1.0 + age_days / 30.0)).max(0.0);
        let access_score = ((*access_count as f64).ln_1p() / 10.0f64.ln_1p()).min(1.0);

        let score = priority_score * 0.4 + freshness_score * 0.3 + access_score * 0.3;

        MemoryScore {
            id: id.clone(),
            content_prefix: content.clone(),
            priority: *priority,
            access_count: *access_count,
            age_days,
            score,
        }
    }).collect();

    // 3. 按评分排序（最低分在前 → 最该淘汰）
    scored.sort_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal));

    // 4. 语义去重：相似前缀的记忆只保留评分最高的
    let mut to_remove: Vec<String> = Vec::new();
    let mut seen_prefixes: Vec<String> = Vec::new();

    for mem in &scored {
        // 简化的相似度检测：前 50 字符匹配
        let prefix: String = mem.content_prefix.chars().take(50).collect();
        let is_dup = seen_prefixes.iter().any(|sp| {
            jaccard_similarity(sp, &prefix) > config.similarity_threshold
        });

        if is_dup {
            to_remove.push(mem.id.clone());
            log::info!("memory_eviction: 去重删除 {} (score={:.2}, prefix={})", &mem.id[..8], mem.score, &prefix[..prefix.len().min(30)]);
        } else {
            seen_prefixes.push(prefix);
        }
    }

    // 5. 淘汰低分记忆直到数量低于上限
    let need_remove = (memories.len() - config.max_memories).saturating_sub(to_remove.len());
    for mem in scored.iter().take(need_remove) {
        if !to_remove.contains(&mem.id) {
            // 不淘汰 Critical 优先级的记忆
            if mem.priority >= 3 { continue; }
            to_remove.push(mem.id.clone());
            log::info!("memory_eviction: 淘汰 {} (score={:.2}, age={:.0}d, access={})", &mem.id[..8], mem.score, mem.age_days, mem.access_count);
        }
    }

    // 6. 执行删除
    let removed = to_remove.len();
    for id in &to_remove {
        let _ = sqlx::query("DELETE FROM memories WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await;
    }

    if removed > 0 {
        log::info!("memory_eviction: Agent {} 淘汰了 {} 条记忆（总量 {} → {}）", &agent_id[..8], removed, memories.len(), memories.len() - removed);
    }

    removed
}

/// 更新记忆访问计数（recall 时调用）
pub async fn touch_memory(pool: &SqlitePool, memory_id: &str) {
    let _ = sqlx::query(
        "UPDATE memories SET access_count = COALESCE(access_count, 0) + 1, last_accessed = ? WHERE id = ?"
    )
    .bind(chrono::Utc::now().timestamp_millis())
    .bind(memory_id)
    .execute(pool)
    .await;
}

/// 简单的 Jaccard 相似度（字符级 bigram）
fn jaccard_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() { return 0.0; }
    let bigrams_a: std::collections::HashSet<(char, char)> = a.chars().zip(a.chars().skip(1)).collect();
    let bigrams_b: std::collections::HashSet<(char, char)> = b.chars().zip(b.chars().skip(1)).collect();
    let intersection = bigrams_a.intersection(&bigrams_b).count();
    let union = bigrams_a.union(&bigrams_b).count();
    if union == 0 { 0.0 } else { intersection as f64 / union as f64 }
}

/// 确保 DB schema 有 access_count 和 last_accessed 列
pub async fn ensure_schema(pool: &SqlitePool) {
    // 安全添加列（如果不存在）
    let _ = sqlx::query("ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE memories ADD COLUMN last_accessed INTEGER")
        .execute(pool).await;
}
