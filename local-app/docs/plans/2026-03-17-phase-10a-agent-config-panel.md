# Phase 10a: Agent 配置面板 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在对话页右侧添加可折叠配置面板，包含灵魂文件编辑、工具管理、参数调优三个 Tab。

**Architecture:** ChatPage.tsx 新增右侧面板组件，通过已有 Tauri 命令读写灵魂文件，新增 3 个 Tauri 命令支持工具配置和 Agent 参数更新。工具配置持久化到 Agent workspace 的 TOOLS.md。

**Tech Stack:** React 18 + TypeScript (前端), Rust + Tauri (后端), SQLite (数据库)

---

### Task 1: 后端 — update_agent 命令

**Files:**
- Modify: `local-app/src/main.rs` (添加新命令 + 注册)
- Test: `cargo test`

**Step 1: 在 main.rs 添加 update_agent 命令**

在 `list_soul_files` 命令之后（约 line 427）添加：

```rust
/// 更新 Agent 参数
#[tauri::command]
async fn update_agent(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    name: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<i32>,
) -> Result<(), String> {
    // 构建动态 UPDATE 语句
    let mut updates = Vec::new();
    let mut binds: Vec<Box<dyn std::fmt::Display>> = Vec::new();

    if let Some(ref v) = name { updates.push("name = ?"); }
    if let Some(ref v) = model { updates.push("model = ?"); }
    if let Some(v) = temperature { updates.push("temperature = ?"); }
    if let Some(v) = max_tokens { updates.push("max_tokens = ?"); }

    if updates.is_empty() {
        return Err("没有要更新的字段".to_string());
    }

    let now = chrono::Utc::now().timestamp_millis();
    updates.push("updated_at = ?");

    let sql = format!("UPDATE agents SET {} WHERE id = ?", updates.join(", "));

    let mut query = sqlx::query(&sql);
    if let Some(ref v) = name { query = query.bind(v); }
    if let Some(ref v) = model { query = query.bind(v); }
    if let Some(v) = temperature { query = query.bind(v); }
    if let Some(v) = max_tokens { query = query.bind(v); }
    query = query.bind(now).bind(&agent_id);

    let result = query.execute(state.orchestrator.pool()).await
        .map_err(|e| format!("更新 Agent 失败: {}", e))?;

    if result.rows_affected() == 0 {
        return Err("Agent 不存在".to_string());
    }
    log::info!("Agent 已更新: {}", agent_id);
    Ok(())
}
```

**Step 2: 注册命令**

在 `invoke_handler` 的 `generate_handler![]` 数组中添加 `update_agent`。

**Step 3: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 4: Commit**

```bash
git add src/main.rs
git commit -m "feat: 添加 update_agent Tauri 命令"
```

---

### Task 2: 后端 — get_agent_tools / set_agent_tool_profile / set_agent_tool_override 命令

**Files:**
- Modify: `local-app/src/main.rs` (添加 3 个新命令 + 注册)
- Read: `local-app/src/agent/tools.rs` (ToolManager API)

**Step 1: 添加 get_agent_tools 命令**

