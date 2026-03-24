//! 工具策略引擎
//!
//! 实现 per-agent 工具访问控制，策略管道，决策可解释

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// 策略决策结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub reason: String,
    pub source: PolicySource,
}

/// 决策来源
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PolicySource {
    /// 全局默认策略
    GlobalDefault,
    /// Agent 级别策略
    AgentConfig,
    /// 会话级别覆盖
    SessionOverride,
    /// 安全级别限制
    SafetyLevel,
}

/// 工具策略配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolPolicyConfig {
    /// 允许的工具列表
    /// - 未配置 (allowlist_configured=false): 允许所有未被 deny 的
    /// - 已配置但为空 (allowlist_configured=true, allow 为空): deny-all（安全默认）
    /// - 已配置非空: 只允许列表中的工具
    #[serde(default)]
    pub allow: HashSet<String>,
    /// 拒绝的工具列表（优先级高于 allow）
    #[serde(default)]
    pub deny: HashSet<String>,
    /// 是否明确配置了白名单（区分"未配置"和"配置为空"）
    #[serde(default)]
    pub allowlist_configured: bool,
}

/// 策略引擎
pub struct ToolPolicyEngine {
    /// 全局默认策略
    global: ToolPolicyConfig,
    /// per-agent 策略缓存
    agent_policies: HashMap<String, ToolPolicyConfig>,
    /// 会话级别覆盖
    session_overrides: HashMap<String, ToolPolicyConfig>,
}

impl ToolPolicyEngine {
    pub fn new() -> Self {
        // 全局默认：deny 高危工具
        let mut global = ToolPolicyConfig::default();
        // 默认不 deny 任何工具，由 agent 级别控制
        global.deny = HashSet::new();

        Self {
            global,
            agent_policies: HashMap::new(),
            session_overrides: HashMap::new(),
        }
    }

    /// 设置 Agent 级别策略
    pub fn set_agent_policy(&mut self, agent_id: &str, policy: ToolPolicyConfig) {
        self.agent_policies.insert(agent_id.to_string(), policy);
    }

    /// 获取 Agent 策略
    pub fn get_agent_policy(&self, agent_id: &str) -> Option<&ToolPolicyConfig> {
        self.agent_policies.get(agent_id)
    }

    /// 设置会话级别覆盖
    pub fn set_session_override(&mut self, session_id: &str, policy: ToolPolicyConfig) {
        self.session_overrides.insert(session_id.to_string(), policy);
    }

    /// 清除会话覆盖
    pub fn clear_session_override(&mut self, session_id: &str) {
        self.session_overrides.remove(session_id);
    }

    /// 评估工具调用是否允许
    ///
    /// 策略管道：global defaults → agent config → session override
    /// 规则：deny 优先（任何层级的 deny 都会拒绝）
    pub fn evaluate(
        &self,
        agent_id: &str,
        session_id: Option<&str>,
        tool_name: &str,
        safety_level: &super::tools::ToolSafetyLevel,
    ) -> PolicyDecision {
        // 1. 安全级别检查：Approval 级别必须用户审批
        if matches!(safety_level, super::tools::ToolSafetyLevel::Approval) {
            return PolicyDecision {
                allowed: false,
                reason: format!("工具 {} 需要用户审批（安全级别: Approval）", tool_name),
                source: PolicySource::SafetyLevel,
            };
        }

        // 2. 全局 deny 检查
        if self.global.deny.contains(tool_name) {
            return PolicyDecision {
                allowed: false,
                reason: format!("工具 {} 被全局策略拒绝", tool_name),
                source: PolicySource::GlobalDefault,
            };
        }

        // 3. Agent 级别检查
        if let Some(agent_policy) = self.agent_policies.get(agent_id) {
            // deny 优先
            if agent_policy.deny.contains(tool_name) {
                return PolicyDecision {
                    allowed: false,
                    reason: format!("工具 {} 被 Agent 策略拒绝", tool_name),
                    source: PolicySource::AgentConfig,
                };
            }
            // 安全: 白名单已配置时严格执行（空白名单 = deny-all）
            if (agent_policy.allowlist_configured || !agent_policy.allow.is_empty()) && !agent_policy.allow.contains(tool_name) {
                return PolicyDecision {
                    allowed: false,
                    reason: format!("工具 {} 不在 Agent 允许列表中", tool_name),
                    source: PolicySource::AgentConfig,
                };
            }
        }

        // 4. 会话级别覆盖
        if let Some(session_id) = session_id {
            if let Some(session_policy) = self.session_overrides.get(session_id) {
                if session_policy.deny.contains(tool_name) {
                    return PolicyDecision {
                        allowed: false,
                        reason: format!("工具 {} 被会话策略拒绝", tool_name),
                        source: PolicySource::SessionOverride,
                    };
                }
            }
        }

        // 5. 全局 allow 检查
        if !self.global.allow.is_empty() && !self.global.allow.contains(tool_name) {
            return PolicyDecision {
                allowed: false,
                reason: format!("工具 {} 不在全局允许列表中", tool_name),
                source: PolicySource::GlobalDefault,
            };
        }

        // 默认允许
        PolicyDecision {
            allowed: true,
            reason: format!("工具 {} 通过策略检查", tool_name),
            source: PolicySource::GlobalDefault,
        }
    }

    /// 从数据库加载 Agent 策略
    pub async fn load_agent_policy(
        pool: &sqlx::SqlitePool,
        agent_id: &str,
    ) -> Result<Option<ToolPolicyConfig>, String> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT config FROM agents WHERE id = ?"
        )
        .bind(agent_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("查询 Agent 策略失败: {}", e))?;

        if let Some((Some(config_str),)) = row {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(&config_str) {
                if let Some(policy) = config.get("toolPolicy") {
                    let policy: ToolPolicyConfig = serde_json::from_value(policy.clone())
                        .map_err(|e| format!("解析工具策略失败: {}", e))?;
                    return Ok(Some(policy));
                }
            }
        }
        Ok(None)
    }
}
