# Phase 9：Agent 核心能力体系 — 完整设计

> 日期：2026-03-16
> 状态：已确认
> 范围：灵魂文件 + 记忆体 + 上下文优化 + 工具系统 + Skills + Heartbeat + Routines + MCP + Gateway

---

## 背景

Phase 8a 完成了基础 AI 对话能力（多供应商、流式输出、对话历史）。但当前 Agent 只是一个"能聊天的壳"——没有人格、没有记忆深度、不能调用工具、不能连接外部系统。

企业级 OpenClaw 需要完整的 Agent 能力体系，参考 zeroclaw（Rust）、ironclaw（Rust）、openclaw（TypeScript）的成熟实现。

## 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 整体架构 | 管道式（Pipeline） | 与现有 Orchestrator 线性流程契合，模块解耦，可逐步实装 |
| 灵魂文件 | 工作区 Markdown 文件 | Agent 可自己读写进化，对齐 OpenClaw 生态标准 |
| Prompt 组装 | PromptSection trait 模块化 | 各 Section 独立，可增删，最大化 prompt cache 命中 |
| 工具调度 | 多格式 ToolDispatcher | Native（OpenAI/Anthropic）+ XML（Qwen/DeepSeek/GLM） |
| 技能选择 | 确定性评分（不用 LLM） | 关键词/标签/正则评分，避免循环调用 |
| MCP 范围 | Client + Server 双向 | Client 接入外部工具，Server 暴露 Agent 能力 |
| 安全策略 | 分级执行 | Safe/Guarded/Sandboxed/Approval 四级 |
| 实现顺序 | 灵魂 → 记忆 → 工具 → MCP | 先有人格，再有能力，最后连接世界 |

## 已有基础

| 模块 | 文件 | 状态 |
|------|------|------|
| 记忆体 | `memory/{mod,conversation,long_term,vector}.rs` | 框架+CRUD，无智能逻辑 |
| 工具系统 | `agent/tools.rs` | ToolManager + 3个占位工具 |
| 编排器 | `agent/orchestrator.rs` | Agent CRUD + 流式对话，硬编码20条上下文 |
| LLM客户端 | `agent/llm.rs` | OpenAI/Anthropic streaming，无 function calling |
| 网关 | `gateway/{telegram,feishu}.rs` | 消息路由框架，占位实现 |
| 数据库 | `db/schema.rs` | 5表：agents, conversations, memories, vectors, settings |

---

## 1. 整体架构（管道式）

```
工作区文件系统（灵魂文件体系）
├── SOUL.md          — Agent 人格与核心价值观
├── IDENTITY.md      — 名字、形象、风格
├── USER.md          — 用户画像
├── AGENTS.md        — 行为规范与红线
├── TOOLS.md         — 环境特定的工具配置
├── MEMORY.md        — 长期记忆（策展后的精华）
├── BOOTSTRAP.md     — 首次启动引导（用完删除）
├── HEARTBEAT.md     — 定时任务配置
└── memory/          — 每日记忆日志
    └── YYYY-MM-DD.md

Agent 运行时管道
┌─────────────────────────────────────────────────┐
│ PromptBuilder（模块化 Section 组合）              │
│ ├── IdentitySection  ← IDENTITY.md + SOUL.md    │
│ ├── SafetySection    ← AGENTS.md 红线规则        │
│ ├── ToolsSection     ← 可用工具 schema           │
│ ├── SkillsSection    ← 用户自定义技能            │
│ ├── MemorySection    ← 语义检索注入              │
│ └── ContextSection   ← 动态窗口管理              │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Agent Loop（多轮工具调用循环）                    │
│ 1. 组装 system prompt（PromptBuilder）           │
│ 2. 注入记忆上下文（MemoryLoader）                │
│ 3. 动态裁剪历史（ContextManager）                │
│ 4. 调用 LLM（含 tool schemas）                   │
│ 5. 解析响应（ToolDispatcher: XML/Native）        │
│ 6. 如有 tool_call → 执行 → 结果回注 → 回到 4    │
│ 7. 无 tool_call → 输出最终回复                   │
│ 8. 保存对话 + 更新记忆                           │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ 工具执行层                                       │
│ ├── 内置工具（计算、搜索、文件读写）             │
│ ├── MCP Client（连接外部 MCP Server）            │
│ ├── Skills（用户自定义工具+提示词）              │
│ └── 沙箱（危险操作隔离执行）                     │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│ Gateway 多通道通信                               │
│ ├── Web/Tauri（桌面应用内）                      │
│ ├── Telegram Bot                                 │
│ ├── 飞书 Bot                                     │
│ ├── REST API                                     │
│ └── MCP Server（暴露 Agent 能力给外部 AI）       │
└─────────────────────────────────────────────────┘
```