```rust
/// 获取 Agent 工具列表及启用状态
#[tauri::command]
async fn get_agent_tools(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
) -> Result<serde_json::Value, String> {
    // 读取 Agent workspace_path
    let row = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT workspace_path FROM agents WHERE id = ?"
    ).bind(&agent_id)
    .fetch_optional(state.orchestrator.pool()).await
    .map_err(|e| format!("查询失败: {}", e))?
    .ok_or("Agent 不存在")?;

    let workspace_path = row.0.ok_or("Agent 未初始化工作区")?;
    let workspace = agent::AgentWorkspace::from_path(
        std::path::PathBuf::from(&workspace_path), &agent_id
    );

    // 读取 TOOLS.md 获取 profile 和 overrides
    let tools_content = workspace.read_file(&agent::workspace::SoulFile::Tools)
        .unwrap_or_default();
    let (profile, overrides) = parse_tools_config(&tools_content);

    // 获取所有注册工具的定义
    let tool_defs = state.orchestrator.tool_manager().get_tool_definitions();
    let mut tools = Vec::new();
    for def in &tool_defs {
        let safety = state.orchestrator.tool_manager()
            .get_safety_level(&def.name)
            .unwrap_or(agent::ToolSafetyLevel::Safe);
        let enabled = is_tool_enabled(&def.name, &profile, &overrides);
        tools.push(serde_json::json!({
            "name": def.name,
            "description": def.description,
            "safety": format!("{:?}", safety),
            "enabled": enabled,
            "source": "builtin",
        }));
    }

    Ok(serde_json::json!({
        "profile": profile,
        "tools": tools,
        "overrides": overrides,
    }))
}

/// 解析 TOOLS.md 配置
fn parse_tools_config(content: &str) -> (String, std::collections::HashMap<String, bool>) {
    let mut profile = "full".to_string();
    let mut overrides = std::collections::HashMap::new();
    let mut in_overrides = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "## Profile" { in_overrides = false; continue; }
        if trimmed == "## Overrides" { in_overrides = true; continue; }
        if trimmed.starts_with('#') { in_overrides = false; continue; }
        if trimmed.is_empty() { continue; }

        if !in_overrides && !trimmed.starts_with('-') && !trimmed.starts_with('#') {
            profile = trimmed.to_string();
        }
        if in_overrides && trimmed.starts_with("- ") {
            // 格式: - tool_name: enabled/disabled
            if let Some((name, status)) = trimmed[2..].split_once(':') {
                let name = name.trim().to_string();
                let enabled = status.trim() == "enabled";
                overrides.insert(name, enabled);
            }
        }
    }
    (profile, overrides)
}

/// 根据 profile 和 overrides 判断工具是否启用
fn is_tool_enabled(
    tool_name: &str,
    profile: &str,
    overrides: &std::collections::HashMap<String, bool>,
) -> bool {
    // 先检查 overrides
    if let Some(&enabled) = overrides.get(tool_name) {
        return enabled;
    }
    // 按 profile 默认值
    match profile {
        "basic" => matches!(tool_name, "calculator" | "datetime"),
        "coding" => matches!(tool_name, "calculator" | "datetime" | "file_read" | "memory_read" | "memory_write"),
        _ => true, // "full" 或未知 → 全部启用
    }
}
```

**Step 2: 添加 set_agent_tool_profile 命令**

```rust
/// 设置 Agent 工具 Profile
#[tauri::command]
async fn set_agent_tool_profile(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    profile: String,
) -> Result<(), String> {
    let row = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT workspace_path FROM agents WHERE id = ?"
    ).bind(&agent_id)
    .fetch_optional(state.orchestrator.pool()).await
    .map_err(|e| format!("查询失败: {}", e))?
    .ok_or("Agent 不存在")?;

    let workspace_path = row.0.ok_or("Agent 未初始化工作区")?;
    let workspace = agent::AgentWorkspace::from_path(
        std::path::PathBuf::from(&workspace_path), &agent_id
    );

    // 读取现有 overrides
    let tools_content = workspace.read_file(&agent::workspace::SoulFile::Tools)
        .unwrap_or_default();
    let (_, overrides) = parse_tools_config(&tools_content);

    // 重写 TOOLS.md
    let new_content = format_tools_config(&profile, &overrides);
    workspace.write_file(&agent::workspace::SoulFile::Tools, &new_content)
}

/// 格式化 TOOLS.md 内容
fn format_tools_config(
    profile: &str,
    overrides: &std::collections::HashMap<String, bool>,
) -> String {
    let mut content = format!("# Tools Configuration\n\n## Profile\n{}\n", profile);
    if !overrides.is_empty() {
        content.push_str("\n## Overrides\n");
        let mut sorted: Vec<_> = overrides.iter().collect();
        sorted.sort_by_key(|(k, _)| k.clone());
        for (name, enabled) in sorted {
            content.push_str(&format!("- {}: {}\n", name, if *enabled { "enabled" } else { "disabled" }));
        }
    }
    content
}
```

**Step 3: 添加 set_agent_tool_override 命令**

```rust
/// 设置单个工具的覆盖状态
#[tauri::command]
async fn set_agent_tool_override(
    state: State<'_, Arc<AppState>>,
    agent_id: String,
    tool_name: String,
    enabled: bool,
) -> Result<(), String> {
    let row = sqlx::query_as::<_, (Option<String>,)>(
        "SELECT workspace_path FROM agents WHERE id = ?"
    ).bind(&agent_id)
    .fetch_optional(state.orchestrator.pool()).await
    .map_err(|e| format!("查询失败: {}", e))?
    .ok_or("Agent 不存在")?;

    let workspace_path = row.0.ok_or("Agent 未初始化工作区")?;
    let workspace = agent::AgentWorkspace::from_path(
        std::path::PathBuf::from(&workspace_path), &agent_id
    );

    let tools_content = workspace.read_file(&agent::workspace::SoulFile::Tools)
        .unwrap_or_default();
    let (profile, mut overrides) = parse_tools_config(&tools_content);

    // 如果覆盖值和 profile 默认值相同，移除覆盖
    let default_enabled = is_tool_enabled(&tool_name, &profile, &std::collections::HashMap::new());
    if enabled == default_enabled {
        overrides.remove(&tool_name);
    } else {
        overrides.insert(tool_name, enabled);
    }

    let new_content = format_tools_config(&profile, &overrides);
    workspace.write_file(&agent::workspace::SoulFile::Tools, &new_content)
}
```

