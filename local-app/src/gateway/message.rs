//! 消息规范化定义
//!
//! 三种消息类型：
//! - IncomingMessage：用户发来的消息（从 Gateway 通道接收）
//! - OutgoingResponse：AI 回复（发送到 Gateway 通道）
//! - StatusUpdate：状态通知（打字中、处理中等）

use serde::{Deserialize, Serialize};

/// 通道类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Channel {
    /// Telegram 通道
    Telegram,
    /// 飞书通道
    Feishu,
}

impl std::fmt::Display for Channel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Channel::Telegram => write!(f, "telegram"),
            Channel::Feishu => write!(f, "feishu"),
        }
    }
}

/// 用户发来的消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingMessage {
    /// 消息唯一标识
    pub id: String,
    /// 消息来源通道
    pub channel: Channel,
    /// 发送者 ID
    pub sender_id: String,
    /// 发送者名称
    pub sender_name: String,
    /// 消息内容
    pub content: String,
    /// 消息时间戳（毫秒）
    pub timestamp: i64,
    /// 目标 Agent ID
    pub agent_id: Option<String>,
    /// 消息元数据
    pub metadata: Option<serde_json::Value>,
}

impl IncomingMessage {
    /// 创建新的入站消息
    pub fn new(
        channel: Channel,
        sender_id: String,
        sender_name: String,
        content: String,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            channel,
            sender_id,
            sender_name,
            content,
            timestamp: chrono::Utc::now().timestamp_millis(),
            agent_id: None,
            metadata: None,
        }
    }

    /// 指定目标 Agent
    pub fn with_agent(mut self, agent_id: String) -> Self {
        self.agent_id = Some(agent_id);
        self
    }

    /// 添加元数据
    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// AI 回复消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutgoingResponse {
    /// 消息唯一标��
    pub id: String,
    /// 目标通道
    pub channel: Channel,
    /// 回复内容
    pub content: String,
    /// 关联的入站消息 ID
    pub reply_to: Option<String>,
    /// 消息时间戳（毫秒）
    pub timestamp: i64,
    /// 使用的 token 数
    pub tokens_used: Option<usize>,
    /// 消息元数据
    pub metadata: Option<serde_json::Value>,
}

impl OutgoingResponse {
    /// 创建回复消息
    pub fn new(channel: Channel, content: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            channel,
            content,
            reply_to: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
            tokens_used: None,
            metadata: None,
        }
    }

    /// 关联入站消息
    pub fn reply_to(mut self, message_id: String) -> Self {
        self.reply_to = Some(message_id);
        self
    }

    /// 记录 token 使用量
    pub fn with_tokens(mut self, tokens: usize) -> Self {
        self.tokens_used = Some(tokens);
        self
    }
}

/// 状态类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StatusKind {
    /// 正在输入
    Typing,
    /// 正在处理
    Processing,
    /// 处理完成
    Done,
    /// 发生错误
    Error,
    /// 工具调用开始
    ToolStarted,
    /// 工具调用完成
    ToolCompleted,
}

/// 状态更新通知
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusUpdate {
    /// 目标通道
    pub channel: Channel,
    /// 状态类型
    pub kind: StatusKind,
    /// 状态描述
    pub message: Option<String>,
    /// 时间戳（毫秒）
    pub timestamp: i64,
}

impl StatusUpdate {
    /// 创建状态更新
    pub fn new(channel: Channel, kind: StatusKind) -> Self {
        Self {
            channel,
            kind,
            message: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// 添加状态描述
    pub fn with_message(mut self, message: String) -> Self {
        self.message = Some(message);
        self
    }
}

/// 规范化消息格式（向后兼容别名）
pub type Message = IncomingMessage;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_creation() {
        let msg = Message::new(
            Channel::Telegram,
            "user123".to_string(),
            "Alice".to_string(),
            "Hello".to_string(),
        );

        assert_eq!(msg.channel, Channel::Telegram);
        assert_eq!(msg.sender_id, "user123");
        assert_eq!(msg.content, "Hello");
    }

    #[test]
    fn test_incoming_with_agent() {
        let msg = IncomingMessage::new(
            Channel::Feishu,
            "u1".to_string(),
            "Bob".to_string(),
            "Hi".to_string(),
        )
        .with_agent("agent-001".to_string());

        assert_eq!(msg.agent_id, Some("agent-001".to_string()));
    }

    #[test]
    fn test_outgoing_response() {
        let resp = OutgoingResponse::new(Channel::Telegram, "Hello!".to_string())
            .reply_to("msg-123".to_string())
            .with_tokens(150);

        assert_eq!(resp.content, "Hello!");
        assert_eq!(resp.reply_to, Some("msg-123".to_string()));
        assert_eq!(resp.tokens_used, Some(150));
    }

    #[test]
    fn test_status_update() {
        let status = StatusUpdate::new(Channel::Feishu, StatusKind::Typing)
            .with_message("正在思考...".to_string());

        assert_eq!(status.kind, StatusKind::Typing);
        assert_eq!(status.message, Some("正在思考...".to_string()));
    }
}
