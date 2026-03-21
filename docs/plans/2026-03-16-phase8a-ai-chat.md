# Phase 8a: AI 对话核心 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用户打开桌面应用，能创建 Agent、发起对话、收到 LLM 流式回复、查看历史。

**Architecture:** 前端 ChatPage 通过 Tauri invoke 调用 Rust 侧 Orchestrator，Orchestrator 调用 LlmClient 与 OpenAI/Anthropic API 通信，对话历史存本地 SQLite。流式输出通过 Tauri event system 推送。

**Tech Stack:** Tauri 1.5 commands, Rust async, reqwest SSE, React + TypeScript, SQLite (sqlx)

---

## Task 1: 新增 settings 表 + 配置 CRUD

**Files:**
- Modify: `local-app/src/db/schema.rs` — 添加 settings 表
- Modify: `local-app/src/db/mod.rs` — 添加 settings 查询方法

**Step 1: 在 schema.rs 的 init_schema 中添加 settings 表**

在 `init_schema()` 函数的现有 CREATE TABLE 语句后追加：

```sql
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
);
```

**Step 2: 在 db/mod.rs 的 Database impl 中添加方法**

```rust
pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
    let row = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&self.pool)
        .await?;
    Ok(row)
}

pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
    sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(key)
        .bind(value)
        .bind(chrono::Utc::now().timestamp_millis())
        .execute(&self.pool)
        .await?;
    Ok(())
}
```

**Step 3: 编译验证**

Run: `cd local-app && cargo check 2>&1 | head -20`
Expected: 无新增错误

**Step 4: Commit**

```bash
git add src/db/schema.rs src/db/mod.rs
git commit -m "feat(db): 添加 settings 表和配置 CRUD 方法"
```

---

## Task 2: LlmClient 添加流式输出支持

**Files:**
- Modify: `local-app/src/agent/llm.rs` — 添加 stream 方法
- Modify: `local-app/Cargo.toml` — 添加 futures 依赖

**Step 1: Cargo.toml 添加依赖**

在 `[dependencies]` 中添加：
```toml
futures = "0.3"
```

**Step 2: 在 llm.rs 中添加流式调用方法**

在 `LlmClient` impl 块中添加 `call_stream` 方法，使用 reqwest 的 `bytes_stream()` 解析 SSE：

```rust
use futures::StreamExt;
use tokio::sync::mpsc;

/// 流式调用 LLM，通过 channel 逐 token 返回
pub async fn call_stream(
    &self,
    messages: &[serde_json::Value],
    tx: mpsc::UnboundedSender<String>,
) -> Result<String, String> {
    let config = &self.config;
    let (url, body) = match config.provider.as_str() {
        "openai" => {
            let url = format!("{}/chat/completions", config.base_url.as_deref().unwrap_or("https://api.openai.com/v1"));
            let body = serde_json::json!({
                "model": config.model,
                "messages": messages,
                "stream": true,
                "temperature": config.temperature.unwrap_or(0.7),
                "max_tokens": config.max_tokens.unwrap_or(2048),
            });
            (url, body)
        }
        "anthropic" => {
            let url = format!("{}/messages", config.base_url.as_deref().unwrap_or("https://api.anthropic.com/v1"));
            let body = serde_json::json!({
                "model": config.model,
                "messages": messages,
                "stream": true,
                "max_tokens": config.max_tokens.unwrap_or(2048),
            });
            (url, body)
        }
        _ => return Err("不支持的 LLM 提供商".to_string()),
    };

    let mut req = self.client.post(&url)
        .json(&body);

    // 设置认证头
    match config.provider.as_str() {
        "openai" => {
            req = req.header("Authorization", format!("Bearer {}", config.api_key));
        }
        "anthropic" => {
            req = req.header("x-api-key", &config.api_key);
            req = req.header("anthropic-version", "2023-06-01");
        }
        _ => {}
    }

    let response = req.send().await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut full_response = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let text = String::from_utf8_lossy(&chunk);

        for line in text.lines() {
            if !line.starts_with("data: ") { continue; }
            let data = &line[6..];
            if data == "[DONE]" { break; }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                let token = match config.provider.as_str() {
                    "openai" => json["choices"][0]["delta"]["content"]
                        .as_str().unwrap_or("").to_string(),
                    "anthropic" => {
                        if json["type"] == "content_block_delta" {
                            json["delta"]["text"].as_str().unwrap_or("").to_string()
                        } else { continue; }
                    }
                    _ => continue,
                };

                if !token.is_empty() {
                    full_response.push_str(&token);
                    let _ = tx.send(token);
                }
            }
        }
    }

    Ok(full_response)
}
```