**Step 4: 给 Orchestrator 添加 tool_manager() 只读访问方法**

在 `src/agent/orchestrator.rs` 的 `impl Orchestrator` 中添加（在 `tool_manager_mut` 方法之后）：

```rust
/// 获取工具管理器的只读引用
pub fn tool_manager(&self) -> &ToolManager {
    &self.tool_manager
}
```

**Step 5: 注册 3 个新命令**

在 `invoke_handler` 的 `generate_handler![]` 数组中添加 `get_agent_tools`、`set_agent_tool_profile`、`set_agent_tool_override`。

**Step 6: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 7: Commit**

```bash
git add src/main.rs src/agent/orchestrator.rs
git commit -m "feat: 添加工具配置相关 Tauri 命令"
```

---

### Task 3: 后端 — Orchestrator 集成工具过滤

**Files:**
- Modify: `local-app/src/agent/orchestrator.rs` (send_message_stream 读取 TOOLS.md 过滤工具)

**Step 1: 修改 run_agent_loop 使用过滤后的工具定义**

在 `send_message_stream` 方法中，在调用 `run_agent_loop` 之前，读取 TOOLS.md 过滤工具：

```rust
// 6. 读取 Agent 工具配置，过滤工具定义
let filtered_tool_defs = {
    let tools_content = if let Some(ref wp) = agent.workspace_path {
        let ws = AgentWorkspace::from_path(std::path::PathBuf::from(wp), agent_id);
        ws.read_file(&super::workspace::SoulFile::Tools).unwrap_or_default()
    } else {
        String::new()
    };

    let (profile, overrides) = crate::parse_tools_config(&tools_content);
    self.tool_manager.get_tool_definitions()
        .into_iter()
        .filter(|def| crate::is_tool_enabled(&def.name, &profile, &overrides))
        .collect::<Vec<_>>()
};
```

然后修改 `run_agent_loop` 接收工具定义列表作为参数，而不是从 `self.tool_manager` 获取。

**注意**: `parse_tools_config` 和 `is_tool_enabled` 函数需要从 main.rs 移动到 `src/agent/tools.rs` 作为公共函数，然后在 main.rs 和 orchestrator.rs 中都能调用。

**Step 2: 将 parse_tools_config 和 is_tool_enabled 移到 tools.rs**

在 `src/agent/tools.rs` 末尾（tests 之前）添加这两个函数作为 pub fn，然后在 main.rs 中改为 `use crate::agent::tools::{parse_tools_config, is_tool_enabled};`。

**Step 3: 编译验证**

Run: `cargo check`
Expected: 无错误

**Step 4: 运行测试**

Run: `cargo test`
Expected: 96+ tests pass

**Step 5: Commit**

```bash
git add src/agent/orchestrator.rs src/agent/tools.rs src/main.rs
git commit -m "feat: Orchestrator 集成 TOOLS.md 工具过滤"
```

---

### Task 4: 前端 — 配置面板框架 + Tab 切换

**Files:**
- Create: `frontend/src/components/AgentConfigPanel.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx`

**Step 1: 创建 AgentConfigPanel 组件**

```tsx
import { useState } from 'react'

interface AgentConfigPanelProps {
  agentId: string
  onClose: () => void
}

type TabId = 'soul' | 'tools' | 'params'

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: 'soul', icon: '🎭', label: '灵魂' },
  { id: 'tools', icon: '🔧', label: '工具' },
  { id: 'params', icon: '⚙️', label: '参数' },
]

export default function AgentConfigPanel({ agentId, onClose }: AgentConfigPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('soul')

  return (
    <div style={{
      width: '300px', borderLeft: '1px solid #ddd',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>
      {/* Tab 栏 */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #eee',
        padding: '8px 8px 0', gap: '2px',
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            style={{
              flex: 1, padding: '8px 4px', border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #007bff' : '2px solid transparent',
              background: 'none', cursor: 'pointer', fontSize: '16px',
              opacity: activeTab === tab.id ? 1 : 0.5,
            }}
          >
            {tab.icon}
          </button>
        ))}
        <button
          onClick={onClose}
          style={{
            padding: '8px', border: 'none', background: 'none',
            cursor: 'pointer', fontSize: '14px', color: '#999',
          }}
        >✕</button>
      </div>

      {/* Tab 内容 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {activeTab === 'soul' && <div>灵魂文件 (TODO)</div>}
        {activeTab === 'tools' && <div>工具管理 (TODO)</div>}
        {activeTab === 'params' && <div>参数调优 (TODO)</div>}
      </div>
    </div>
  )
}
```

