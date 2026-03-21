# Phase 10b: MCP Client 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现完整的 MCP Client，让 Agent 能连接外部 MCP Server，获取并调用其工具，支持 stdio/HTTP 传输和 Claude Desktop 配置导入。

**Architecture:** 新增 `agent/mcp.rs` 模块实现 JSON-RPC 2.0 客户端（stdio 子进程 + HTTP），DB 新增 `mcp_servers` 表持久化配置，Orchestrator 在消息发送时启动 MCP Server 并将工具注入 ToolManager，前端新增 McpTab 组件集成到 AgentConfigPanel。

**Tech Stack:** Rust + tokio (异步子进程/HTTP), JSON-RPC 2.0, SQLite, React 18 + TypeScript

---

### Task 1: 后端 — mcp_servers 数据库表

**Files:**
- Modify: `local-app/src/db/schema.rs`
- Test: `cargo test`

**Step 1: 在 schema.rs 添加 mcp_servers 表**

在 `init_schema` 函数中，`settings` 表创建之后添加：

```rust
// 创建 MCP Server 配置表
sqlx::query(
    r#"
    CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT,
        url TEXT,
        env TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'configured',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
    "#,
)
.execute(pool)
.await?;

sqlx::query("CREATE INDEX IF NOT EXISTS idx_mcp_servers_agent_id ON mcp_servers(agent_id)")
    .execute(pool)
    .await?;
```

**Step 2: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 3: 运行测试**

Run: `cargo test`
Expected: 106+ tests pass（现有测试中 `setup_pool` 调用 `init_schema`，会自动创建新表）

**Step 4: Commit**

```bash
git add local-app/src/db/schema.rs
git commit -m "feat: 添加 mcp_servers 数据库表"
```

---

### Task 2: 后端 — MCP Tauri 命令（CRUD + 导入）

**Files:**
- Modify: `local-app/src/main.rs`
- Test: `cargo test`

**Step 1: 添加 5 个 MCP 相关 Tauri 命令**

在 `set_agent_tool_override` 命令之后添加：