**Step 3: 编译验证**

Run: `cd local-app && cargo check 2>&1 | head -20`
Expected: 无新增错误

**Step 4: Commit**

```bash
git add Cargo.toml src/agent/llm.rs
git commit -m "feat(llm): 添加流式输出支持（OpenAI + Anthropic SSE）"
```

---

## Task 3: Orchestrator 重构 — 接入真实 LlmClient + 状态管理

**Files:**
- Modify: `local-app/src/agent/orchestrator.rs` — 替换 mock，接入 LlmClient
- Modify: `local-app/src/agent/mod.rs` — 导出新类型

**Step 1: 重构 Orchestrator 持有 Database 和支持真实 LLM 调用**

当前 `process_message()` 返回 mock 数据。重构为：

```rust
use crate::db::Database;
use crate::memory;
use super::llm::{LlmClient, LlmConfig};
use tokio::sync::mpsc;
use std::collections::HashMap;

pub struct Orchestrator {
    agents: HashMap<String, Agent>,
    db: Database,
}

impl Orchestrator {
    pub fn new(db: Database) -> Self {
        Self { agents: HashMap::new(), db }
    }

    /// 注册 Agent 并持久化到数据库
    pub async fn register_agent(&mut self, name: &str, system_prompt: &str, model: &str) -> Result<String, String> {
        let agent = Agent::new(name.to_string(), system_prompt.to_string(), model.to_string());
        let id = agent.id.clone();

        // 持久化到 SQLite
        sqlx::query("INSERT INTO agents (id, name, system_prompt, model, temperature, max_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&agent.id)
            .bind(&agent.name)
            .bind(&agent.system_prompt)
            .bind(&agent.model)
            .bind(agent.temperature)
            .bind(agent.max_tokens)
            .bind(agent.created_at)
            .bind(agent.updated_at)
            .execute(self.db.pool())
            .await
            .map_err(|e| e.to_string())?;

        self.agents.insert(id.clone(), agent);
        Ok(id)
    }

    /// 列出所有 Agent
    pub async fn list_agents(&self) -> Result<Vec<Agent>, String> {
        let agents = sqlx::query_as::<_, crate::db::models::Agent>("SELECT * FROM agents ORDER BY created_at DESC")
            .fetch_all(self.db.pool())
            .await
            .map_err(|e| e.to_string())?;

        Ok(agents.into_iter().map(|a| Agent {
            id: a.id, name: a.name, system_prompt: a.system_prompt,
            model: a.model, temperature: a.temperature.unwrap_or(0.7),
            max_tokens: a.max_tokens.unwrap_or(2048),
            created_at: a.created_at, updated_at: a.updated_at,
            messages: Vec::new(),
        }).collect())
    }

    /// 发送消息（流式），返回完整回复
    pub async fn send_message_stream(
        &mut self,
        agent_id: &str,
        user_message: &str,
        api_key: &str,
        provider: &str,
        tx: mpsc::UnboundedSender<String>,
    ) -> Result<String, String> {
        // 1. 获取 agent 信息
        let agent = sqlx::query_as::<_, crate::db::models::Agent>("SELECT * FROM agents WHERE id = ?")
            .bind(agent_id)
            .fetch_optional(self.db.pool())
            .await
            .map_err(|e| e.to_string())?
            .ok_or("Agent 不存在")?;

        // 2. 获取最近对话历史
        let history = memory::conversation::get_history(self.db.pool(), agent_id, 20)
            .await.unwrap_or_default();

        // 3. 构建消息列表
        let mut messages = vec![
            serde_json::json!({"role": "system", "content": agent.system_prompt}),
        ];
        for conv in &history {
            messages.push(serde_json::json!({"role": "user", "content": conv.user_message}));
            messages.push(serde_json::json!({"role": "assistant", "content": conv.agent_response}));
        }
        messages.push(serde_json::json!({"role": "user", "content": user_message}));

        // 4. 创建 LLM 客户端并流式调用
        let config = LlmConfig {
            provider: provider.to_string(),
            api_key: api_key.to_string(),
            model: agent.model.clone(),
            base_url: None,
            temperature: agent.temperature,
            max_tokens: agent.max_tokens.map(|v| v as u32),
        };
        let client = LlmClient::new(config);
        let response = client.call_stream(&messages, tx).await?;

        // 5. 保存对话历史
        memory::conversation::save_conversation(self.db.pool(), agent_id, user_message, &response)
            .await.map_err(|e| e.to_string())?;

        Ok(response)
    }
}
```