**Step 2: 在 ChatPage 中集成配置面板**

在 ChatPage.tsx 中：
- 添加 `const [showConfig, setShowConfig] = useState(false)`
- Agent 列表选中项旁添加 ⚙ 按钮，点击 `setShowConfig(!showConfig)`
- 右侧内容区后面条件渲染 `<AgentConfigPanel>`
- import AgentConfigPanel 组件

**Step 3: TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/components/AgentConfigPanel.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat: 配置面板框架 + Tab 切换"
```

---

### Task 5: 前端 — 灵魂文件 Tab（表单模式）

**Files:**
- Create: `frontend/src/components/SoulFileTab.tsx`
- Modify: `frontend/src/components/AgentConfigPanel.tsx`

**Step 1: 创建 SoulFileTab 组件**

```tsx
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface SoulFileTabProps {
  agentId: string
}

type ViewMode = 'form' | 'raw'

interface SoulFileInfo {
  name: string
  exists: boolean
  size: number
}

export default function SoulFileTab({ agentId }: SoulFileTabProps) {
  const [mode, setMode] = useState<ViewMode>('form')

  // 表单模式状态
  const [formData, setFormData] = useState({
    name: '', emoji: '', creature: '', vibe: '',
    personality: '', style: '', values: '',
    userName: '', timezone: '', language: '',
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // 原始模式状态
  const [files, setFiles] = useState<SoulFileInfo[]>([])
  const [selectedFile, setSelectedFile] = useState('')
  const [rawContent, setRawContent] = useState('')
  const [rawDirty, setRawDirty] = useState(false)

  // 加载灵魂文件列表
  const loadFiles = async () => {
    try {
      const list = await invoke<SoulFileInfo[]>('list_soul_files', { agentId })
      setFiles(list || [])
    } catch { /* 忽略 */ }
  }

  // 解析 IDENTITY.md 和 SOUL.md 到表单字段
  const loadFormData = async () => {
    try {
      const identity = await invoke<string>('read_soul_file', {
        agentId, fileName: 'IDENTITY.md'
      }).catch(() => '')
      const soul = await invoke<string>('read_soul_file', {
        agentId, fileName: 'SOUL.md'
      }).catch(() => '')
      const user = await invoke<string>('read_soul_file', {
        agentId, fileName: 'USER.md'
      }).catch(() => '')

      setFormData({
        name: extractField(identity, 'name') || '',
        emoji: extractField(identity, 'emoji') || '',
        creature: extractField(identity, 'creature') || '',
        vibe: extractField(identity, 'vibe') || '',
        personality: extractSection(soul, 'personality') || '',
        style: extractSection(soul, 'communication') || extractSection(soul, 'style') || '',
        values: extractSection(soul, 'values') || '',
        userName: extractField(user, 'name') || '',
        timezone: extractField(user, 'timezone') || 'UTC+8',
        language: extractField(user, 'language') || '中文',
      })
      setDirty(false)
    } catch { /* 忽略 */ }
  }

  useEffect(() => {
    loadFiles()
    loadFormData()
  }, [agentId])

  // 保存表单到灵魂文件
  const handleSaveForm = async () => {
    setSaving(true)
    setMessage('')
    try {
      const identityContent = `# Identity\n\n- name: ${formData.name}\n- emoji: ${formData.emoji}\n- creature: ${formData.creature}\n- vibe: ${formData.vibe}\n`
      await invoke('write_soul_file', {
        agentId, fileName: 'IDENTITY.md', content: identityContent
      })

      const soulContent = `# Soul\n\n## Personality\n${formData.personality}\n\n## Communication Style\n${formData.style}\n\n## Core Values\n${formData.values}\n`
      await invoke('write_soul_file', {
        agentId, fileName: 'SOUL.md', content: soulContent
      })

      const userContent = `# User\n\n- name: ${formData.userName}\n- timezone: ${formData.timezone}\n- language: ${formData.language}\n`
      await invoke('write_soul_file', {
        agentId, fileName: 'USER.md', content: userContent
      })

      setDirty(false)
      setMessage('已保存')
      setTimeout(() => setMessage(''), 2000)
    } catch (e: any) {
      setMessage('保存失败: ' + (e?.message || e))
    }
    setSaving(false)
  }

  // 原始模式：加载文件内容
  const handleSelectFile = async (fileName: string) => {
    if (rawDirty && !confirm('有未保存的修改，确定切换？')) return
    setSelectedFile(fileName)
    try {
      const content = await invoke<string>('read_soul_file', { agentId, fileName })
      setRawContent(content)
    } catch {
      setRawContent('')
    }
    setRawDirty(false)
  }

  // 原始模式：保存
  const handleSaveRaw = async () => {
    if (!selectedFile) return
    setSaving(true)
    try {
      await invoke('write_soul_file', {
        agentId, fileName: selectedFile, content: rawContent
      })
      setRawDirty(false)
      setMessage('已保存')
      setTimeout(() => setMessage(''), 2000)
    } catch (e: any) {
      setMessage('保存失败: ' + (e?.message || e))
    }
    setSaving(false)
  }

  const updateForm = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  // 表单模式 UI
  if (mode === 'form') {
    return (
      <div>
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          <button onClick={() => setMode('form')} style={{ fontWeight: 'bold', padding: '4px 8px', border: '1px solid #007bff', borderRadius: '4px', background: '#e3f2fd', fontSize: '12px' }}>表单</button>
          <button onClick={() => { setMode('raw'); loadFiles() }} style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: '4px', background: 'white', fontSize: '12px', cursor: 'pointer' }}>原始</button>
        </div>

        <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 600 }}>基本信息</div>
        {[
          { key: 'name', label: '名称', placeholder: '如: 通用助手' },
          { key: 'emoji', label: 'Emoji', placeholder: '如: 🤖' },
          { key: 'creature', label: '类型', placeholder: '如: AI 助手' },
          { key: 'vibe', label: '气质', placeholder: '如: 友善专业' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom: '6px' }}>
            <label style={{ fontSize: '11px', color: '#999' }}>{f.label}</label>
            <input value={(formData as any)[f.key]} onChange={e => updateForm(f.key, e.target.value)} placeholder={f.placeholder} style={{ width: '100%', padding: '4px 6px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '13px', boxSizing: 'border-box' }} />
          </div>
        ))}

        <div style={{ fontSize: '12px', color: '#666', margin: '12px 0 8px', fontWeight: 600 }}>性格与风格</div>
        {[
          { key: 'personality', label: '性格特征', placeholder: '如: 友善、耐心、专业' },
          { key: 'style', label: '沟通风格', placeholder: '如: 简洁明了' },
          { key: 'values', label: '核心价值观', placeholder: '如: 准确性优先' },
        ].map(f => (
          <div key={f.key} style={{ marginBottom: '6px' }}>
            <label style={{ fontSize: '11px', color: '#999' }}>{f.label}</label>
            <textarea value={(formData as any)[f.key]} onChange={e => updateForm(f.key, e.target.value)} placeholder={f.placeholder} rows={2} style={{ width: '100%', padding: '4px 6px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '13px', boxSizing: 'border-box', resize: 'vertical' }} />
          </div>
        ))}

        <div style={{ fontSize: '12px', color: '#666', margin: '12px 0 8px', fontWeight: 600 }}>用户信息</div>
        <div style={{ marginBottom: '6px' }}>
          <label style={{ fontSize: '11px', color: '#999' }}>称呼</label>
          <input value={formData.userName} onChange={e => updateForm('userName', e.target.value)} placeholder="你的名字" style={{ width: '100%', padding: '4px 6px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '13px', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', color: '#999' }}>时区</label>
            <select value={formData.timezone} onChange={e => updateForm('timezone', e.target.value)} style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '13px' }}>
              <option value="UTC+8">UTC+8 (北京)</option>
              <option value="UTC+9">UTC+9 (东京)</option>
              <option value="UTC+0">UTC+0 (伦敦)</option>
              <option value="UTC-5">UTC-5 (纽约)</option>
              <option value="UTC-8">UTC-8 (旧金山)</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', color: '#999' }}>语言</label>
            <select value={formData.language} onChange={e => updateForm('language', e.target.value)} style={{ width: '100%', padding: '4px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '13px' }}>
              <option value="中文">中文</option>
              <option value="English">English</option>
              <option value="日本語">日本語</option>
            </select>
          </div>
        </div>

        {message && <div style={{ fontSize: '12px', color: message.includes('失败') ? 'red' : 'green', marginTop: '8px' }}>{message}</div>}

        <button onClick={handleSaveForm} disabled={!dirty || saving} style={{
          width: '100%', padding: '8px', marginTop: '12px',
          backgroundColor: dirty ? '#007bff' : '#ccc', color: 'white',
          border: 'none', borderRadius: '4px', cursor: dirty ? 'pointer' : 'not-allowed',
          fontSize: '13px',
        }}>
          {saving ? '保存中...' : dirty ? '保存' : '无修改'}
        </button>
      </div>
    )
  }

  // 原始模式 UI
  return (
    <div>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <button onClick={() => { setMode('form'); loadFormData() }} style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: '4px', background: 'white', fontSize: '12px', cursor: 'pointer' }}>表单</button>
        <button onClick={() => setMode('raw')} style={{ fontWeight: 'bold', padding: '4px 8px', border: '1px solid #007bff', borderRadius: '4px', background: '#e3f2fd', fontSize: '12px' }}>原始</button>
      </div>

      <div style={{ marginBottom: '8px' }}>
        {files.map(f => (
          <div key={f.name} onClick={() => handleSelectFile(f.name)} style={{
            padding: '4px 8px', marginBottom: '2px', borderRadius: '3px', cursor: 'pointer',
            fontSize: '12px', display: 'flex', justifyContent: 'space-between',
            backgroundColor: selectedFile === f.name ? '#e3f2fd' : 'transparent',
            color: f.exists ? '#333' : '#ccc',
          }}>
            <span>{f.name}</span>
            <span style={{ color: '#999' }}>{f.exists ? `${f.size} B` : '(不存在)'}</span>
          </div>
        ))}
      </div>

      {selectedFile && (
        <textarea value={rawContent} onChange={e => { setRawContent(e.target.value); setRawDirty(true) }}
          style={{
            width: '100%', height: '250px', padding: '8px', border: '1px solid #ddd',
            borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace',
            boxSizing: 'border-box', resize: 'vertical',
          }}
        />
      )}

      {message && <div style={{ fontSize: '12px', color: message.includes('失败') ? 'red' : 'green', marginTop: '8px' }}>{message}</div>}

      {selectedFile && (
        <button onClick={handleSaveRaw} disabled={!rawDirty || saving} style={{
          width: '100%', padding: '8px', marginTop: '8px',
          backgroundColor: rawDirty ? '#007bff' : '#ccc', color: 'white',
          border: 'none', borderRadius: '4px', cursor: rawDirty ? 'pointer' : 'not-allowed',
          fontSize: '13px',
        }}>
          {saving ? '保存中...' : rawDirty ? '保存' : '无修改'}
        </button>
      )}
    </div>
  )
}

