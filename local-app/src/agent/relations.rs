//! Agent 关系网络
//!
//! agent-to-agent 关系（协作、监督、委派）
//! agent-to-human 关系（创建者、使用者）
//! 关系影响通信权限和工具共享

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// 关系类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum RelationType {
    /// 协作关系（双向）
    Collaborator,
    /// 监督关系（from 监督 to）
    Supervisor,
    /// 委派关系（from 委派任务给 to）
    Delegate,
    /// 创建者关系（human 创建了 agent）
    Creator,
    /// 使用者关系（human 使用 agent）
    User,
}

impl RelationType {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Collaborator => "collaborator",
            Self::Supervisor => "supervisor",
            Self::Delegate => "delegate",
            Self::Creator => "creator",
            Self::User => "user",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "collaborator" => Some(Self::Collaborator),
            "supervisor" => Some(Self::Supervisor),
            "delegate" => Some(Self::Delegate),
            "creator" => Some(Self::Creator),
            "user" => Some(Self::User),
            _ => None,
        }
    }
}

/// 关系记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRelation {
    pub id: String,
    /// 关系发起方（agent_id 或 "human"）
    pub from_id: String,
    /// 关系接收方（agent_id）
    pub to_id: String,
    /// 关系类型
    pub relation_type: String,
    /// 关系元数据（JSON）
    pub metadata: Option<String>,
    pub created_at: i64,
}

/// 关系管理器
pub struct RelationManager;

impl RelationManager {
    /// 创建关系
    pub async fn create(
        pool: &SqlitePool,
        from_id: &str,
        to_id: &str,
        relation_type: &RelationType,
        metadata: Option<&str>,
    ) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        sqlx::query(
            "INSERT INTO agent_relations (id, from_id, to_id, relation_type, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(from_id)
        .bind(to_id)
        .bind(relation_type.as_str())
        .bind(metadata)
        .bind(now)
        .execute(pool)
        .await
        .map_err(|e| format!("创建关系失败: {}", e))?;

        Ok(id)
    }

    /// 删除关系
    pub async fn delete(pool: &SqlitePool, relation_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM agent_relations WHERE id = ?")
            .bind(relation_id)
            .execute(pool)
            .await
            .map_err(|e| format!("删除关系失败: {}", e))?;
        Ok(())
    }

    /// 查询 Agent 的所有关系
    pub async fn get_relations(pool: &SqlitePool, agent_id: &str) -> Result<Vec<AgentRelation>, String> {
        let rows = sqlx::query_as::<_, (String, String, String, String, Option<String>, i64)>(
            "SELECT id, from_id, to_id, relation_type, metadata, created_at FROM agent_relations WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC"
        )
        .bind(agent_id)
        .bind(agent_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("查询关系失败: {}", e))?;

        Ok(rows.into_iter().map(|(id, from_id, to_id, relation_type, metadata, created_at)| {
            AgentRelation { id, from_id, to_id, relation_type, metadata, created_at }
        }).collect())
    }

    /// 检查两个 Agent 之间是否有特定关系
    pub async fn has_relation(
        pool: &SqlitePool,
        from_id: &str,
        to_id: &str,
        relation_type: &RelationType,
    ) -> Result<bool, String> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_relations WHERE from_id = ? AND to_id = ? AND relation_type = ?"
        )
        .bind(from_id)
        .bind(to_id)
        .bind(relation_type.as_str())
        .fetch_one(pool)
        .await
        .map_err(|e| format!("查询关系失败: {}", e))?;

        Ok(count.0 > 0)
    }

    /// 检查通信权限（基于关系）
    ///
    /// 仅允许 Collaborator/Supervisor/Delegate 类型通信
    pub async fn can_communicate(pool: &SqlitePool, from_id: &str, to_id: &str) -> Result<bool, String> {
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_relations WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) AND relation_type IN ('collaborator', 'supervisor', 'delegate')"
        )
        .bind(from_id)
        .bind(to_id)
        .bind(to_id)
        .bind(from_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("查询通信权限失败: {}", e))?;

        Ok(count.0 > 0)
    }
}