**Step 2: 编译验证**

Run: `cd local-app && cargo check 2>&1 | head -30`
Expected: 无新增错误（可能需要微调 import 路径）

**Step 3: Commit**

```bash
git add src/agent/orchestrator.rs src/agent/mod.rs
git commit -m "feat(orchestrator): 接入真实 LlmClient，支持流式对话"
```

---

## Task 4: 注册 Tauri Commands

**Files:**
- Modify: `local-app/src/main.rs` — 添加 8 个 Tauri command 函数 + invoke_handler 注册

**Step 1: 在 main.rs 中添加 Tauri command 函数**

在 `main()` 函数之前添加以下 command 定义：

```rust
use tauri::State;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

// 应用状态
struct AppState {
    db: db::Database,
    orchestrator: TokioMutex<agent::Orchestrator>,
}

#[tauri::command]
async fn save_config(state: State<'_, Arc<AppState>>, key: String, value: String) -> Result<(), String> {
    state.db.set_setting(&key, &value).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_config(state: State<'_, Arc<AppState>>, key: String) -> Result<Option<String>, String> {
    state.db.get_setting(&key).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_agent(state: State<'_, Arc<AppState>>, name: String, system_prompt: String, model: String) -> Result<String, String> {
    let mut orch = state.orchestrator.lock().await;
    orch.register_agent(&name, &system_prompt, &model).await
}

#[tauri::command]
async fn list_agents(state: State<'_, Arc<AppState>>) -> Result<Vec<serde_json::Value>, String> {
    let orch = state.orchestrator.lock().await;
    let agents = orch.list_agents().await?;
    Ok(agents.into_iter().map(|a| serde_json::json!({
        "id": a.id, "name": a.name, "model": a.model,
        "systemPrompt": a.system_prompt,
        "createdAt": a.created_at,
    })).collect())
}

#[tauri::command]
async fn delete_agent(state: State<'_, Arc<AppState>>, agent_id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM agents WHERE id = ?")
        .bind(&agent_id)
        .execute(state.db.pool())
        .await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn send_message(app: tauri::AppHandle, state: State<'_, Arc<AppState>>, agent_id: String, message: String) -> Result<String, String> {
    // 读取 API Key 和 provider
    let api_key = state.db.get_setting("api_key").await
        .map_err(|e| e.to_string())?
        .ok_or("请先在设置中配置 API Key")?;
    let provider = state.db.get_setting("llm_provider").await
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "openai".to_string());

    // 创建流式 channel
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // 启动后台任务推送 token 到前端
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(token) = rx.recv().await {
            let _ = app_clone.emit_all("llm-token", &token);
        }
        let _ = app_clone.emit_all("llm-done", "");
    });

    // 调用 orchestrator
    let mut orch = state.orchestrator.lock().await;
    orch.send_message_stream(&agent_id, &message, &api_key, &provider, tx).await
}

#[tauri::command]
async fn get_conversations(state: State<'_, Arc<AppState>>, agent_id: String, limit: Option<i64>) -> Result<Vec<serde_json::Value>, String> {
    let history = memory::conversation::get_history(state.db.pool(), &agent_id, limit.unwrap_or(50) as usize)
        .await.map_err(|e| e.to_string())?;
    Ok(history.into_iter().map(|c| serde_json::json!({
        "id": c.id, "userMessage": c.user_message,
        "agentResponse": c.agent_response, "createdAt": c.created_at,
    })).collect())
}

#[tauri::command]
async fn clear_history(state: State<'_, Arc<AppState>>, agent_id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM conversations WHERE agent_id = ?")
        .bind(&agent_id)
        .execute(state.db.pool())
        .await.map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 2: 修改 main() 函数注册 commands 和 state**

将现有的 `tauri::Builder::default()` 替换为：

```rust
let app_state = Arc::new(AppState {
    db: db.clone(),
    orchestrator: TokioMutex::new(agent::Orchestrator::new(db)),
});

