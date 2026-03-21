//! Agent 长期记忆（soul.md + memory.md）

use sqlx::{SqlitePool, Row};

/// 记忆体类型
pub const MEMORY_TYPE_SOUL: &str = "soul";
pub const MEMORY_TYPE_MEMORY: &str = "memory";
pub const MEMORY_TYPE_KNOWLEDGE: &str = "knowledge";

/// 保存记忆体
pub async fn save_memory(
    pool: &SqlitePool,
    agent_id: &str,
    memory_type: &str,
    content: &str,
) -> Result<(), sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        r#"
        INSERT INTO memories
        (id, agent_id, memory_type, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&id)
    .bind(agent_id)
    .bind(memory_type)
    .bind(content)
    .bind(now)
    .bind(now)
    .execute(pool)
    .await?;

    log::info!(
        "记忆体已保存: agent_id={}, type={}, memory_id={}",
        agent_id,
        memory_type,
        id
    );

    Ok(())
}

/// 获取记忆体
pub async fn get_memory(
    pool: &SqlitePool,
    agent_id: &str,
    memory_type: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT content
        FROM memories
        WHERE agent_id = ? AND memory_type = ?
        ORDER BY created_at DESC
        "#,
    )
    .bind(agent_id)
    .bind(memory_type)
    .fetch_all(pool)
    .await?;

    let memories = rows.into_iter().map(|row| row.get(0)).collect();

    Ok(memories)
}

/// 更新记忆体
pub async fn update_memory(
    pool: &SqlitePool,
    memory_id: &str,
    content: &str,
) -> Result<(), sqlx::Error> {
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
    )
    .bind(content)
    .bind(now)
    .bind(memory_id)
    .execute(pool)
    .await?;

    log::info!("记忆体已更新: memory_id={}", memory_id);

    Ok(())
}

/// 获取 Soul 记忆体
pub async fn get_soul(pool: &SqlitePool, agent_id: &str) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT content
        FROM memories
        WHERE agent_id = ? AND memory_type = ?
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(agent_id)
    .bind(MEMORY_TYPE_SOUL)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.get(0)))
}

/// 保存 Soul 记忆体
pub async fn save_soul(
    pool: &SqlitePool,
    agent_id: &str,
    soul_content: &str,
) -> Result<(), sqlx::Error> {
    save_memory(pool, agent_id, MEMORY_TYPE_SOUL, soul_content).await
}

/// 获取 Memory 记忆体
pub async fn get_memories(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    get_memory(pool, agent_id, MEMORY_TYPE_MEMORY).await
}

/// 保存 Memory 记忆体
pub async fn save_memory_entry(
    pool: &SqlitePool,
    agent_id: &str,
    memory_content: &str,
) -> Result<(), sqlx::Error> {
    save_memory(pool, agent_id, MEMORY_TYPE_MEMORY, memory_content).await
}

/// 获取知识库
pub async fn get_knowledge(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<Vec<String>, sqlx::Error> {
    get_memory(pool, agent_id, MEMORY_TYPE_KNOWLEDGE).await
}

/// 保存知识库条目
pub async fn save_knowledge_entry(
    pool: &SqlitePool,
    agent_id: &str,
    knowledge_content: &str,
) -> Result<(), sqlx::Error> {
    save_memory(pool, agent_id, MEMORY_TYPE_KNOWLEDGE, knowledge_content).await
}

/// 删除记忆体
pub async fn delete_memory(pool: &SqlitePool, memory_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM memories WHERE id = ?")
        .bind(memory_id)
        .execute(pool)
        .await?;

    log::info!("记忆体已删除: memory_id={}", memory_id);

    Ok(())
}

/// 清空 Agent 的所有记忆体
pub async fn clear_agent_memories(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM memories WHERE agent_id = ?")
        .bind(agent_id)
        .execute(pool)
        .await?;

    log::info!("Agent 的所有记忆体已清空: agent_id={}", agent_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_memory_operations() {
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

        // 保存 Soul
        let result = save_soul(&pool, "agent1", "I am a helpful assistant").await;
        assert!(result.is_ok());

        // 获取 Soul
        let soul = get_soul(&pool, "agent1").await.unwrap();
        assert!(soul.is_some());
    }
}
