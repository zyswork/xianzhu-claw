//! 数据库查询操作

use super::models::{Agent, Conversation, Memory, Vector};
use sqlx::SqlitePool;

/// 对话查询操作
pub struct ConversationQueries;

impl ConversationQueries {
    /// 保存对话记录
    pub async fn save(
        pool: &SqlitePool,
        conversation: &Conversation,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO conversations
            (id, agent_id, user_id, user_message, agent_response, created_at, updated_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&conversation.id)
        .bind(&conversation.agent_id)
        .bind(&conversation.user_id)
        .bind(&conversation.user_message)
        .bind(&conversation.agent_response)
        .bind(conversation.created_at)
        .bind(conversation.updated_at)
        .bind(&conversation.metadata)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 获取 Agent 的对话历史
    pub async fn get_by_agent(
        pool: &SqlitePool,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<Conversation>, sqlx::Error> {
        sqlx::query_as::<_, Conversation>(
            r#"
            SELECT * FROM conversations
            WHERE agent_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            "#,
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// 获取用户的对话历史
    pub async fn get_by_user(
        pool: &SqlitePool,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<Conversation>, sqlx::Error> {
        sqlx::query_as::<_, Conversation>(
            r#"
            SELECT * FROM conversations
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            "#,
        )
        .bind(user_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    }

    /// 删除对话记录
    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM conversations WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }
}

/// Agent 查询操作
pub struct AgentQueries;

impl AgentQueries {
    /// 保存 Agent 配置
    pub async fn save(pool: &SqlitePool, agent: &Agent) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO agents
            (id, name, system_prompt, model, temperature, max_tokens, created_at, updated_at, config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&agent.id)
        .bind(&agent.name)
        .bind(&agent.system_prompt)
        .bind(&agent.model)
        .bind(agent.temperature)
        .bind(agent.max_tokens)
        .bind(agent.created_at)
        .bind(agent.updated_at)
        .bind(&agent.config)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 获取 Agent 配置
    pub async fn get(pool: &SqlitePool, id: &str) -> Result<Option<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
    }

    /// 获取所有 Agent
    pub async fn get_all(pool: &SqlitePool) -> Result<Vec<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents ORDER BY created_at DESC")
            .fetch_all(pool)
            .await
    }

    /// 删除 Agent
    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }
}

/// 记忆体查询操作
pub struct MemoryQueries;

impl MemoryQueries {
    /// 保存记忆体
    pub async fn save(pool: &SqlitePool, memory: &Memory) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO memories
            (id, agent_id, memory_type, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&memory.id)
        .bind(&memory.agent_id)
        .bind(&memory.memory_type)
        .bind(&memory.content)
        .bind(memory.created_at)
        .bind(memory.updated_at)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 获取 Agent 的记忆体
    pub async fn get_by_agent(
        pool: &SqlitePool,
        agent_id: &str,
    ) -> Result<Vec<Memory>, sqlx::Error> {
        sqlx::query_as::<_, Memory>(
            "SELECT * FROM memories WHERE agent_id = ? ORDER BY created_at DESC",
        )
        .bind(agent_id)
        .fetch_all(pool)
        .await
    }

    /// 获取特定类型的记忆体
    pub async fn get_by_type(
        pool: &SqlitePool,
        agent_id: &str,
        memory_type: &str,
    ) -> Result<Vec<Memory>, sqlx::Error> {
        sqlx::query_as::<_, Memory>(
            "SELECT * FROM memories WHERE agent_id = ? AND memory_type = ? ORDER BY created_at DESC",
        )
        .bind(agent_id)
        .bind(memory_type)
        .fetch_all(pool)
        .await
    }

    /// 更新记忆体
    pub async fn update(pool: &SqlitePool, memory: &Memory) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&memory.content)
        .bind(memory.updated_at)
        .bind(&memory.id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 删除记忆体
    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM memories WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }
}

/// 向量查询操作
pub struct VectorQueries;

impl VectorQueries {
    /// 保存向量数据
    pub async fn save(pool: &SqlitePool, vector: &Vector) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO vectors
            (id, agent_id, content, embedding, created_at)
            VALUES (?, ?, ?, ?, ?)
            "#,
        )
        .bind(&vector.id)
        .bind(&vector.agent_id)
        .bind(&vector.content)
        .bind(&vector.embedding)
        .bind(vector.created_at)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// 获取 Agent 的所有向量
    pub async fn get_by_agent(
        pool: &SqlitePool,
        agent_id: &str,
    ) -> Result<Vec<Vector>, sqlx::Error> {
        sqlx::query_as::<_, Vector>(
            "SELECT * FROM vectors WHERE agent_id = ? ORDER BY created_at DESC",
        )
        .bind(agent_id)
        .fetch_all(pool)
        .await
    }

    /// 删除向量
    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM vectors WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?;

        Ok(())
    }
}