tauri::Builder::default()
    .manage(app_state)
    .invoke_handler(tauri::generate_handler![
        save_config, get_config,
        create_agent, list_agents, delete_agent,
        send_message, get_conversations, clear_history,
    ])
    .run(tauri::generate_context!())
    .expect("启动 Tauri 应用失败");
```

**Step 3: 编译验证**

Run: `cd local-app && cargo check 2>&1 | head -30`
Expected: 无新增错误

**Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat(tauri): 注册 8 个 Tauri commands（配置/Agent/对话/历史）"
```

---

## Task 5: 前端 SettingsPage — API Key 配置页面

**Files:**
- Create: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/App.tsx` — 添加 /settings 路由
- Modify: `frontend/src/components/Sidebar.tsx` — 添加"设置"导航项

**Step 1: 创建 SettingsPage.tsx**

```tsx
import { useState, useEffect } from 'react'

// Tauri invoke
const invoke = (window as any).__TAURI__?.invoke || (async () => null)

export default function SettingsPage() {
  const [provider, setProvider] = useState('openai')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    // 加载已保存的配置
    const load = async () => {
      try {
        const p = await invoke('get_config', { key: 'llm_provider' })
        const k = await invoke('get_config', { key: 'api_key' })
        const m = await invoke('get_config', { key: 'llm_model' })
        if (p) setProvider(p)
        if (k) setApiKey(k)
        if (m) setModel(m)
      } catch { /* 首次使用无配置 */ }
    }
    load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await invoke('save_config', { key: 'llm_provider', value: provider })
      await invoke('save_config', { key: 'api_key', value: apiKey })
      await invoke('save_config', { key: 'llm_model', value: model })
      setMessage('配置已保存')
    } catch (e: any) {
      setMessage('保存失败: ' + (e?.message || e))
    }
    setSaving(false)
  }

  const models: Record<string, string[]> = {
    openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414', 'claude-opus-4-20250514'],
  }

  return (
    <div style={{ padding: '20px', maxWidth: '600px' }}>
      <h1>设置</h1>

      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px' }}>
        <h2>LLM 配置</h2>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>提供商</label>
          <select value={provider} onChange={e => { setProvider(e.target.value); setModel(models[e.target.value]?.[0] || '') }}
            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>模型</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }}>
            {(models[provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>API Key</label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={provider === 'openai' ? 'sk-...' : 'sk-ant-...'}
            style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', boxSizing: 'border-box' }} />
        </div>

        {message && <div style={{ marginBottom: '10px', color: message.includes('失败') ? 'red' : 'green' }}>{message}</div>}

        <button onClick={handleSave} disabled={saving || !apiKey}
          style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: saving ? 'not-allowed' : 'pointer', opacity: (saving || !apiKey) ? 0.6 : 1 }}>
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>
    </div>
  )
}
```

**Step 2: 在 App.tsx 中添加路由**

在 lazy import 区域添加：
```tsx
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
```

在 Routes 中添加（与其他 ProtectedRoute 同级）：
```tsx
<Route path="/settings" element={
  <ProtectedRoute><Layout><Suspense fallback={<PageLoader />}><SettingsPage /></Suspense></Layout></ProtectedRoute>
} />
```

**Step 3: 在 Sidebar.tsx 中添加导航项**

在现有导航项数组中添加���
```tsx
{ path: '/settings', label: '设置', icon: '⚙️' }
```

**Step 4: 构建验证**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功

**Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(frontend): 添加 SettingsPage（LLM 提供商/模型/API Key 配置）"
```

