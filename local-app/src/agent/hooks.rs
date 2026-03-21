//! 工具执行钩子系统
//!
//! 在工具执行前后触发回调，支持日志、审计、修改参数等扩展。
//! 借鉴 ZeroClaw 的 HookRunner 设计。

use async_trait::async_trait;

/// 钩子事件类型
#[derive(Debug, Clone)]
pub enum HookEvent {
    /// 工具执行前
    BeforeToolCall {
        tool_name: String,
        arguments: serde_json::Value,
        agent_id: String,
        session_id: String,
    },
    /// 工具执行后
    AfterToolCall {
        tool_name: String,
        arguments: serde_json::Value,
        result: String,
        success: bool,
        duration_ms: i64,
        agent_id: String,
        session_id: String,
    },
    /// LLM 调用前
    BeforeLlmCall {
        model: String,
        message_count: usize,
        agent_id: String,
    },
    /// LLM 调用后
    AfterLlmCall {
        model: String,
        content_len: usize,
        tool_call_count: usize,
        usage: Option<(u64, u64)>, // (input, output)
        agent_id: String,
    },
}

/// 钩子处理器 trait
#[async_trait]
pub trait Hook: Send + Sync {
    /// 钩子名称
    fn name(&self) -> &str;

    /// 处理事件（返回 false 可阻止后续执行，仅 Before* 事件生效）
    async fn handle(&self, event: &HookEvent) -> bool;
}

/// 钩子运行器
pub struct HookRunner {
    hooks: Vec<Box<dyn Hook>>,
}

impl HookRunner {
    pub fn new() -> Self {
        Self { hooks: Vec::new() }
    }

    /// 注册钩子
    pub fn register(&mut self, hook: Box<dyn Hook>) {
        log::info!("注册工具钩子: {}", hook.name());
        self.hooks.push(hook);
    }

    /// 触发事件（Before 事件返回 false 表示阻止执行）
    pub async fn emit(&self, event: &HookEvent) -> bool {
        for hook in &self.hooks {
            if !hook.handle(event).await {
                log::warn!("钩子 {} 阻止了事件: {:?}", hook.name(), std::mem::discriminant(event));
                return false;
            }
        }
        true
    }

    /// 是否有注册的钩子
    pub fn has_hooks(&self) -> bool {
        !self.hooks.is_empty()
    }
}

/// 内置日志钩子：记录所有工具调用
pub struct LoggingHook;

#[async_trait]
impl Hook for LoggingHook {
    fn name(&self) -> &str { "logging" }

    async fn handle(&self, event: &HookEvent) -> bool {
        match event {
            HookEvent::BeforeToolCall { tool_name, agent_id, .. } => {
                log::info!("[Hook] 工具调用开始: {} (agent={})", tool_name, agent_id);
            }
            HookEvent::AfterToolCall { tool_name, success, duration_ms, .. } => {
                log::info!("[Hook] 工具调用完成: {} success={} {}ms", tool_name, success, duration_ms);
            }
            HookEvent::AfterLlmCall { model, content_len, usage, .. } => {
                let usage_str = usage.map(|(i, o)| format!("{}+{}", i, o)).unwrap_or("n/a".into());
                log::info!("[Hook] LLM 调用完成: model={} content={} usage={}", model, content_len, usage_str);
            }
            _ => {}
        }
        true // 不阻止
    }
}
