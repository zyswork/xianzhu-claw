//! 渠道抽象层
//!
//! 参考 ZeroClaw 的 Channel trait：定义统一的消息收发接口。
//! 当前实现：Tauri（桌面端）。
//! 后续可扩展：Telegram、飞书、钉钉、API webhook 等。

use serde::{Deserialize, Serialize};

/// 入站消息（来自用户）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingMessage {
    /// 渠道 ID（如 "tauri", "telegram", "feishu"）
    pub channel_id: String,
    /// 发送者 ID
    pub sender_id: String,
    /// 会话 ID
    pub session_id: String,
    /// Agent ID
    pub agent_id: String,
    /// 消息内容
    pub content: String,
    /// 附件（图片 URL 等）
    pub attachments: Vec<String>,
    /// 元数据
    pub metadata: std::collections::HashMap<String, String>,
}

/// 出站消息（发给用户）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutgoingMessage {
    /// 目标渠道
    pub channel_id: String,
    /// 目标会话
    pub session_id: String,
    /// 消息内容
    pub content: String,
    /// 是否为流式 token（true = 增量，false = 完整消息）
    pub is_stream_token: bool,
}

/// 渠道 trait — 所有消息渠道必须实现
#[async_trait::async_trait]
pub trait Channel: Send + Sync {
    /// 渠道唯一标识
    fn id(&self) -> &str;

    /// 渠道显示名称
    fn display_name(&self) -> &str;

    /// 启动渠道（连接、监听）
    async fn start(&self) -> Result<(), String>;

    /// 停止渠道
    async fn stop(&self) -> Result<(), String>;

    /// 发送消息到渠道
    async fn send(&self, msg: OutgoingMessage) -> Result<(), String>;

    /// 渠道是否就绪
    fn is_ready(&self) -> bool;
}

/// Tauri 渠道实现（当前唯一的渠道）
///
/// 通过 Tauri event 系统收发消息。
/// 入站：前端 invoke → Tauri command → Orchestrator
/// 出站：Orchestrator → Tauri event → 前端
pub struct TauriChannel {
    ready: std::sync::atomic::AtomicBool,
}

impl TauriChannel {
    pub fn new() -> Self {
        Self {
            ready: std::sync::atomic::AtomicBool::new(true),
        }
    }
}

#[async_trait::async_trait]
impl Channel for TauriChannel {
    fn id(&self) -> &str { "tauri" }
    fn display_name(&self) -> &str { "桌面端" }

    async fn start(&self) -> Result<(), String> {
        self.ready.store(true, std::sync::atomic::Ordering::SeqCst);
        log::info!("Tauri 渠道已启动");
        Ok(())
    }

    async fn stop(&self) -> Result<(), String> {
        self.ready.store(false, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    async fn send(&self, _msg: OutgoingMessage) -> Result<(), String> {
        // Tauri 渠道的出站由前端直接通过 event 接收，不需要主动发送
        Ok(())
    }

    fn is_ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::SeqCst)
    }
}