---

## Task 6: 前端 ChatPage — 对话界面

**Files:**
- Create: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/src/App.tsx` — 添加 /chat 路由
- Modify: `frontend/src/components/Sidebar.tsx` — 添加"对话"导航项

**Step 1: 创建 ChatPage.tsx**

```tsx
import { useState, useEffect, useRef } from 'react'

const invoke = (window as any).__TAURI__?.invoke || (async () => null)
const listen = (window as any).__TAURI__?.event?.listen

interface Agent {
  id: string
  name: string
  model: string
  systemPrompt: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface Conversation {
  id: string
  userMessage: string
  agentResponse: string
  createdAt: number
}

export default function ChatPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({ name: '', systemPrompt: '你是一个有用的AI助手。', model: 'gpt-4o-mini' })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 加载 Agent 列表
  const loadAgents = async () => {
    try {
      const list = await invoke('list_agents')
      setAgents(list || [])
      if (list?.length > 0 && !selectedAgent) setSelectedAgent(list[0].id)
    } catch { /* ignore */ }
  }

  // 加载对话历史
  const loadHistory = async (agentId: string) => {
    try {
      const history: Conversation[] = await invoke('get_conversations', { agentId, limit: 50 })
      const msgs: Message[] = []
      for (const c of (history || []).reverse()) {
        msgs.push({ role: 'user', content: c.userMessage })
        msgs.push({ role: 'assistant', content: c.agentResponse })
      }
      setMessages(msgs)
    } catch { setMessages([]) }
  }