核心 trait 抽象：Provider, Tool, Memory, ToolDispatcher, PromptSection, Channel — 全部是 trait，可独立替换。

---

## 2. 灵魂文件系统（SoulEngine）

### 工作区目录结构

```
~/.openclaw/agents/{agent_id}/
├── SOUL.md          — 人格核心（价值观、风格、边界）
├── IDENTITY.md      — 身份信息（名字、形象、emoji、头像）
├── AGENTS.md        — 行为规范（红线、安全策略、外部操作规则）
├── TOOLS.md         — 环境特定工具备注
├── USER.md          — 用户画像（随交互积累）
├── MEMORY.md        — 长期记忆（策展精华）
├── BOOTSTRAP.md     — 首次引导（完成后自动删除）
├── HEARTBEAT.md     — 定时任务
├── skills/          — 自定义技能目录
│   └── {skill_name}/
│       └── SKILL.md
└── memory/          — 每日记忆
    └── YYYY-MM-DD.md
```

### PromptSection Trait

```rust
pub trait PromptSection: Send + Sync {
    fn name(&self) -> &str;
    fn render(&self, workspace: &AgentWorkspace) -> Option<String>;
}

pub struct SoulEngine {
    workspace_dir: PathBuf,
    sections: Vec<Box<dyn PromptSection>>,
}
```

### 默认 Section 顺序

1. `IdentitySection` — IDENTITY.md（名字、形象）
2. `SoulSection` — SOUL.md（人格、价值观）
3. `SafetySection` — AGENTS.md 中的红线规则
4. `ToolsSection` — 可用工具列表 + TOOLS.md 备注
5. `SkillsSection` — skills/ 目录下的技能提示词
6. `MemorySection` — MEMORY.md + 语义检索结果
7. `UserSection` — USER.md 用户画像
8. `DateTimeSection` — 当前时间、时区

### 关键特性

- Agent 可通过工具自己修改灵魂文件，实现自我进化
- 首次创建 Agent 时从模板生成初始工作区，触发 BOOTSTRAP.md 引导
- 企业管理员可锁定 AGENTS.md 红线规则，Agent 无法修改
- 灵魂文件部分尽量稳定不变，最大化 Anthropic prompt cache 命中率

---

## 3. 记忆体 + 上下文优化

### 三层记忆架构

```
1. 对话记忆（短期）— conversations 表
   └── 当前会话的完整对话历史

2. 长期记忆（策展）— MEMORY.md + memory/YYYY-MM-DD.md
   ├── 每日日志：原始记录，Agent 自动写入
   └── MEMORY.md：Agent 定期策展的精华

3. 向量记忆（语义）— vectors 表 + embedding
   └── 所有记忆内容的向量化，支持语义检索
```

### Memory Trait

```rust
#[async_trait]
pub trait Memory: Send + Sync {
    async fn store(&self, key: &str, content: &str, category: MemoryCategory) -> Result<()>;
    async fn recall(&self, query: &str, limit: usize) -> Result<Vec<MemoryEntry>>;
    async fn get(&self, key: &str) -> Result<Option<MemoryEntry>>;
    async fn list(&self, category: MemoryCategory) -> Result<Vec<MemoryEntry>>;
    async fn forget(&self, key: &str) -> Result<()>;
}

pub enum MemoryCategory {
    Core,           // SOUL.md, IDENTITY.md 等核心文件
    Daily,          // memory/YYYY-MM-DD.md 每日日志
    Conversation,   // 对话历史
    Knowledge,      // RAG 知识库内容
    Custom(String),
}

pub struct MemoryEntry {
    pub id: String,
    pub key: String,
    pub content: String,
    pub category: MemoryCategory,
    pub timestamp: i64,
    pub score: Option<f64>,  // 语义检索相关性分数
}
```

### 上下文优化四层机制

```
1. Prompt Caching（API 层缓存）
   └── Anthropic 模型注入 cache_control: { type: "ephemeral" }
       系统 prompt 不变时 API 侧缓存命中，省 token 省钱

2. Response Cache（响应缓存）
   └── SHA-256(model + system_prompt + messages_hash) 为 key
       相同问题直接返回缓存，不调 LLM
       TTL 1小时，最多 1000 条，LRU 淘汰

3. Context Window Guard（窗口守卫）
   └── 硬限制：< 16K token 阻断
       软警告：< 32K token 提醒
       每个模型可配置独立窗口大小

4. Message Compaction（消息压缩）
   └── 超出 token 预算时自动压缩历史
       按 token 份额分块 → LLM 摘要 → 保留标识符
       压缩后重新注入关键指令（AGENTS.md 红线）
```

