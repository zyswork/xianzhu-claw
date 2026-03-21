# Agent 配置系统设计文档

> 日期: 2026-03-17
> 范围: 灵魂文件编辑 + 工具管理 + 参数调优 + MCP Client

## 1. 目标

为 OpenClaw Agent 提供完整的配置管理界面，让用户能在对话页中直接配置 Agent 的人格、工具、参数和 MCP 连接，无需离开对话上下文。

## 2. 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| UI 入口 | 对话页右侧可折叠面板 | 不离开对话上下文，操作效率高 |
| 灵魂文件编辑 | 表单 + 原始 Markdown 切换 | 低门槛（表单）+ 灵活性（原始） |
| 工具管理 | Profile 预设 + 细粒度覆盖 | 借鉴 OpenClaw Tool Profile，比纯开关高效 |
| MCP 格式 | 兼容 Claude Desktop mcp.json | 借鉴 OpenCrust，用户可复用已有配置 |
| 参数调优 | 三档预设 + 高级展开 | 借鉴 Coze，降低 temperature 等参数认知门槛 |
| 工具/MCP 粒度 | Agent 级别 | 不同 Agent 可配置不同工具集和 MCP Server |

## 3. 整体布局

```
┌─ Agent列表(220px) ─┬──── 对话区(flex) ────┬── 配置面板(300px) ──┐
│ 通用助手     ⚙     │  [模型标签]           │ [🎭][🔧][⚙️][🔌]    │
│ 编程助手           │  消息...              │                      │
│                    │  🔧 正在调用 calc...  │  (当前 Tab 内容)     │
│ + 自定义           │  [输入框]     [发送]  │  [保存]              │
└────────────────────┴──────────────────────┴──────────────────────┘
```

- Agent 列表选中项显示 ⚙ 图标，点击切换配置面板开/关
- 面板默认关闭，打开时对话区自动收窄
- 4 个 Tab 用图标按钮切换
- 面板底部固定保存按钮，有未保存变更时高亮
- 切换 Agent 时自动加载对应配置

## 4. Tab 1: 灵魂文件 🎭

### 表单模式（默认）

从 IDENTITY.md 和 SOUL.md 解析关键字段：

- **基本信息**: 名称、Emoji、类型
- **性格与风格**: 性格特征、沟通风格、核心价值观
- **用户信息** (USER.md): 用户称呼、时区、偏好语言

保存时将表单字段写回对应 md 文件，保持现有格式。

### 原始模式

- 左侧列出 8 个文件（IDENTITY/SOUL/AGENTS/USER/TOOLS/MEMORY/BOOTSTRAP/HEARTBEAT）
- 显示文件大小，不存在的文件灰色
- 点击文件加载内容到 textarea 编辑器
- 点击不存在的文件创建空文件

### 后端

无改动。使用已有命令：`list_soul_files`、`read_soul_file`、`write_soul_file`。

## 5. Tab 2: 工具管理 🔧

### Tool Profile 预设

三档预设 + 自定义覆盖：

| Profile | 包含工具 |
|---------|---------|
| 基础 | calculator, datetime |
| 编程 | + file_read, memory_read, memory_write |
| 完整 | 所有内置工具 |

选择预设自动勾选对应工具集。手动覆盖单个工具后预设显示为"自定义"。

### 工具列表

- 每个工具显示：名称、描述、安全级别标签（颜色区分）、开关 toggle
- 安全级别：Safe(绿) / Guarded(黄) / Sandboxed(橙) / Approval(红)
- MCP 工具在底部单独分组，显示来源 Server 名

### 数据存储

工具配置写入 Agent workspace 的 TOOLS.md：

```markdown
# Tools Configuration

## Profile
full

## Overrides
- web_search: disabled
```

### 后端新增

- `get_agent_tools(agent_id)` → 读取 TOOLS.md + 合并 ToolManager 定义 + MCP 工具
- `set_agent_tool_profile(agent_id, profile)` → 写入 TOOLS.md
- `set_agent_tool_override(agent_id, tool_name, enabled)` → 写入 TOOLS.md

Orchestrator 在 `send_message_stream` 时读取 TOOLS.md，只传 enabled 工具给 LLM。

## 6. Tab 3: 参数 ⚙️

