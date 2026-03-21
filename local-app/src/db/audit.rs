//! 工具调用审计日志
//!
//! 记录所有工具调用的 who/what/when/result/policy_decision

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// 审计日志条目
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct AuditLogEntry {
    pub id: String,
    pub agent_id: String,
    pub session_id: String,
    pub tool_name: String,
    pub arguments: String,
    pub result: Option<String>,
    pub success: bool,
    pub policy_decision: String,
    pub policy_source: String,
    pub duration_ms: i64,
    pub created_at: i64,
}

/// 写入审计日志
pub async fn log_tool_call(
    pool: &SqlitePool,
    agent_id: &str,
    session_id: &str,
    tool_name: &str,
    arguments: &str,
    result: Option<&str>,
    success: bool,
    policy_decision: &str,
    policy_source: &str,
    duration_ms: i64,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query(
        "INSERT INTO tool_audit_log (id, agent_id, session_id, tool_name, arguments, result, success, policy_decision, policy_source, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(agent_id)
    .bind(session_id)
    .bind(tool_name)
    .bind(arguments)
    .bind(result)
    .bind(success)
    .bind(policy_decision)
    .bind(policy_source)
    .bind(duration_ms)
    .bind(now)
    .execute(pool)
    .await
    .map_err(|e| format!("写入审计日志失败: {}", e))?;

    Ok(())
}

/// 查询审计日志
pub async fn query_audit_log(
    pool: &SqlitePool,
    agent_id: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditLogEntry>, String> {
    sqlx::query_as::<_, AuditLogEntry>(
        "SELECT id, agent_id, session_id, tool_name, arguments, result, success, policy_decision, policy_source, duration_ms, created_at FROM tool_audit_log WHERE agent_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    )
    .bind(agent_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("查询审计日志失败: {}", e))
}
