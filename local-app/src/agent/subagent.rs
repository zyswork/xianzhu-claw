//! 子 Agent 系统
//!
//! 支持主 Agent 派生子 Agent 执行子任务
//! 包含：SubagentRegistry（状态跟踪）、spawn/send/yield 逻辑

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, oneshot};

/// 子 Agent 状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SubagentStatus {
    Running,
    Completed,
    Failed(String),
    Timeout,
    Cancelled,
}

/// 子 Agent 记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubagentRecord {
    /// 子 Agent ID
    pub id: String,
    /// 父 Agent ID
    pub parent_id: String,
    /// 子 Agent 名称
    pub name: String,
    /// 分配的任务描述
    pub task: String,
    /// 当前状态
    pub status: SubagentStatus,
    /// 结果（完成后填充）
    pub result: Option<String>,
    /// 创建时间
    pub created_at: i64,
    /// 完成时间
    pub finished_at: Option<i64>,
    /// 超时时间（秒）
    pub timeout_secs: u64,
}

/// 消息信封
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub from: String,
    pub to: String,
    pub content: String,
    pub timestamp: i64,
}

/// 子 Agent 注册表
///
/// 跟踪所有子 Agent 的生命周期
pub struct SubagentRegistry {
    /// 活跃的子 Agent 记录
    records: Arc<Mutex<HashMap<String, SubagentRecord>>>,
    /// 消息邮箱：agent_id → 待接收消息队列
    mailboxes: Arc<Mutex<HashMap<String, Vec<AgentMessage>>>>,
    /// 等待回复的 channel：agent_id → oneshot sender
    waiters: Arc<Mutex<HashMap<String, oneshot::Sender<AgentMessage>>>>,
}

impl SubagentRegistry {
    pub fn new() -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
            mailboxes: Arc::new(Mutex::new(HashMap::new())),
            waiters: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 注册新的子 Agent
    pub async fn register(&self, record: SubagentRecord) {
        let id = record.id.clone();
        let should_cleanup = {
            let mut records = self.records.lock().await;
            records.insert(id.clone(), record);
            records.len() > 100
        };
        self.mailboxes.lock().await.insert(id, Vec::new());
        // 自动清理：超过 100 条记录时触发
        if should_cleanup {
            self.cleanup().await;
        }
    }

    /// 更新子 Agent 状态
    pub async fn update_status(&self, id: &str, status: SubagentStatus, result: Option<String>) {
        if let Some(record) = self.records.lock().await.get_mut(id) {
            record.status = status;
            record.result = result;
            record.finished_at = Some(chrono::Utc::now().timestamp_millis());
        }
    }

    /// 获取子 Agent 记录
    pub async fn get(&self, id: &str) -> Option<SubagentRecord> {
        self.records.lock().await.get(id).cloned()
    }

    /// 列出某个父 Agent 的所有子 Agent
    pub async fn list_children(&self, parent_id: &str) -> Vec<SubagentRecord> {
        self.records.lock().await.values()
            .filter(|r| r.parent_id == parent_id)
            .cloned()
            .collect()
    }

    /// 取消子 Agent
    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        let mut records = self.records.lock().await;
        if let Some(record) = records.get_mut(id) {
            if record.status == SubagentStatus::Running {
                record.status = SubagentStatus::Cancelled;
                record.finished_at = Some(chrono::Utc::now().timestamp_millis());
                Ok(())
            } else {
                Err(format!("子 Agent {} 不在运行状态", id))
            }
        } else {
            Err(format!("子 Agent {} 不存在", id))
        }
    }

    /// 发送消息（带关系权限检查）
    pub async fn send_message_checked(
        &self,
        pool: &sqlx::SqlitePool,
        msg: AgentMessage,
    ) -> Result<(), String> {
        // 检查通信权限
        let can_comm = super::relations::RelationManager::can_communicate(pool, &msg.from, &msg.to).await?;
        if !can_comm {
            return Err(format!(
                "Agent {} 没有与 Agent {} 的通信权限，请先建立关系",
                msg.from, msg.to
            ));
        }
        self.send_message(msg).await
    }

    /// 发送消息到指定 Agent 的邮箱
    pub(crate) async fn send_message(&self, msg: AgentMessage) -> Result<(), String> {
        let to = msg.to.clone();

        // 如果有等待者，直接发送给它
        {
            let mut waiters = self.waiters.lock().await;
            if let Some(waiter) = waiters.remove(&to) {
                let _ = waiter.send(msg);
                return Ok(());
            }
        }

        // 没有等待者，放入邮箱
        let mut mailboxes = self.mailboxes.lock().await;
        mailboxes.entry(to).or_default().push(msg);

        Ok(())
    }

    /// 等待接收消息（带超时）
    pub async fn receive_message(&self, agent_id: &str, timeout_secs: u64) -> Result<AgentMessage, String> {
        // 先检查邮箱
        {
            let mut mailboxes = self.mailboxes.lock().await;
            if let Some(mailbox) = mailboxes.get_mut(agent_id) {
                if !mailbox.is_empty() {
                    return Ok(mailbox.remove(0));
                }
            }
        }

        // 没有消息，注册等待
        let (tx, rx) = oneshot::channel();
        self.waiters.lock().await.insert(agent_id.to_string(), tx);

        // 带超时等待
        match tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            rx,
        ).await {
            Ok(Ok(msg)) => Ok(msg),
            Ok(Err(_)) => Err("消息通道已关闭".to_string()),
            Err(_) => {
                // 超时，移除等待者
                self.waiters.lock().await.remove(agent_id);
                Err("等待消息超时".to_string())
            }
        }
    }

    /// 清理已完成的子 Agent 记录（保留最近 100 条）
    pub async fn cleanup(&self) {
        let mut records = self.records.lock().await;
        let mut finished: Vec<(String, i64)> = records.iter()
            .filter(|(_, r)| r.status != SubagentStatus::Running)
            .map(|(id, r)| (id.clone(), r.finished_at.unwrap_or(0)))
            .collect();
        finished.sort_by(|a, b| b.1.cmp(&a.1));

        // 保留最近 100 条，删除更早的
        let to_remove: Vec<String> = finished.iter().skip(100).map(|(id, _)| id.clone()).collect();
        for id in &to_remove {
            records.remove(id);
        }
        // 释放 records 锁后再清理 mailboxes
        drop(records);
        let mut mailboxes = self.mailboxes.lock().await;
        for id in &to_remove {
            mailboxes.remove(id);
        }
    }
}

/// 子 Agent 派生配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnConfig {
    /// 子 Agent 名称
    pub name: String,
    /// 任务描述（作为子 Agent 的 system prompt 补充）
    pub task: String,
    /// 使用的模型（默认继承父 Agent）
    pub model: Option<String>,
    /// 超时时间（秒，默认 300）
    pub timeout_secs: Option<u64>,
}