// 辅助函数：从 markdown 中提取 `- key: value` 格式的字段
function extractField(content: string, key: string): string | null {
  const regex = new RegExp(`^\\s*-\\s*${key}:\\s*(.+)$`, 'mi')
  const match = content.match(regex)
  return match ? match[1].trim() : null
}

// 辅助函数：从 markdown 中提取 `## Section` 下的内容
function extractSection(content: string, sectionName: string): string | null {
  const regex = new RegExp(`##\\s*${sectionName}[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i')
  const match = content.match(regex)
  return match ? match[1].trim() : null
}
```

**Step 2: 在 AgentConfigPanel 中引入 SoulFileTab**

替换 `{activeTab === 'soul' && <div>灵魂文件 (TODO)</div>}` 为 `{activeTab === 'soul' && <SoulFileTab agentId={agentId} />}`。

**Step 3: TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/components/SoulFileTab.tsx frontend/src/components/AgentConfigPanel.tsx
git commit -m "feat: 灵魂文件 Tab 表单+原始双模式编辑"
```

---

### Task 6: 前端 — 工具管理 Tab

**Files:**
- Create: `frontend/src/components/ToolsTab.tsx`
- Modify: `frontend/src/components/AgentConfigPanel.tsx`

**Step 1: 创建 ToolsTab 组件**

```tsx
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface ToolsTabProps {
  agentId: string
}

interface ToolInfo {
  name: string
  description: string
  safety: string
  enabled: boolean
  source: string
}

const PROFILES = [
  { id: 'basic', label: '基础', desc: 'calculator, datetime' },
  { id: 'coding', label: '编程', desc: '+ file_read, memory_*' },
  { id: 'full', label: '完整', desc: '所有内置工具' },
]

const SAFETY_COLORS: Record<string, { bg: string; color: string }> = {
  Safe: { bg: '#e8f5e9', color: '#2e7d32' },
  Guarded: { bg: '#fff8e1', color: '#f57f17' },
  Sandboxed: { bg: '#fff3e0', color: '#e65100' },
  Approval: { bg: '#fce4ec', color: '#c62828' },
}

export default function ToolsTab({ agentId }: ToolsTabProps) {
  const [profile, setProfile] = useState('full')
  const [tools, setTools] = useState<ToolInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const loadTools = async () => {
    try {
      const result = await invoke<{ profile: string; tools: ToolInfo[] }>('get_agent_tools', { agentId })
      setProfile(result.profile)
      setTools(result.tools)
    } catch { /* 忽略 */ }
    setLoading(false)
  }

  useEffect(() => { loadTools() }, [agentId])

  const handleProfileChange = async (newProfile: string) => {
    setProfile(newProfile)
    try {
      await invoke('set_agent_tool_profile', { agentId, profile: newProfile })
      await loadTools()
      setMessage('已切换')
      setTimeout(() => setMessage(''), 1500)
    } catch (e: any) {
      setMessage('切换失败: ' + (e?.message || e))
    }
  }

  const handleToggle = async (toolName: string, enabled: boolean) => {
    try {
      await invoke('set_agent_tool_override', { agentId, toolName, enabled })
      await loadTools()
    } catch { /* 忽略 */ }
  }

  if (loading) return <div style={{ color: '#999', fontSize: '13px' }}>加载中...</div>

  // 检查是否有自定义覆盖
  const isCustom = !PROFILES.some(p => p.id === profile)

  return (
    <div>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 600 }}>工具配置模式</div>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        {PROFILES.map(p => (
          <button key={p.id} onClick={() => handleProfileChange(p.id)}
            title={p.desc}
            style={{
              flex: 1, padding: '6px 4px', fontSize: '12px',
              border: profile === p.id ? '1px solid #007bff' : '1px solid #ddd',
              borderRadius: '4px', cursor: 'pointer',
              backgroundColor: profile === p.id ? '#e3f2fd' : 'white',
              fontWeight: profile === p.id ? 600 : 400,
            }}
          >{p.label}</button>
        ))}
      </div>

      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
        工具列表 {isCustom && <span style={{ color: '#f57f17', fontWeight: 400 }}>(自定义)</span>}
      </div>

      {tools.map(tool => {
        const safetyStyle = SAFETY_COLORS[tool.safety] || SAFETY_COLORS.Safe
        return (
          <div key={tool.name} style={{
            padding: '8px', marginBottom: '4px', borderRadius: '4px',
            border: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <input type="checkbox" checked={tool.enabled}
              onChange={e => handleToggle(tool.name, e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>{tool.name}</div>
              <div style={{ fontSize: '11px', color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.description}</div>
            </div>
            <span style={{
              fontSize: '10px', padding: '2px 6px', borderRadius: '8px',
              backgroundColor: safetyStyle.bg, color: safetyStyle.color,
              whiteSpace: 'nowrap',
            }}>{tool.safety}</span>
          </div>
        )
      })}

      {message && <div style={{ fontSize: '12px', color: 'green', marginTop: '8px' }}>{message}</div>}
    </div>
  )
}
```

**Step 2: 在 AgentConfigPanel 中引入 ToolsTab**

替换 `{activeTab === 'tools' && <div>工具管理 (TODO)</div>}` 为 `{activeTab === 'tools' && <ToolsTab agentId={agentId} />}`。

**Step 3: TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/components/ToolsTab.tsx frontend/src/components/AgentConfigPanel.tsx
git commit -m "feat: 工具管理 Tab Profile预设+开关"
```

---

### Task 7: 前端 — 参数 Tab

**Files:**
- Create: `frontend/src/components/ParamsTab.tsx`
- Modify: `frontend/src/components/AgentConfigPanel.tsx`

**Step 1: 创建 ParamsTab 组件**

```tsx
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface ParamsTabProps {
  agentId: string
  allModels: { id: string; label: string; provider: string; providerName: string; available: boolean }[]
}

interface AgentInfo {
  id: string
  model: string
  temperature: number
  maxTokens: number
}

const PRESETS = [
  { id: 'precise', label: '精确', temp: 0.2, desc: '严谨准确' },
  { id: 'balanced', label: '均衡', temp: 0.7, desc: '平衡创造力' },
  { id: 'creative', label: '创造', temp: 1.2, desc: '更有创意' },
]

export default function ParamsTab({ agentId, allModels }: ParamsTabProps) {
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  // 加载当前 Agent 参数
  useEffect(() => {
    const loadAgent = async () => {
      try {
        const agents = await invoke<AgentInfo[]>('list_agents')
        const agent = agents?.find(a => a.id === agentId)
        if (agent) {
          setModel(agent.model)
          setTemperature(agent.temperature ?? 0.7)
          setMaxTokens(agent.maxTokens ?? 2048)
        }
      } catch { /* 忽略 */ }
      setDirty(false)
    }
    loadAgent()
  }, [agentId])

  // 当前匹配的预设
  const currentPreset = PRESETS.find(p => Math.abs(p.temp - temperature) < 0.05)

  const handlePreset = (temp: number) => {
    setTemperature(temp)
    setDirty(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage('')
    try {
      await invoke('update_agent', {
        agentId, model, temperature, maxTokens,
      })
      setDirty(false)
      setMessage('已保存')
      setTimeout(() => setMessage(''), 2000)
    } catch (e: any) {
      setMessage('保存失败: ' + (e?.message || e))
    }
    setSaving(false)
  }

  const availableModels = allModels.filter(m => m.available)

  return (
    <div>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 600 }}>生成风格</div>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => handlePreset(p.temp)} style={{
            flex: 1, padding: '6px 4px', fontSize: '12px',
            border: currentPreset?.id === p.id ? '1px solid #007bff' : '1px solid #ddd',
            borderRadius: '4px', cursor: 'pointer',
            backgroundColor: currentPreset?.id === p.id ? '#e3f2fd' : 'white',
            fontWeight: currentPreset?.id === p.id ? 600 : 400,
          }}>{p.label}</button>
        ))}
      </div>
      <div style={{ fontSize: '11px', color: '#999', marginBottom: '12px' }}>
        {currentPreset ? currentPreset.desc : '自定义'}
      </div>

      <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 600 }}>模型</div>
      <select value={model} onChange={e => { setModel(e.target.value); setDirty(true) }} style={{
        width: '100%', padding: '6px', border: '1px solid #ddd', borderRadius: '4px',
        fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box',
      }}>
        {availableModels.map(m => (
          <option key={`${m.provider}-${m.id}`} value={m.id}>
            {m.label} ({m.providerName})
          </option>
        ))}
      </select>

      <div onClick={() => setShowAdvanced(!showAdvanced)} style={{
        fontSize: '12px', color: '#666', cursor: 'pointer', marginBottom: '8px',
        fontWeight: 600, userSelect: 'none',
      }}>
        {showAdvanced ? '▼' : '▶'} 高级参数
      </div>

      {showAdvanced && (
        <div style={{ padding: '8px', border: '1px solid #eee', borderRadius: '4px', marginBottom: '12px' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '11px', color: '#999', display: 'flex', justifyContent: 'space-between' }}>
              <span>Temperature</span><span>{temperature.toFixed(1)}</span>
            </label>
            <input type="range" min="0" max="2" step="0.1" value={temperature}
              onChange={e => { setTemperature(parseFloat(e.target.value)); setDirty(true) }}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '11px', color: '#999' }}>Max Tokens</label>
            <input type="number" value={maxTokens} min={256} max={128000} step={256}
              onChange={e => { setMaxTokens(parseInt(e.target.value) || 2048); setDirty(true) }}
              style={{ width: '100%', padding: '4px 6px', border: '1px solid #ddd', borderRadius: '3px', fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      )}

      {message && <div style={{ fontSize: '12px', color: message.includes('失败') ? 'red' : 'green', marginTop: '8px' }}>{message}</div>}

      <button onClick={handleSave} disabled={!dirty || saving} style={{
        width: '100%', padding: '8px',
        backgroundColor: dirty ? '#007bff' : '#ccc', color: 'white',
        border: 'none', borderRadius: '4px', cursor: dirty ? 'pointer' : 'not-allowed',
        fontSize: '13px',
      }}>
        {saving ? '保存中...' : dirty ? '保存' : '无修改'}
      </button>
    </div>
  )
}
```

**Step 2: 在 AgentConfigPanel 中引入 ParamsTab**

AgentConfigPanel 需要接收 `allModels` prop 并传递给 ParamsTab。

替换 `{activeTab === 'params' && <div>参数调优 (TODO)</div>}` 为 `{activeTab === 'params' && <ParamsTab agentId={agentId} allModels={allModels} />}`。

更新 AgentConfigPanelProps 添加 `allModels` 属性。ChatPage 中传入 `allModels={allModels}`。

**Step 3: TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: 无错误

**Step 4: Commit**

```bash
git add frontend/src/components/ParamsTab.tsx frontend/src/components/AgentConfigPanel.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat: 参数 Tab 三档预设+高级参数"
```

---

### Task 8: 集成验证 — 构建 + 测试

**Step 1: 后端编译 + 测试**

Run: `cargo check && cargo test`
Expected: 编译通过，96+ tests pass

**Step 2: 前端编译**

Run: `cd frontend && npx tsc --noEmit && npm run build`
Expected: 无错误，dist/ 生成

**Step 3: Tauri 打包**

Run: `cargo tauri build`
Expected: .app 生成成功

**Step 4: 手动验证**

启动应用，验证：
1. 点击 Agent 旁 ⚙ 图标 → 配置面板打开/关闭
2. 灵魂 Tab → 表单模式能读取/编辑/保存；原始模式能选择文件编辑
3. 工具 Tab → Profile 切换、单个工具开关
4. 参数 Tab → 预设切换、模型选择、高级参数

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Phase 10a - Agent 配置面板（灵魂文件+工具+参数）"
```
