//! 飞书 Bot 集成

use super::message::{Channel, Message};
use serde::{Deserialize, Serialize};

/// 飞书消息事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuEvent {
    pub token: String,
    pub ts: String,
    pub uuid: String,
    pub event: FeishuEventData,
}

/// 飞书事件数据
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FeishuEventData {
    #[serde(rename = "message")]
    Message(FeishuMessage),
}

/// 飞书消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuMessage {
    pub message_id: String,
    pub chat_id: String,
    pub user_id: String,
    pub text: String,
    pub create_time: String,
}

/// 飞书用户信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeishuUser {
    pub user_id: String,
    pub name: String,
    pub email: Option<String>,
}

/// 飞书 Bot 处理器
pub struct FeishuHandler {
    app_id: String,
    app_secret: String,
    client: reqwest::Client,
}

impl FeishuHandler {
    /// 创建新的飞书处理器
    pub fn new(app_id: String, app_secret: String) -> Self {
        Self {
            app_id,
            app_secret,
            client: reqwest::Client::new(),
        }
    }

    /// 获取 API 基础 URL
    fn api_url(&self) -> String {
        "https://open.feishu.cn/open-apis".to_string()
    }

    /// 获取 tenant access token
    pub async fn get_tenant_token(&self) -> Result<String, Box<dyn std::error::Error>> {
        let url = format!("{}/auth/v3/tenant_access_token/internal", self.api_url());

        let params = serde_json::json!({
            "app_id": self.app_id,
            "app_secret": self.app_secret,
        });

        let response = self
            .client
            .post(&url)
            .json(&params)
            .send()
            .await?;

        let data: serde_json::Value = response.json().await?;

        if let Some(token) = data.get("tenant_access_token").and_then(|t| t.as_str()) {
            Ok(token.to_string())
        } else {
            Err("获取 token 失败".into())
        }
    }

    /// 发送消息到飞书
    pub async fn send_message(
        &self,
        chat_id: &str,
        text: &str,
        token: &str,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let url = format!("{}/im/v1/messages", self.api_url());

        let params = serde_json::json!({
            "receive_id_type": "chat_id",
            "receive_id": chat_id,
            "msg_type": "text",
            "content": {
                "text": text,
            },
        });

        self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&params)
            .send()
            .await?;

        log::info!("飞书消息已发送到 chat_id: {}", chat_id);

        Ok(())
    }

    /// 获取用户信息
    pub async fn get_user_info(
        &self,
        user_id: &str,
        token: &str,
    ) -> Result<FeishuUser, Box<dyn std::error::Error>> {
        let url = format!(
            "{}/contact/v3/users/{}",
            self.api_url(),
            user_id
        );

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        let data: serde_json::Value = response.json().await?;

        if let Some(user) = data.get("data").and_then(|d| d.get("user")) {
            let user_info = FeishuUser {
                user_id: user
                    .get("user_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                name: user
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                email: user.get("email").and_then(|v| v.as_str()).map(|s| s.to_string()),
            };

            Ok(user_info)
        } else {
            Err("获取用户信息失败".into())
        }
    }

    /// 将飞书消息转换为规范化消息
    pub fn to_message(&self, event: &FeishuEvent, user_name: String) -> Option<Message> {
        let FeishuEventData::Message(msg) = &event.event;
        Some(Message::new(
            Channel::Feishu,
            msg.user_id.clone(),
            user_name,
            msg.text.clone(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feishu_handler_creation() {
        let handler = FeishuHandler::new("app_id".to_string(), "app_secret".to_string());
        assert_eq!(handler.app_id, "app_id");
        assert_eq!(handler.app_secret, "app_secret");
    }

    #[test]
    fn test_api_url() {
        let handler = FeishuHandler::new("app_id".to_string(), "app_secret".to_string());
        let url = handler.api_url();
        assert!(url.contains("open.feishu.cn"));
    }
}
