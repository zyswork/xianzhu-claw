//! 自治等级策略
//!
//! per-action L1/L2/L3 策略映射
//! L1: 需用户确认
//! L2: 自主执行 + 通知用户
//! L3: 完全自主（静默执行）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 自治等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutonomyLevel {
    /// L1: 需要用户确认后才能执行
    L1Confirm,
    /// L2: 自主执行，但通知用户
    L2Notify,
    /// L3: 完全自主，静默执行
    L3Autonomous,
}

impl Default for AutonomyLevel {
    fn default() -> Self {
        Self::L1Confirm
    }
}

/// 操作类别
#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionCategory {
    /// 文件读取
    FileRead,
    /// 文件写入
    FileWrite,
    /// 文件删除
    FileDelete,
    /// Shell 命令执行
    ShellExec,
    /// 网络请求
    WebRequest,
    /// 记忆读取
    MemoryRead,
    /// 记忆写入
    MemoryWrite,
    /// Soul 文件修改
    SoulModify,
    /// MCP 工具调用
    McpToolCall,
    /// 子 Agent 派生
    SubagentSpawn,
    /// 消息发送（外部通道）
    ExternalMessage,
    /// 定时任务管理
    CronManage,
    /// 自定义操作
    Custom(String),
}

impl ActionCategory {
    /// 从工具名推断操作类别
    pub fn from_tool_name(tool_name: &str) -> Self {
        match tool_name {
            "file_read" | "file_list" | "code_search" => Self::FileRead,
            "file_write" | "file_edit" | "diff_edit" => Self::FileWrite,
            "bash_exec" => Self::ShellExec,
            "web_fetch" | "web_search" => Self::WebRequest,
            "memory_read" => Self::MemoryRead,
            "memory_write" => Self::MemoryWrite,
            "calculator" | "datetime" => Self::MemoryRead, // 安全操作归类为读取
            name if name.contains("agent_spawn") => Self::SubagentSpawn,
            name if name.contains("agent_send") => Self::ExternalMessage,
            name if name.contains("cron") => Self::CronManage,
            name if name.contains('.') => Self::McpToolCall,
            _ => Self::Custom(tool_name.to_string()),
        }
    }
}

/// 自治策略配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomyConfig {
    /// 默认自治等级
    #[serde(default)]
    pub default_level: AutonomyLevel,
    /// per-action 自治等级覆盖
    #[serde(default)]
    pub overrides: HashMap<String, AutonomyLevel>,
}

impl Default for AutonomyConfig {
    fn default() -> Self {
        Self {
            default_level: AutonomyLevel::L1Confirm,
            overrides: Self::conservative_defaults(),
        }
    }
}

impl AutonomyConfig {
    /// 保守默认策略
    ///
    /// 安全操作 L3，读取操作 L2，写入/执行操作 L1
    pub fn conservative_defaults() -> HashMap<String, AutonomyLevel> {
        let mut m = HashMap::new();
        // L3: 完全自主（安全操作）
        m.insert("calculator".to_string(), AutonomyLevel::L3Autonomous);
        m.insert("datetime".to_string(), AutonomyLevel::L3Autonomous);
        m.insert("memory_read".to_string(), AutonomyLevel::L3Autonomous);

        // L2: 自主 + 通知（读取操作）
        m.insert("file_read".to_string(), AutonomyLevel::L2Notify);
        m.insert("file_list".to_string(), AutonomyLevel::L2Notify);
        m.insert("code_search".to_string(), AutonomyLevel::L2Notify);
        m.insert("web_search".to_string(), AutonomyLevel::L2Notify);
        m.insert("web_fetch".to_string(), AutonomyLevel::L2Notify);

        // L1: 需确认（写入/执行操作）
        m.insert("file_write".to_string(), AutonomyLevel::L1Confirm);
        m.insert("file_edit".to_string(), AutonomyLevel::L1Confirm);
        m.insert("diff_edit".to_string(), AutonomyLevel::L1Confirm);
        m.insert("bash_exec".to_string(), AutonomyLevel::L1Confirm);
        m.insert("memory_write".to_string(), AutonomyLevel::L1Confirm);

        m
    }

    /// 获取工具的自治等级
    pub fn get_level(&self, tool_name: &str) -> AutonomyLevel {
        self.overrides.get(tool_name)
            .copied()
            .unwrap_or(self.default_level)
    }

    /// 设置工具的自治等级
    pub fn set_level(&mut self, tool_name: &str, level: AutonomyLevel) {
        self.overrides.insert(tool_name.to_string(), level);
    }
}

/// 自治决策结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutonomyDecision {
    pub level: AutonomyLevel,
    pub action: String,
    pub requires_confirmation: bool,
    pub should_notify: bool,
}

/// 评估工具调用的自治决策
pub fn evaluate_autonomy(
    config: &AutonomyConfig,
    tool_name: &str,
) -> AutonomyDecision {
    let level = config.get_level(tool_name);
    let category = ActionCategory::from_tool_name(tool_name);

    AutonomyDecision {
        level,
        action: format!("{:?}", category),
        requires_confirmation: matches!(level, AutonomyLevel::L1Confirm),
        should_notify: matches!(level, AutonomyLevel::L1Confirm | AutonomyLevel::L2Notify),
    }
}

/// 从 Agent config JSON 加载自治配置
pub fn load_autonomy_config(config_json: Option<&str>) -> AutonomyConfig {
    if let Some(json_str) = config_json {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(json_str) {
            if let Some(autonomy) = config.get("autonomy") {
                if let Ok(ac) = serde_json::from_value::<AutonomyConfig>(autonomy.clone()) {
                    return ac;
                }
            }
        }
    }
    AutonomyConfig::default()
}
