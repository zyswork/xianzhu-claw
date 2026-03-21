//! MCP Server 管理器
//!
//! 管理 Agent 关联的所有 MCP Server 连接的生命周期

use super::mcp::{McpClient, McpStatus, McpToolDef};
use super::tools::ToolDefinition;
use sqlx::SqlitePool;
use std::collections::HashMap;
use tokio::sync::Mutex;

/// MCP Manager — 管理所有 MCP Client 连接
pub struct McpManager {
    /// server_id → McpClient
    clients: Mutex<HashMap<String, McpClient>>,
    pool: SqlitePool,
    /// 每个 agent 上次查询 DB 的时间
    last_fetch: Mutex<HashMap<String, std::time::Instant>>,
}

/// MCP 服务器列表缓存 TTL（秒）
const MCP_CACHE_TTL_SECS: u64 = 30;

impl McpManager {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            pool,
            last_fetch: Mutex::new(HashMap::new()),
        }
    }

    /// 使缓存失效并清理已删除/禁用 server 的连接
    pub async fn invalidate_cache(&self) {
        // 清除所有 agent 的缓存时间戳
        let mut last = self.last_fetch.lock().await;
        last.clear();
    }

    /// 启动 Agent 关联的所有已启用 MCP Server
    pub async fn start_servers_for_agent(&self, agent_id: &str) -> Result<(), String> {
        // 检查 per-agent 缓存：30 秒内已查询过则跳过
        {
            let last = self.last_fetch.lock().await;
            if let Some(t) = last.get(agent_id) {
                if t.elapsed().as_secs() < MCP_CACHE_TTL_SECS {
                    return Ok(());
                }
            }
        }

        let rows = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, Option<String>, Option<String>)>(
            "SELECT id, name, transport, command, args, url, env FROM mcp_servers WHERE agent_id = ? AND enabled = 1"
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("查询 MCP Server 失败: {}", e))?;

        // 更新 per-agent 缓存时间戳
        {
            let mut last = self.last_fetch.lock().await;
            last.insert(agent_id.to_string(), std::time::Instant::now());
        }

        let mut clients = self.clients.lock().await;

        // 收集本次 DB 查询返回的 server_id 集合
        let active_ids: std::collections::HashSet<&str> = rows.iter().map(|(id, ..)| id.as_str()).collect();

        // 清理已删除/禁用的 server 连接（仅清理不在 active_ids 中的旧连接）
        let stale_ids: Vec<String> = clients.keys()
            .filter(|id| !active_ids.contains(id.as_str()))
            .cloned()
            .collect();
        for id in stale_ids {
            if let Some(mut client) = clients.remove(&id) {
                log::info!("清理已移除的 MCP Server 连接: {}", client.name());
                client.shutdown().await;
            }
        }

        for (id, name, transport, command, args_json, url, env_json) in rows {
            if clients.contains_key(&id) {
                continue; // 已连接，跳过
            }

            let env: HashMap<String, String> = env_json
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

            let result = match transport.as_str() {
                "stdio" => {
                    let cmd = command.unwrap_or_default();
                    let args: Vec<String> = args_json
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default();
                    McpClient::new_stdio(&name, &cmd, &args, &env).await
                }
                "http" => {
                    let u = url.unwrap_or_default();
                    McpClient::new_http(&name, &u).await
                }
                _ => Err(format!("未知传输类型: {}", transport)),
            };

            match result {
                Ok(client) => {
                    log::info!("MCP Server '{}' 已连接", name);
                    let _ = sqlx::query("UPDATE mcp_servers SET status = 'connected' WHERE id = ?")
                        .bind(&id).execute(&self.pool).await;
                    clients.insert(id, client);
                }
                Err(e) => {
                    log::warn!("MCP Server '{}' 连接失败: {}", name, e);
                    let _ = sqlx::query("UPDATE mcp_servers SET status = 'failed' WHERE id = ?")
                        .bind(&id).execute(&self.pool).await;
                }
            }
        }

        Ok(())
    }

    /// 获取所有已连接 MCP Server 的工具定义（转换为 ToolDefinition 格式）
    pub async fn get_tool_definitions(&self) -> Vec<ToolDefinition> {
        let clients = self.clients.lock().await;
        let mut defs = Vec::new();

        for client in clients.values() {
            if *client.status() != McpStatus::Connected {
                continue;
            }
            let server_name = client.name();
            for tool in client.tools() {
                defs.push(ToolDefinition {
                    name: format!("{}.{}", server_name, tool.name),
                    description: format!("[{}] {}", server_name, tool.description),
                    parameters: tool.input_schema.clone(),
                });
            }
        }

        defs
    }

    /// 调用 MCP 工具（工具名格式: server_name.tool_name）
    pub async fn call_tool(&self, namespaced_name: &str, arguments: serde_json::Value) -> Result<String, String> {
        let (server_name, tool_name) = namespaced_name.split_once('.')
            .ok_or_else(|| format!("无效的 MCP 工具名: {}", namespaced_name))?;

        let mut clients = self.clients.lock().await;
        for client in clients.values_mut() {
            if client.name() == server_name {
                return client.call_tool(tool_name, arguments).await;
            }
        }

        Err(format!("MCP Server '{}' 未连接", server_name))
    }

    /// 测试连接指定 MCP Server
    pub async fn test_connection(&self, server_id: &str) -> Result<Vec<McpToolDef>, String> {
        let row = sqlx::query_as::<_, (String, String, Option<String>, Option<String>, Option<String>, Option<String>)>(
            "SELECT name, transport, command, args, url, env FROM mcp_servers WHERE id = ?"
        )
        .bind(server_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| format!("查询失败: {}", e))?
        .ok_or("MCP Server 不存在")?;

        let (name, transport, command, args_json, url, env_json) = row;
        let env: HashMap<String, String> = env_json
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();

        let client = match transport.as_str() {
            "stdio" => {
                let cmd = command.unwrap_or_default();
                let args: Vec<String> = args_json
                    .and_then(|s| serde_json::from_str(&s).ok())
                    .unwrap_or_default();
                McpClient::new_stdio(&name, &cmd, &args, &env).await?
            }
            "http" => {
                let u = url.unwrap_or_default();
                McpClient::new_http(&name, &u).await?
            }
            _ => return Err(format!("未知传输类型: {}", transport)),
        };

        let tools = client.tools().to_vec();

        // 更新状态
        let _ = sqlx::query("UPDATE mcp_servers SET status = 'connected' WHERE id = ?")
            .bind(server_id).execute(&self.pool).await;

        Ok(tools)
    }

    /// 关闭所有连接
    pub async fn shutdown_all(&self) {
        let mut clients = self.clients.lock().await;
        for (_, mut client) in clients.drain() {
            client.shutdown().await;
        }
    }
}