### 上下文构建流程

```
用户发消息
  ↓
1. PromptBuilder 组装 system prompt
   ├── 灵魂文件各 Section（稳定部分，利于 cache 命中）
   └── 标记 cache_control: ephemeral（Anthropic）
  ↓
2. ResponseCache 检查
   ├── 命中 → 直接返回
   └── 未命中 → 继续
  ↓
3. MemoryLoader 语义检索
   ├── query = 用户消息，检索 top-K 相关记忆（阈值 0.6）
   └── 格式化注入 prompt
  ↓
4. ContextManager 动态窗口管理
   ├── token 预算 = 模型窗口 - system_prompt - 预留输出
   ├── 历史消息按时间倒序填充至预算耗尽
   ├── 超出时触发 Compaction：
   │   ├── 按 token 份额分块（chunk_ratio = 0.4）
   │   ├── 每块 LLM 摘要（保留标识符：UUID/URL/文件名）
   │   └── 压缩后重新注入 AGENTS.md 红线
   └── ContextWindowGuard 最终检查（< 16K 阻断）
  ↓
5. 发送给 LLM → 响应写入 ResponseCache
```

### Embedding 策略

- 在线：调用 LLM provider 的 embedding API
- 离线：SQLite FTS5 全文搜索作为降级方案
- 后续：本地轻量 embedding 模型

---

## 4. 工具系统 + Function Calling

### 工具执行三层

```
1. 内置工具（进程内执行）
   ├── calculator    — 数学计算
   ├── web_search    — 网络搜索
   ├── datetime      — 时间日期
   └── memory_*      — 记忆读写

2. 沙箱工具（子进程隔离）
   ├── file_read     — 读取文件（白名单路径）
   ├── file_write    — 写入文件（限 Agent 工作区）
   ├── shell_exec    — 执行命令（白名单 + 超时）
   └── code_run      — 运行代码片段

3. MCP 工具（外部 MCP Server 提供）
   └── 动态发现，运行时注册
```

### 多格式 ToolDispatcher

```rust
#[async_trait]
pub trait ToolDispatcher: Send + Sync {
    fn parse_tool_calls(&self, response: &str) -> Vec<ParsedToolCall>;
    fn format_tool_result(&self, result: &ToolCallResult) -> serde_json::Value;
}

/// OpenAI / Anthropic 原生 function calling
pub struct NativeToolDispatcher;

/// Qwen / DeepSeek / GLM — XML 格式
/// 解析 <tool_call>...</tool_call>，自动剥离 <think> 块
pub struct XmlToolDispatcher;
```

### 分级安全执行

```rust
pub enum ToolSafetyLevel {
    Safe,       // 进程内直接执行
    Guarded,    // 需要权限检查
    Sandboxed,  // 子进程隔离
    Approval,   // 需要用户确认
}

pub struct SandboxConfig {
    pub timeout_secs: u64,           // 默认 30s
    pub max_memory_mb: u64,          // 默认 256MB
    pub allowed_paths: Vec<PathBuf>,
    pub allowed_commands: Vec<String>,
    pub network_allowed: bool,
}
```

### 多轮工具调用循环

```
LLM 响应 → ToolDispatcher.parse_tool_calls()
  ↓ 有 tool_calls?
  ├── 无 → 输出最终回复
  └── 有 → 逐个执行：
      ├── 检查安全级别
      ├── Safe/Guarded → 直接执行
      ├── Sandboxed → 子进程执行
      ├── Approval → 前端弹窗确认
      ├── 去重检查（防重复调用）
      └── 结果回注 messages → 回到 LLM
          （最多 10 轮，防无限循环）
```

---

## 5. Skills + Heartbeat + Routines

### 5.1 Skills 系统

#### SKILL.md 格式

```markdown
---
name: web-researcher
version: 1.0.0
description: 搜索网络并总结信息
tags: [search, research, web]
keywords: [搜索, 查找, 研究, 调查]
exclude_keywords: [文件, 本地]
tools: [web_search]
trust: user
---

# Web Researcher
当用户需要搜索网络信息时使用此技能。
...
```

#### 技能选择（确定性评分）

- 关键词精确匹配: 10 分
- 关键词子串匹配: 5 分
- 标签匹配: 3 分
- 正则匹配: 20 分
- exclude_keywords 命中: 直接归零
- 最多激活 3 个技能，上下文预算 4000 token

#### 信任模型

- `user` 级（用户自己放的）→ 全部工具
- `installed` 级（注册表安装的）→ 只读工具
- 多技能激活时取最低信任级别作为工具上限