### 三档预设

| 预设 | Temperature | 描述 |
|------|-------------|------|
| 精确 | 0.2 | 严谨准确，适合事实查询 |
| 均衡 | 0.7 | 平衡创造力（默认） |
| 创造 | 1.2 | 更有创意，适合写作 |

手动调 temperature 后预设显示"自定义"。

### 模型选择

下拉框只显示已配置 API Key 的供应商的模型。

### 高级参数（默认折叠）

- Temperature: 滑块 + 数值（0-2，步进 0.1）
- Max Tokens: 输入框
- 上下文窗口（对话轮数）: 滑块 + 数值

### 后端新增

- `update_agent(agent_id, updates)` → 更新 agents DB 表

## 7. Tab 4: MCP 🔌

### MCP Server 列表

每个 Server 显示：名称 + 状态指示器 + 展开后的工具列表。

状态机：
- 🟢 connected: 已连接，工具列表已加载
- 🟡 configured: 已保存配置，未启动
- 🔴 failed/disconnected: 连接失败，显示错误信息

### 添加 MCP Server

表单字段：
- 名称
- 类型：stdio / HTTP
- stdio: 命令 + 参数
- HTTP: URL
- 环境变量（key=value 列表，可增减）
- 测试连接按钮

### 导入 Claude Desktop 配置

读取 `~/Library/Application Support/Claude/claude_desktop_config.json` 的 `mcpServers` 字段，批量添加。用户确认后保存。

### 数据存储

新增 DB 表：

```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  transport TEXT NOT NULL,      -- "stdio" / "http"
  command TEXT,                 -- stdio 启动命令
  args TEXT,                    -- JSON 数组
  url TEXT,                     -- http URL
  env TEXT,                     -- JSON 环境变量
  enabled INTEGER DEFAULT 1,
  status TEXT DEFAULT 'configured',
  created_at INTEGER,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

### 后端新增

**MCP Client 模块** (`agent/mcp.rs`)：
- `McpClient` struct: 管理 stdio 子进程或 HTTP 连接
- JSON-RPC 2.0: `initialize` → `tools/list` → `tools/call`
- stdio 传输: `tokio::process::Command` 启动子进程，stdin/stdout 通信
- HTTP 传输: SSE 连接 + HTTP POST 调用

**新 Tauri 命令**：
- `list_mcp_servers(agent_id)` → 列表 + 状态
- `add_mcp_server(agent_id, config)` → 保存到 DB
- `remove_mcp_server(server_id)` → 删除
- `test_mcp_connection(server_id)` → 连接测试，返回工具列表或错误
- `import_claude_mcp_config()` → 读取 Claude Desktop 配置

**与 ToolManager 集成**：
- Agent 发消息时，Orchestrator 启动该 Agent 配置的 MCP Server
- MCP 工具注册到 ToolManager，命名空间 `server_name.tool_name`
- MCP 工具的 execute 实现为 JSON-RPC `tools/call`

## 8. 竞品参考

| 来源 | 借鉴点 |
|------|--------|
| Coze | 三档生成风格预设（精确/均衡/创造） |
| Dify | 工具列表 toggle + hover 操作 + 50/50 配置预览布局 |
| OpenAI GPTs | 表单式配置 + 对话式构建 |
| Clawith | 11 Tab 详情页、Soul/Memory/Heartbeat 文件编辑、创建向导 |
| OpenClaw | Tool Profile 预设（minimal/coding/full）+ allow/deny 覆盖 |
| IronClaw | Extensions 状态机（installed→active→failed） |
| OpenCrust | 兼容 Claude Desktop mcp.json 格式 |
| ZeroClaw | MCP 工具延迟加载 |

## 9. 实现范围

### Phase 10a（本次）
- 配置面板框架 + 4 Tab 结构
- 灵魂文件 Tab（表单 + 原始）
- 工具管理 Tab（Profile + 开关）
- 参数 Tab（预设 + 高级）
- 后端：`update_agent`、`get_agent_tools`、`set_agent_tool_*` 命令

### Phase 10b（后续）
- MCP Client 完整实现
- MCP Tab UI
- 导入 Claude Desktop 配置
- MCP 工具与 ToolManager 集成