```rust
/// MCP Server 配置
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct McpServerInfo {
    id: String,
    agent_id: String,
    name: String,
    transport: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    env: Option<serde_json::Value>,
    enabled: bool,
    status: String,
    created_at: i64,
}

/// 列出 Agent 的 MCP Server
#[tauri::command]
async fn list_mcp_servers(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
) -> Result<Vec<McpServerInfo>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<String>, Option<String>, Option<String>, Option<String>, i32, String, i64)>(
        "SELECT id, agent_id, name, transport, command, args, url, env, enabled, status, created_at FROM mcp_servers WHERE agent_id = ? ORDER BY created_at"
    )
    .bind(&agent_id)
    .fetch_all(state.orchestrator.pool())
    .await
    .map_err(|e| format!("查询 MCP Server 失败: {}", e))?;

    Ok(rows.into_iter().map(|r| McpServerInfo {
        id: r.0, agent_id: r.1, name: r.2, transport: r.3,
        command: r.4,
        args: r.5.and_then(|s| serde_json::from_str(&s).ok()),
        url: r.6,
        env: r.7.and_then(|s| serde_json::from_str(&s).ok()),
        enabled: r.8 != 0, status: r.9, created_at: r.10,
    }).collect())
}

/// 添加 MCP Server
#[tauri::command]
async fn add_mcp_server(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    name: String,
    transport: String,
    command: Option<String>,
    args: Option<Vec<String>>,
    url: Option<String>,
    env: Option<serde_json::Value>,
) -> Result<McpServerInfo, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let args_json = args.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default());
    let env_json = env.as_ref().map(|e| serde_json::to_string(e).unwrap_or_default());

    sqlx::query("INSERT INTO mcp_servers (id, agent_id, name, transport, command, args, url, env, enabled, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'configured', ?)")
        .bind(&id).bind(&agent_id).bind(&name).bind(&transport)
        .bind(&command).bind(&args_json).bind(&url).bind(&env_json).bind(now)
        .execute(state.orchestrator.pool()).await
        .map_err(|e| format!("添加 MCP Server 失败: {}", e))?;

    Ok(McpServerInfo {
        id, agent_id, name, transport, command, args, url, env,
        enabled: true, status: "configured".to_string(), created_at: now,
    })
}

/// 删除 MCP Server
#[tauri::command]
async fn remove_mcp_server(
    state: State<'_, Arc<AppState>>,
    server_id: String,
) -> Result<(), String> {
    let result = sqlx::query("DELETE FROM mcp_servers WHERE id = ?")
        .bind(&server_id)
        .execute(state.orchestrator.pool()).await
        .map_err(|e| format!("删除 MCP Server 失败: {}", e))?;
    if result.rows_affected() == 0 {
        return Err("MCP Server 不存在".to_string());
    }
    Ok(())
}

/// 更新 MCP Server 启用状态
#[tauri::command]
async fn toggle_mcp_server(
    state: State<'_, Arc<AppState>>,
    server_id: String,
    enabled: bool,
) -> Result<(), String> {
    sqlx::query("UPDATE mcp_servers SET enabled = ? WHERE id = ?")
        .bind(enabled as i32).bind(&server_id)
        .execute(state.orchestrator.pool()).await
        .map_err(|e| format!("更新 MCP Server 失败: {}", e))?;
    Ok(())
}

/// 导入 Claude Desktop MCP 配置
#[tauri::command]
async fn import_claude_mcp_config(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
) -> Result<Vec<McpServerInfo>, String> {
    // 读取 Claude Desktop 配置文件
    let config_path = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join("Library/Application Support/Claude/claude_desktop_config.json");

    let content = tokio::fs::read_to_string(&config_path).await
        .map_err(|e| format!("读取 Claude Desktop 配置失败: {}。路径: {}", e, config_path.display()))?;

    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("解析配置 JSON 失败: {}", e))?;

    let mcp_servers = config.get("mcpServers")
        .and_then(|v| v.as_object())
        .ok_or("配置中未找到 mcpServers 字段")?;

    let mut imported = Vec::new();
    let now = chrono::Utc::now().timestamp_millis();

    for (name, server_config) in mcp_servers {
        let id = uuid::Uuid::new_v4().to_string();
        let command = server_config.get("command").and_then(|v| v.as_str()).map(|s| s.to_string());
        let args: Option<Vec<String>> = server_config.get("args")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect());
        let env = server_config.get("env").cloned();
        let args_json = args.as_ref().map(|a| serde_json::to_string(a).unwrap_or_default());
        let env_json = env.as_ref().map(|e| serde_json::to_string(e).unwrap_or_default());

        sqlx::query("INSERT INTO mcp_servers (id, agent_id, name, transport, command, args, url, env, enabled, status, created_at) VALUES (?, ?, ?, 'stdio', ?, ?, NULL, ?, 1, 'configured', ?)")
            .bind(&id).bind(&agent_id).bind(name)
            .bind(&command).bind(&args_json).bind(&env_json).bind(now)
            .execute(state.orchestrator.pool()).await
            .map_err(|e| format!("导入 {} 失败: {}", name, e))?;

        imported.push(McpServerInfo {
            id, agent_id: agent_id.clone(), name: name.clone(),
            transport: "stdio".to_string(), command, args, url: None, env,
            enabled: true, status: "configured".to_string(), created_at: now,
        });
    }

    log::info!("导入 {} 个 Claude Desktop MCP Server", imported.len());
    Ok(imported)
}
```

**Step 2: 注册命令到 invoke_handler**

在 `set_agent_tool_override,` 之后添加：
```rust
list_mcp_servers,
add_mcp_server,
remove_mcp_server,
toggle_mcp_server,
import_claude_mcp_config,
```

**Step 3: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 4: Commit**

```bash
git add local-app/src/main.rs
git commit -m "feat: 添加 MCP Server CRUD + Claude Desktop 导入命令"
```

---