### 5.2 Heartbeat 心跳

```rust
pub struct HeartbeatConfig {
    pub enabled: bool,
    pub interval_secs: u64,        // 默认 1800（30分钟）
    pub max_failures: u32,         // 连续失败 3 次后禁用
    pub quiet_hours: Option<(u8, u8)>,  // 静默时段
    pub timezone: String,
}
```

执行流程：
1. 定时触发 → 检查静默时段
2. 读取 HEARTBEAT.md → 空内容跳过
3. 构建 prompt → 调用 LLM 单轮
4. HEARTBEAT_OK → 静默；否则 → 通过 Gateway 推送通知

### 5.3 Routines 定时/事件任务

```rust
pub enum RoutineTrigger {
    Cron(String),                     // "0 9 * * *"
    Event { pattern: String },        // 消息匹配正则
    System(SystemEvent),              // 启动、网络恢复等
}

pub enum RoutineAction {
    Lightweight { template: String },
    FullJob { prompt: String, tools: Vec<String>, max_turns: u32 },
}

pub struct RoutineGuardrails {
    pub cooldown_secs: u64,
    pub max_concurrent: u32,
    pub dedup_window_secs: u64,
    pub max_runs_per_day: u32,
}
```

### 三套机制关系

| 机制 | 触发方式 | 执行内容 | 典型场景 |
|------|---------|---------|---------|
| Skills | 用户消息关键词 | 注入 prompt + 开放工具 | 搜索、翻译、代码审查 |
| Heartbeat | 定时（30min） | 单轮 LLM 巡检 | 日历提醒、记忆整理 |
| Routines | Cron/事件/系统 | 模板或完整 LLM 任务 | 每日报告、自动回复 |

---

## 6. MCP 集成（Client + Server）

### 6.1 Transport 抽象

```rust
#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn send(&self, request: &McpRequest) -> Result<McpResponse>;
    async fn shutdown(&self) -> Result<()>;
}

/// HTTP Streamable（远程）— POST + SSE，Session ID 跟踪
pub struct HttpTransport;

/// Stdio（本地子进程）— stdin/stdout 管道，JSON-RPC
pub struct StdioTransport;
```

### 6.2 MCP Client

```rust
pub struct McpClient {
    name: String,
    transport: Box<dyn McpTransport>,
    initialized: OnceCell<InitializeResult>,
    tool_cache: RwLock<Option<Vec<McpTool>>>,
    request_id: AtomicU64,
}
```

- 握手只执行一次（OnceCell）
- 工具延迟加载 + 缓存
- MCP 工具包装为 Tool trait 对象，注册到 ToolManager
- 工具命名：`mcp__{server_name}_{tool_name}`

### 6.3 McpManager

```rust
pub struct McpManager {
    clients: HashMap<String, McpClient>,
}
```

- 应用启动时连接 auto_start 的 Server
- 动态添加/移除 Server
- 收集所有工具注册到 ToolManager
- 优雅关闭所有连接

### 6.4 MCP Server

OpenClaw 作为 MCP Server，SSE 端点暴露 Agent 能力：

| 工具名 | 描述 |
|--------|------|
| `openclaw_chat` | 与指定 Agent 对话 |
| `openclaw_list_agents` | 列出所有 Agent |
| `openclaw_memory_search` | 语义搜索 Agent 记忆 |
| `openclaw_memory_write` | 写入 Agent 记忆 |

### 6.5 超时与错误

- initialize: 30s
- tool_call: 180s（可配置，上限 600s）
- Stdio 崩溃自动检测，可选重连
- 所有 shutdown 幂等

---

## 7. Gateway 多通道通信

### 统一消息抽象

```rust
pub struct IncomingMessage {
    pub id: String,
    pub channel: String,           // "telegram" | "feishu" | "web" | "api"
    pub user_id: String,
    pub content: String,
    pub thread_id: Option<String>,
    pub metadata: serde_json::Value,
    pub attachments: Vec<Attachment>,
}

pub struct OutgoingResponse {
    pub content: String,
    pub thread_id: Option<String>,
    pub attachments: Vec<String>,
    pub metadata: serde_json::Value,
}

pub enum StatusUpdate {
    Thinking(String),
    StreamChunk(String),
    ToolStarted { name: String },
    ToolCompleted { name: String, success: bool },
    ApprovalNeeded { tool_name: String, description: String },
}
```

### Channel Trait

