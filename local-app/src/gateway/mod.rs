//! 多通道网关模块
//!
//! 支持 Telegram 和飞书 Bot 集成
//! 提供统一的消息接口和路由

pub mod api;
pub mod feishu;
pub mod message;
pub mod telegram;

use async_trait::async_trait;
use message::Message;
use std::error::Error;

/// 通道处理器特征
#[async_trait]
pub trait ChannelHandler: Send + Sync {
    /// 发送消息
    async fn send_message(&self, message: &Message) -> Result<(), Box<dyn Error>>;

    /// 接收消息
    async fn receive_messages(&self) -> Result<Vec<Message>, Box<dyn Error>>;
}

/// 消息网关
pub struct MessageGateway {
    telegram: Option<telegram::TelegramHandler>,
    feishu: Option<feishu::FeishuHandler>,
}

impl MessageGateway {
    /// 创建��的消息网关
    pub fn new() -> Self {
        Self {
            telegram: None,
            feishu: None,
        }
    }

    /// 添加 Telegram 处理器
    pub fn with_telegram(mut self, token: String) -> Self {
        self.telegram = Some(telegram::TelegramHandler::new(token));
        self
    }

    /// 添加飞书处理器
    pub fn with_feishu(mut self, app_id: String, app_secret: String) -> Self {
        self.feishu = Some(feishu::FeishuHandler::new(app_id, app_secret));
        self
    }

    /// 发送消息到 Telegram
    pub async fn send_to_telegram(
        &self,
        chat_id: i64,
        text: &str,
    ) -> Result<(), Box<dyn Error>> {
        if let Some(handler) = &self.telegram {
            handler.send_message(chat_id, text).await?;
            Ok(())
        } else {
            Err("Telegram 处理器未初始化".into())
        }
    }

    /// 发送消息到飞书
    pub async fn send_to_feishu(
        &self,
        chat_id: &str,
        text: &str,
        token: &str,
    ) -> Result<(), Box<dyn Error>> {
        if let Some(handler) = &self.feishu {
            handler.send_message(chat_id, text, token).await?;
            Ok(())
        } else {
            Err("飞书处理器未初始化".into())
        }
    }

    /// 获取 Telegram 处理器
    pub fn telegram(&self) -> Option<&telegram::TelegramHandler> {
        self.telegram.as_ref()
    }

    /// 获取飞书处理器
    pub fn feishu(&self) -> Option<&feishu::FeishuHandler> {
        self.feishu.as_ref()
    }
}

impl Default for MessageGateway {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gateway_creation() {
        let gateway = MessageGateway::new();
        assert!(gateway.telegram().is_none());
        assert!(gateway.feishu().is_none());
    }

    #[test]
    fn test_gateway_with_telegram() {
        let gateway = MessageGateway::new().with_telegram("token".to_string());
        assert!(gateway.telegram().is_some());
    }

    #[test]
    fn test_gateway_with_feishu() {
        let gateway = MessageGateway::new().with_feishu("app_id".to_string(), "app_secret".to_string());
        assert!(gateway.feishu().is_some());
    }
}