### Task 3: 后端 — MCP Client 核心模块 (JSON-RPC 2.0 + stdio/HTTP)

**Files:**
- Create: `local-app/src/agent/mcp.rs`
- Modify: `local-app/src/agent/mod.rs`
- Test: `cargo test`

**Step 1: 创建 mcp.rs**

创建 `local-app/src/agent/mcp.rs`，实现：

- `JsonRpcRequest` / `JsonRpcResponse` / `JsonRpcError` — JSON-RPC 2.0 消息结构
- `McpToolDef` — MCP 工具定义 (name, description, input_schema)
- `McpStatus` enum — Configured / Connected / Failed(String)
- `McpTransport` enum — Stdio (child process + stdin/stdout) / Http (reqwest client)
- `McpClient` struct，核心方法：
  - `new_stdio(name, command, args, env) -> Result<Self>` — 启动子进程��执行 initialize + tools/list
  - `new_http(name, url) -> Result<Self>` — HTTP 连接，执行 initialize + tools/list
  - `send_request(method, params) -> Result<Value>` — 发送 JSON-RPC 请求
  - `initialize()` — 发送 `initialize` 握手
  - `fetch_tools()` — 发送 `tools/list` 获取工具列表
  - `call_tool(name, arguments) -> Result<String>` — 发送 `tools/call` 调用工具
  - `shutdown()` — 关闭连接/杀死子进程
  - `status()` / `tools()` / `name()` — 访问器

stdio 传输要点：
- `tokio::process::Command` 启动子进程，piped stdin/stdout
- 每行一个 JSON-RPC 消息（换行分隔）
- 30 秒超时
- stdin/stdout 用 `Mutex` 保护并发

HTTP 传输要点：
- `reqwest::Client` POST JSON-RPC 到 url
- 30 秒超时

initialize 握手：
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2024-11-05",
  "capabilities":{},
  "clientInfo":{"name":"openclaw","version":"0.1.0"}
}}
```

tools/list：
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

tools/call：
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"tool_name","arguments":{...}
}}
```

**Step 2: 在 mod.rs 注册模块**

在 `local-app/src/agent/mod.rs` 添加：
```rust
pub mod mcp;
pub use mcp::{McpClient, McpStatus, McpToolDef};
```

**Step 3: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 4: Commit**

```bash
git add local-app/src/agent/mcp.rs local-app/src/agent/mod.rs
git commit -m "feat: MCP Client 核心模块 (JSON-RPC 2.0 stdio/HTTP)"
```

---

### Task 4: 后端 — MCP Manager + Orchestrator 集成

**Files:**
- Create: `local-app/src/agent/mcp_manager.rs`
- Modify: `local-app/src/agent/mod.rs`
- Modify: `local-app/src/agent/orchestrator.rs`
- Modify: `local-app/src/main.rs`
- Test: `cargo test`

**Step 1: 创建 mcp_manager.rs**

管理多个 McpClient 的生命周期：

```rust
//! MCP Server 管理器
//!
//! 管理 Agent 关联的所有 MCP Server 连接

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
}

impl McpManager {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            clients: Mutex::new(HashMap::new()),
            pool,
        }
    }

    /// 启动 Agent 关联的所有已启用 MCP Server
    pub async fn start_servers_for_agent(&self, agent_id: &str) -> Result<(), String> {
        let rows = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, Option<String>, Option<String>)>(
            "SELECT id, name, transport, command, args, url, env FROM mcp_servers WHERE agent_id = ? AND enabled = 1"
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| format!("查询 MCP Server 失败: {}", e))?;

        let mut clients = self.clients.lock().await;

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
                    // 更新 DB 状态
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

    /// 调用 MCP 工具
    pub async fn call_tool(&self, namespaced_name: &str, arguments: serde_json::Value) -> Result<String, String> {
        // 解析 "server_name.tool_name"
        let (server_name, tool_name) = namespaced_name.split_once('.')
            .ok_or_else(|| format!("无效的 MCP 工具名: {}", namespaced_name))?;

        let clients = self.clients.lock().await;
        for client in clients.values() {
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
```

