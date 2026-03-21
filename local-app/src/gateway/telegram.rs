//! Telegram Bot 集成

use super::message::{Channel, Message};
use serde::{Deserialize, Serialize};

/// Telegram 消息结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramUpdate {
    pub update_id: i64,
    pub message: Option<TelegramMessage>,
}

/// Telegram 消息详情
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramMessage {
    pub message_id: i64,
    pub from: TelegramUser,
    pub chat: TelegramChat,
    pub text: Option<String>,
    pub date: i64,
}

/// Telegram 用户信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramUser {
    pub id: i64,
    pub is_bot: bool,
    pub first_name: String,
    pub last_name: Option<String>,
    pub username: Option<String>,
}

/// Telegram 聊天信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramChat {
    pub id: i64,
    pub r#type: String,
    pub title: Option<String>,
}

/// Telegram Bot 处理器
pub struct TelegramHandler {
    token: String,
    client: reqwest::Client,
}

impl TelegramHandler {
    /// 创建新的 Telegram 处理器
    pub fn new(token: String) -> Self {
        Self {
            token,
            client: reqwest::Client::new(),
        }
    }

    /// 获取 API 基础 URL
    fn api_url(&self) -> String {
        format!("https://api.telegram.org/bot{}", self.token)
    }

    /// 发送消息到 Telegram
    pub async fn send_message(
        &self,
        chat_id: i64,
        text: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("{}/sendMessage", self.api_url());

        let params = serde_json::json!({
            "chat_id": chat_id,
            "text": text,
        });

        self.client
            .post(&url)
            .json(&params)
            .send()
            .await?;

        log::info!("Telegram 消息已发送到 chat_id: {}", chat_id);

        Ok(())
    }

    /// 获取更新
    pub async fn get_updates(&self, offset: Option<i64>) -> Result<Vec<TelegramUpdate>, Box<dyn std::error::Error>> {
        let url = format!("{}/getUpdates", self.api_url());

        let mut params = serde_json::json!({
            "timeout": 30,
        });

        if let Some(offset) = offset {
            params["offset"] = serde_json::json!(offset);
        }

        let response = self
            .client
            .post(&url)
            .json(&params)
            .send()
            .await?;

        let data: serde_json::Value = response.json().await?;

        if let Some(result) = data.get("result").and_then(|r| r.as_array()) {
            let updates: Vec<TelegramUpdate> = result
                .iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect();

            Ok(updates)
        } else {
            Ok(Vec::new())
        }
    }

    /// 将 Telegram 消息转换为规范化消息
    pub fn to_message(&self, update: &TelegramUpdate) -> Option<Message> {
        let msg = update.message.as_ref()?;
        let text = msg.text.as_ref()?;

        let sender_name = format!(
            "{}{}",
            msg.from.first_name,
            msg.from
                .last_name
                .as_ref()
                .map(|n| format!(" {}", n))
                .unwrap_or_default()
        );

        Some(Message::new(
            Channel::Telegram,
            msg.from.id.to_string(),
            sender_name,
            text.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telegram_handler_creation() {
        let handler = TelegramHandler::new("test_token".to_string());
        assert_eq!(handler.token, "test_token");
    }

    #[test]
    fn test_api_url() {
        let handler = TelegramHandler::new("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11".to_string());
        let url = handler.api_url();
        assert!(url.contains("api.telegram.org"));
        assert!(url.contains("bot"));
    }
}
