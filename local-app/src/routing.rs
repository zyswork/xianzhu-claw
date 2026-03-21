//! 多 Agent 路由
//!
//! 参考 OpenClaw 的 routing 模块：根据渠道、发送者、群组选择 Agent。
//! 桌面端（Tauri）由用户直接选择 Agent，不需要路由。
//! 外部渠道（API/Telegram/飞书）通过路由规则自动选择。

use sqlx::SqlitePool;

/// 路由绑定规则
#[derive(Debug, Clone)]
pub struct AgentBinding {
    /// 渠道 ID（"api", "telegram", "feishu", "*" = 所有渠道）
    pub channel: String,
    /// 发送者 ID（可选，None = 匹配所有发送者）
    pub sender_id: Option<String>,
    /// 绑定的 Agent ID
    pub agent_id: String,
    /// 优先级（越小越优先）
    pub priority: i32,
}

/// 路由解析结果
#[derive(Debug, Clone)]
pub struct ResolvedRoute {
    pub agent_id: String,
    pub match_rule: String,
}

/// 路由器
pub struct Router {
    pool: SqlitePool,
    /// 默认 Agent ID（如果没有匹配到任何规则）
    default_agent_id: Option<String>,
}

impl Router {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool, default_agent_id: None }
    }

    pub fn with_default_agent(mut self, agent_id: &str) -> Self {
        self.default_agent_id = Some(agent_id.to_string());
        self
    }

    /// 解析路由：给定渠道和发送者，返回应处理的 Agent ID
    pub async fn resolve(
        &self,
        channel: &str,
        sender_id: Option<&str>,
    ) -> Result<ResolvedRoute, String> {
        // 1. 精确匹配：channel + sender_id
        if let Some(sid) = sender_id {
            if let Some(binding) = self.find_binding(channel, Some(sid)).await? {
                return Ok(ResolvedRoute {
                    agent_id: binding.agent_id,
                    match_rule: format!("channel={} sender={}", channel, sid),
                });
            }
        }

        // 2. 渠道匹配：channel + any sender
        if let Some(binding) = self.find_binding(channel, None).await? {
            return Ok(ResolvedRoute {
                agent_id: binding.agent_id,
                match_rule: format!("channel={}", channel),
            });
        }

        // 3. 通配匹配：* + any sender
        if let Some(binding) = self.find_binding("*", None).await? {
            return Ok(ResolvedRoute {
                agent_id: binding.agent_id,
                match_rule: "wildcard".to_string(),
            });
        }

        // 4. 默认 Agent
        if let Some(ref default_id) = self.default_agent_id {
            return Ok(ResolvedRoute {
                agent_id: default_id.clone(),
                match_rule: "default".to_string(),
            });
        }

        // 5. 查找第一个 Agent 作为兜底
        let first: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM agents ORDER BY created_at ASC LIMIT 1"
        ).fetch_optional(&self.pool).await.map_err(|e| format!("查询失败: {}", e))?;

        match first {
            Some((id,)) => Ok(ResolvedRoute {
                agent_id: id,
                match_rule: "first_agent_fallback".to_string(),
            }),
            None => Err("没有可用的 Agent".to_string()),
        }
    }

    async fn find_binding(&self, channel: &str, sender_id: Option<&str>) -> Result<Option<AgentBinding>, String> {
        let row = if let Some(sid) = sender_id {
            sqlx::query_as::<_, (String, String, Option<String>, i32)>(
                "SELECT channel, agent_id, sender_id, priority FROM agent_bindings WHERE channel = ? AND sender_id = ? ORDER BY priority ASC LIMIT 1"
            ).bind(channel).bind(sid).fetch_optional(&self.pool).await
        } else {
            sqlx::query_as::<_, (String, String, Option<String>, i32)>(
                "SELECT channel, agent_id, sender_id, priority FROM agent_bindings WHERE channel = ? AND sender_id IS NULL ORDER BY priority ASC LIMIT 1"
            ).bind(channel).fetch_optional(&self.pool).await
        }.map_err(|e| format!("查询路由失败: {}", e))?;

        Ok(row.map(|(channel, agent_id, sender_id, priority)| AgentBinding {
            channel, agent_id, sender_id, priority,
        }))
    }
}