**Step 2: 注册模块**

在 `mod.rs` 添加：
```rust
pub mod mcp_manager;
pub use mcp_manager::McpManager;
```

**Step 3: Orchestrator 集成 McpManager**

修改 `orchestrator.rs`：

- Orchestrator 新增 `mcp_manager: McpManager` 字段
- `new()` 中初始化 `McpManager::new(pool.clone())`
- 添加 `mcp_manager(&self) -> &McpManager` 访问器
- `send_message_stream` 中，在工具过滤之后：
  1. 调用 `self.mcp_manager.start_servers_for_agent(agent_id)` 启动 MCP Server
  2. 获取 MCP 工具定义 `self.mcp_manager.get_tool_definitions()`
  3. 合并到 filtered_defs
- `run_agent_loop` 中，工具执行部分：
  - 如果 tool_name 包含 `.`（MCP 工具），调用 `self.mcp_manager.call_tool()` 而非 `self.tool_manager.execute_tool()`

**Step 4: main.rs 添加 test_mcp_connection 命令**

```rust
/// 测试 MCP Server 连接
#[tauri::command]
async fn test_mcp_connection(
    state: State<'_, Arc<AppState>>,
    server_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let tools = state.orchestrator.mcp_manager()
        .test_connection(&server_id).await?;
    Ok(tools.iter().map(|t| serde_json::json!({
        "name": t.name,
        "description": t.description,
    })).collect())
}
```

注册到 invoke_handler。

**Step 5: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 6: Commit**

```bash
git add local-app/src/agent/mcp_manager.rs local-app/src/agent/mcp.rs local-app/src/agent/mod.rs local-app/src/agent/orchestrator.rs local-app/src/main.rs
git commit -m "feat: MCP Manager + Orchestrator 集成 MCP 工具"
```

---

### Task 5: 前端 — McpTab 组件

**Files:**
- Create: `frontend/src/components/McpTab.tsx`
- Modify: `frontend/src/components/AgentConfigPanel.tsx`
- Test: `cd frontend && npx tsc --noEmit`

**Step 1: 创建 McpTab.tsx**