```rust
#[async_trait]
pub trait Channel: Send + Sync {
    fn name(&self) -> &str;
    async fn start(&self) -> Result<MessageStream>;
    async fn respond(&self, msg: &IncomingMessage, response: OutgoingResponse) -> Result<()>;
    async fn send_status(&self, msg: &IncomingMessage, status: StatusUpdate) -> Result<()>;
    async fn broadcast(&self, user_id: &str, response: OutgoingResponse) -> Result<()>;
    async fn health_check(&self) -> Result<()>;
    async fn shutdown(&self) -> Result<()>;
}
```

### 支持的通道

1. Web/Tauri — 桌面应用内（已有，适配新消息格式）
2. Telegram Bot — 长轮询 + Bot API
3. 飞书 Bot — Webhook + API
4. REST API — HTTP 端点供外部集成
5. Discord / WhatsApp — 后续扩展

### 消息路由

```
消息到达 → SessionRouter 解析会话
  ├── channel + user_id + thread_id → session_key
  ├── session_key → agent_id（查映射表）
  └── 无映射 → 默认 Agent
  ↓
Agent Loop 处理 → 响应通过原通道返回
```

---

## 8. 分阶段实现规划

```
Phase 9a → 让 Agent "有灵魂"
Phase 9b → 让 Agent "能做事"
Phase 9c → 让 Agent "自主行动"
Phase 9d → 让 Agent "连接世界"
```

### Phase 9a：灵魂 + 上下文 + 记忆体深化

| 模块 | 改动 |
|------|------|
| Agent 工作区 | 新建 `~/.openclaw/agents/{id}/` 目录 + 模板文件 |
| SoulEngine | 新建 `agent/soul.rs`，PromptSection trait |
| ContextManager | 新建 `agent/context.rs`，动态窗口 + token 预算 |
| MessageCompactor | 新建 `agent/compaction.rs`，历史压缩 |
| ResponseCache | 新建 `agent/response_cache.rs` |
| Prompt Caching | 修改 `agent/llm.rs`，Anthropic cache_control |
| Memory trait | 重构 `memory/mod.rs` |
| MemoryLoader | 新建 `memory/loader.rs` |
| Gateway 消息类型 | 重构 `gateway/message.rs`（IncomingMessage/OutgoingResponse） |
| 数据库 | 新增 response_cache 表 |
| 前端 | Agent 创建生成工作区，灵魂文件编辑 |

### Phase 9b：工具系统 + Function Calling

| 模块 | 改动 |
|------|------|
| ToolDispatcher | 新建 `agent/dispatcher.rs` |
| Agent Loop | 重构 `agent/orchestrator.rs`，多轮工具调用 |
| LlmClient | 修改 `agent/llm.rs`，tools 参数 + tool_call 解析 |
| 内置工具 | 重写 `agent/tools.rs` |
| 沙箱 | 新建 `agent/sandbox.rs` |
| StatusUpdate | Gateway 支持工具执行状态推送 |
| 前端 | 工具调用可视化，Approval 弹窗 |

### Phase 9c：Skills + Heartbeat + Routines

| 模块 | 改动 |
|------|------|
| Skill 解析/注册/选择 | 新建 `skills/` 模块 |
| 工具衰减 | 新建 `skills/attenuation.rs` |
| Heartbeat | 新建 `agent/heartbeat.rs` |
| Routines | 新建 `agent/routine.rs` + `routine_engine.rs` |
| Gateway 集成 | Heartbeat/Routines 通过 Gateway broadcast 通知 |
| 数据库 | 新增 routines、routine_runs 表 |
| 前端 | Skills 管理、Routine 配置、Heartbeat 开关 |

### Phase 9d：MCP + Gateway 通道 + MCP Server

| 模块 | 改动 |
|------|------|
| McpTransport | 新建 `tools/mcp/transport.rs` |
| McpClient | 新建 `tools/mcp/client.rs` |
| McpManager | 新建 `tools/mcp/manager.rs` |
| McpServer | 新建 `mcp_server/` |
| Telegram 通道 | 实装 `gateway/telegram.rs` |
| 飞书通道 | 实装 `gateway/feishu.rs` |
| API 通道 | 新建 `gateway/api.rs` |
| SessionRouter | 新建 `gateway/router.rs` |
| 数据库 | 新增 channel_sessions 表，mcp_config 设置 |
| 前端 | MCP 配置面板，Gateway 配置面板 |

---

## 总改动估算

| Phase | 新建文件 | 修改文件 | 预计规模 |
|-------|---------|---------|---------|
| 9a | ~8 | ~5 | ~15 文件 |
| 9b | ~4 | ~4 | ~10 文件 |
| 9c | ~6 | ~3 | ~12 文件 |
| 9d | ~8 | ~5 | ~15 文件 |
| **合计** | **~26** | **~17** | **~52 文件** |