  useEffect(() => { loadAgents() }, [])
  useEffect(() => { if (selectedAgent) loadHistory(selectedAgent) }, [selectedAgent])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 监听流式 token
  useEffect(() => {
    if (!listen) return
    let unlisten1: any, unlisten2: any

    const setup = async () => {
      unlisten1 = await listen('llm-token', (event: any) => {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + event.payload }]
          }
          return [...prev, { role: 'assistant', content: event.payload }]
        })
      })
      unlisten2 = await listen('llm-done', () => {
        setStreaming(false)
      })
    }
    setup()
    return () => { unlisten1?.(); unlisten2?.() }
  }, [])

  const handleSend = async () => {
    if (!input.trim() || !selectedAgent || streaming) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMsg }])
    setStreaming(true)

    try {
      await invoke('send_message', { agentId: selectedAgent, message: userMsg })
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: '错误: ' + (e?.message || e) }])
      setStreaming(false)
    }
  }

  const handleCreateAgent = async () => {
    try {
      const id = await invoke('create_agent', agentForm)
      setShowCreateAgent(false)
      setAgentForm({ name: '', systemPrompt: '你是一个有用的AI助手。', model: 'gpt-4o-mini' })
      await loadAgents()
      setSelectedAgent(id)
    } catch { /* ignore */ }
  }

  const handleDeleteAgent = async (id: string) => {
    if (!confirm('确定删除该 Agent？')) return
    await invoke('delete_agent', { agentId: id })
    if (selectedAgent === id) setSelectedAgent('')
    loadAgents()
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
      {/* 左侧 Agent 列表 */}
      <div style={{ width: '220px', borderRight: '1px solid #ddd', padding: '10px', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <strong>Agents</strong>
          <button onClick={() => setShowCreateAgent(!showCreateAgent)}
            style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer' }}>
            {showCreateAgent ? '取消' : '+ 新建'}
          </button>
        </div>

        {showCreateAgent && (
          <div style={{ marginBottom: '10px', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
            <input placeholder="名称" value={agentForm.name} onChange={e => setAgentForm({...agentForm, name: e.target.value})}
              style={{ width: '100%', padding: '4px', marginBottom: '5px', boxSizing: 'border-box' }} />
            <textarea placeholder="System Prompt" value={agentForm.systemPrompt} onChange={e => setAgentForm({...agentForm, systemPrompt: e.target.value})} rows={2}
              style={{ width: '100%', padding: '4px', marginBottom: '5px', boxSizing: 'border-box', fontSize: '12px' }} />
            <select value={agentForm.model} onChange={e => setAgentForm({...agentForm, model: e.target.value})}
              style={{ width: '100%', padding: '4px', marginBottom: '5px', boxSizing: 'border-box' }}>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="claude-sonnet-4-20250514">claude-sonnet-4</option>
            </select>
            <button onClick={handleCreateAgent} disabled={!agentForm.name}
              style={{ width: '100%', padding: '4px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
              创建
            </button>
          </div>
        )}

        {agents.map(a => (
          <div key={a.id} onClick={() => setSelectedAgent(a.id)}
            style={{ padding: '8px', marginBottom: '4px', borderRadius: '4px', cursor: 'pointer',
              backgroundColor: selectedAgent === a.id ? '#e3f2fd' : 'transparent',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: selectedAgent === a.id ? 'bold' : 'normal' }}>{a.name}</div>
              <div style={{ fontSize: '11px', color: '#999' }}>{a.model}</div>
            </div>
            <button onClick={e => { e.stopPropagation(); handleDeleteAgent(a.id) }}
              style={{ fontSize: '11px', color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
        ))}
        {agents.length === 0 && !showCreateAgent && (
          <div style={{ color: '#999', fontSize: '13px', textAlign: 'center', marginTop: '20px' }}>
            点击"+ 新建"创建你的第一个 Agent
          </div>
        )}
      </div>

      {/* 右侧对话区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 消息列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
          {messages.length === 0 && selectedAgent && (
            <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>开始对话吧</div>
          )}
          {!selectedAgent && (
            <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>请先选择或创建一个 Agent</div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{ marginBottom: '12px', display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '70%', padding: '10px 14px', borderRadius: '12px',
                backgroundColor: msg.role === 'user' ? '#007bff' : '#f1f1f1',
                color: msg.role === 'user' ? 'white' : '#333',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          {streaming && messages[messages.length - 1]?.role !== 'assistant' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ padding: '10px 14px', borderRadius: '12px', backgroundColor: '#f1f1f1', color: '#999' }}>
                思考中...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div style={{ padding: '10px 15px', borderTop: '1px solid #ddd', display: 'flex', gap: '10px' }}>
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={selectedAgent ? '输入消息...' : '请先选择 Agent'}
            disabled={!selectedAgent || streaming}
            style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '14px' }} />
          <button onClick={handleSend} disabled={!selectedAgent || streaming || !input.trim()}
            style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px',
              cursor: (!selectedAgent || streaming || !input.trim()) ? 'not-allowed' : 'pointer',
              opacity: (!selectedAgent || streaming || !input.trim()) ? 0.6 : 1 }}>
            {streaming ? '生成中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

**Step 2: 在 App.tsx 中添加路由**

在 lazy import 区域添加：
```tsx
const ChatPage = lazy(() => import('./pages/ChatPage'))
```

在 Routes 中添加：
```tsx
<Route path="/chat" element={
  <ProtectedRoute><Layout><Suspense fallback={<PageLoader />}><ChatPage /></Suspense></Layout></ProtectedRoute>
} />
```

**Step 3: 在 Sidebar.tsx 中添加导航项**

在导航项数组最前面添加：
```tsx
{ path: '/chat', label: '对话', icon: '💬' }
```

**Step 4: 构建验证**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功

**Step 5: Commit**

```bash
git add src/pages/ChatPage.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(frontend): 添加 ChatPage 对话界面（Agent 管理 + 流式消息）"
```

---

## Task 7: 前端路由和导航集成

**Files:**
- Modify: `frontend/src/App.tsx` — 添加 /chat 路由
- Modify: `frontend/src/components/Sidebar.tsx` �� 添加"对话"导航项，调整顺序

**Step 1: App.tsx 添加 ChatPage 路由**

在 lazy import 区域添加：
```tsx
const ChatPage = lazy(() => import('./pages/ChatPage'))
```

在 Routes 中添加（放在 dashboard 之后）：
```tsx
<Route path="/chat" element={
  <ProtectedRoute><Layout><Suspense fallback={<PageLoader />}><ChatPage /></Suspense></Layout></ProtectedRoute>
} />
```

**Step 2: Sidebar.tsx 调整导航项顺序**

导航项数组调整为（对话放在最前面）：
```tsx
const navItems = [
  { path: '/chat', label: '对话', icon: '💬' },
  { path: '/dashboard', label: '仪表盘', icon: '📊' },
  { path: '/users', label: '用户管理', icon: '👥' },
  { path: '/knowledge-base', label: '知识库', icon: '📚' },
  { path: '/agent-templates', label: 'Agent 模板', icon: '🤖' },
  { path: '/token-monitoring', label: 'Token 监控', icon: '📈' },
  { path: '/settings', label: '设置', icon: '⚙️' },
]
```

**Step 3: 构建验证**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功

**Step 4: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(frontend): 添加对话和设置路由，调整导航顺序"
```

---

## Task 8: 端到端集成测试

**Files:**
- 无新文件，验证整体流程

**Step 1: 构建前端**

Run: `cd frontend && npm run build`
Expected: 构建成功，dist/ 目录生成

**Step 2: 编译 Rust**

Run: `cd local-app && cargo build 2>&1 | tail -20`
Expected: 编译成功

**Step 3: 功能验证清单**

手动验证（或通过 cargo test）：
1. ✅ 应用启动，数据库初始化（含 settings 表）
2. ✅ 设置页面：可保存 API Key / Provider / Model
3. ✅ 对话页面：可创建 Agent
4. ✅ 对话页面：可发送消息，收到流式回复
5. ✅ 对话页面：切换 Agent 加载历史
6. ✅ 对话页面：可删除 Agent
7. ✅ 对话页面：可清除历史

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat: Phase 8a 完成 — AI 对话核心功能（Agent CRUD + 流式对话 + 历史记录）"
```

---

## 总结

| Task | 内容 | 预计时间 |
|------|------|---------|
| 1 | settings 表 + 配置 CRUD | 5 min |
| 2 | LlmClient 流式输出 | 10 min |
| 3 | Orchestrator 重构接入真实 LLM | 10 min |
| 4 | 注册 8 个 Tauri Commands | 10 min |
| 5 | SettingsPage 前端 | 10 min |
| 6 | ChatPage 前端 | 15 min |
| 7 | 路由和导航集成 | 5 min |
| 8 | 端到端集成测试 | 10 min |
| **合计** | | **~75 min** |