```tsx
/**
 * MCP Server 管理 Tab
 *
 * 功能：
 * - 列出 Agent 关联的 MCP Server + 状态指示器
 * - 添加新 MCP Server（stdio/HTTP）
 * - 测试连接
 * - 导入 Claude Desktop 配置
 * - 删除/启用禁用 Server
 */

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface McpServer {
  id: string
  agentId: string
  name: string
  transport: string
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  enabled: boolean
  status: string
  createdAt: number
}

interface McpTool {
  name: string
  description: string
}

interface McpTabProps {
  agentId: string
}

const STATUS_ICONS: Record<string, string> = {
  connected: '🟢',
  configured: '🟡',
  failed: '🔴',
}

export default function McpTab({ agentId }: McpTabProps) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [serverTools, setServerTools] = useState<Record<string, McpTool[]>>({})
  const [testing, setTesting] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')

  // 添加表单
  const [form, setForm] = useState({
    name: '', transport: 'stdio' as 'stdio' | 'http',
    command: '', args: '', url: '',
    envKeys: [''], envValues: [''],
  })

  const loadServers = async () => {
    try {
      const list = await invoke<McpServer[]>('list_mcp_servers', { agentId })
      setServers(list)
    } catch (e) { setError(String(e)) }
  }

  useEffect(() => { loadServers() }, [agentId])

  const handleAdd = async () => {
    try {
      setError('')
      const env: Record<string, string> = {}
      form.envKeys.forEach((k, i) => {
        if (k.trim()) env[k.trim()] = form.envValues[i] || ''
      })
      const args = form.args.trim() ? form.args.split(/\s+/) : undefined

      await invoke('add_mcp_server', {
        agentId, name: form.name, transport: form.transport,
        command: form.transport === 'stdio' ? form.command : null,
        args: form.transport === 'stdio' ? args : null,
        url: form.transport === 'http' ? form.url : null,
        env: Object.keys(env).length > 0 ? env : null,
      })
      setShowAdd(false)
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', envKeys: [''], envValues: [''] })
      await loadServers()
    } catch (e) { setError(String(e)) }
  }

  const handleRemove = async (serverId: string) => {
    try {
      await invoke('remove_mcp_server', { serverId })
      await loadServers()
    } catch (e) { setError(String(e)) }
  }

  const handleToggle = async (serverId: string, enabled: boolean) => {
    try {
      await invoke('toggle_mcp_server', { serverId, enabled })
      await loadServers()
    } catch (e) { setError(String(e)) }
  }

  const handleTest = async (serverId: string) => {
    try {
      setTesting(serverId)
      setError('')
      const tools = await invoke<McpTool[]>('test_mcp_connection', { serverId })
      setServerTools(prev => ({ ...prev, [serverId]: tools }))
      setExpandedServer(serverId)
      await loadServers()
    } catch (e) {
      setError(String(e))
      await loadServers()
    } finally { setTesting(null) }
  }

  const handleImport = async () => {
    try {
      setImporting(true)
      setError('')
      const imported = await invoke<McpServer[]>('import_claude_mcp_config', { agentId })
      await loadServers()
      alert(`成功导入 ${imported.length} 个 MCP Server`)
    } catch (e) { setError(String(e)) }
    finally { setImporting(false) }
  }

  return (
    <div>
      {/* 操作栏 */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        <button onClick={() => setShowAdd(!showAdd)} style={btnStyle}>
          {showAdd ? '取消' : '+ 添加'}
        </button>
        <button onClick={handleImport} disabled={importing} style={btnStyle}>
          {importing ? '导入中...' : '📋 导入 Claude'}
        </button>
      </div>

      {error && <div style={{ color: 'red', fontSize: '12px', marginBottom: '8px' }}>{error}</div>}

      {/* 添加表单 */}
      {showAdd && (
        <div style={{ border: '1px solid #ddd', borderRadius: '6px', padding: '10px', marginBottom: '10px', fontSize: '12px' }}>
          <div style={{ marginBottom: '6px' }}>
            <label>名称</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              style={inputStyle} placeholder="my-server" />
          </div>
          <div style={{ marginBottom: '6px' }}>
            <label>类型</label>
            <select value={form.transport} onChange={e => setForm(f => ({ ...f, transport: e.target.value as 'stdio' | 'http' }))}
              style={inputStyle}>
              <option value="stdio">stdio (命令行)</option>
              <option value="http">HTTP</option>
            </select>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <div style={{ marginBottom: '6px' }}>
                <label>命令</label>
                <input value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))}
                  style={inputStyle} placeholder="npx" />
              </div>
              <div style={{ marginBottom: '6px' }}>
                <label>参数（空格分隔）</label>
                <input value={form.args} onChange={e => setForm(f => ({ ...f, args: e.target.value }))}
                  style={inputStyle} placeholder="-y @modelcontextprotocol/server-filesystem /tmp" />
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '6px' }}>
              <label>URL</label>
              <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                style={inputStyle} placeholder="http://localhost:3001/mcp" />
            </div>
          )}
          {/* 环境变量 */}
          <div style={{ marginBottom: '6px' }}>
            <label>环境变量</label>
            {form.envKeys.map((k, i) => (
              <div key={i} style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <input value={k} onChange={e => {
                  const keys = [...form.envKeys]; keys[i] = e.target.value
                  setForm(f => ({ ...f, envKeys: keys }))
                }} style={{ ...inputStyle, flex: 1 }} placeholder="KEY" />
                <input value={form.envValues[i]} onChange={e => {
                  const vals = [...form.envValues]; vals[i] = e.target.value
                  setForm(f => ({ ...f, envValues: vals }))
                }} style={{ ...inputStyle, flex: 1 }} placeholder="VALUE" />
                {i === form.envKeys.length - 1 && (
                  <button onClick={() => setForm(f => ({
                    ...f, envKeys: [...f.envKeys, ''], envValues: [...f.envValues, '']
                  }))} style={{ ...btnStyle, padding: '2px 6px' }}>+</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={handleAdd} disabled={!form.name.trim()}
            style={{ ...btnStyle, backgroundColor: '#007bff', color: '#fff', width: '100%' }}>
            添加
          </button>
        </div>
      )}

      {/* Server 列表 */}
      {servers.length === 0 && !showAdd && (
        <div style={{ color: '#999', fontSize: '12px', textAlign: 'center', padding: '20px 0' }}>
          暂无 MCP Server，点击"添加"或"导入 Claude"
        </div>
      )}

      {servers.map(s => (
        <div key={s.id} style={{
          border: '1px solid #eee', borderRadius: '6px', padding: '8px',
          marginBottom: '6px', fontSize: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{STATUS_ICONS[s.status] || '⚪'}</span>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: '#999', fontSize: '11px' }}>{s.transport}</span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              <input type="checkbox" checked={s.enabled}
                onChange={e => handleToggle(s.id, e.target.checked)} title="启用/禁用" />
              <button onClick={() => handleTest(s.id)} disabled={testing === s.id}
                style={{ ...btnStyle, padding: '1px 6px', fontSize: '11px' }}>
                {testing === s.id ? '...' : '测试'}
              </button>
              <button onClick={() => handleRemove(s.id)}
                style={{ ...btnStyle, padding: '1px 6px', fontSize: '11px', color: 'red' }}>
                ✕
              </button>
            </div>
          </div>

          {/* 展开工具列表 */}
          {expandedServer === s.id && serverTools[s.id] && (
            <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #eee' }}>
              <div style={{ color: '#666', marginBottom: '4px' }}>
                工具 ({serverTools[s.id].length}):
              </div>
              {serverTools[s.id].map(t => (
                <div key={t.name} style={{ padding: '2px 0', color: '#444' }}>
                  <span style={{ fontWeight: 500 }}>{t.name}</span>
                  <span style={{ color: '#999', marginLeft: '6px' }}>{t.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px', border: '1px solid #ddd', borderRadius: '4px',
  backgroundColor: '#fff', cursor: 'pointer', fontSize: '12px',
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '4px 8px', border: '1px solid #ddd',
  borderRadius: '4px', fontSize: '12px', boxSizing: 'border-box',
}
```

**Step 2: 修改 AgentConfigPanel.tsx**

添加第 4 个 Tab：

- import McpTab
- TABS 数组添加 `{ id: 'mcp', icon: '🔌', label: 'MCP' }`
- TabId 类型添加 `'mcp'`
- 渲染区添加 `{activeTab === 'mcp' && <McpTab agentId={agentId} />}`

**Step 3: TypeScript 验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/components/McpTab.tsx frontend/src/components/AgentConfigPanel.tsx
git commit -m "feat: MCP Tab UI — Server 管理 + 测试连接 + Claude 导入"
```

---

### Task 6: 集成验证 — 构建 + 测试

**Step 1: 后端编译 + 测试**

Run: `cargo check && cargo test`
Expected: 编译通过，106+ tests pass

**Step 2: 前端编译**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 无错误，dist/ 生成

**Step 3: Release 构建**

Run: `cargo build --release`
Expected: 编译成功

**Step 4: 手动验证**

启动应用，验证：
1. 配置面板现在有 4 个 Tab（Soul/Tools/Params/MCP）
2. MCP Tab → 空状态显示提示
3. 点击"添加" → 表单出现，可选 stdio/HTTP
4. 填写 Server 信息 → 添加成功，列表显示 🟡 configured
5. 点击"测试" → 连接成功显示 🟢 + 工具列表，失败显示 🔴
6. 点击"导入 Claude" → 读取 Claude Desktop 配置，批量添加
7. 启用/禁用 toggle 工作正常
8. 删除 Server 工作正常

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Phase 10b - MCP Client 完整实现"
```
