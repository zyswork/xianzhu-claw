# Phase 8：从 MVP 到完整产品 — 全量实现设计

> 日期：2026-03-16
> 状态：已确认
> 范围：AI 对话 + RAG + 离线同步 + 安全生产化

---

## 背景

当前产品状态为管理后台 MVP：能登录、CRUD 管理数据，但缺少核心价值（AI 对话 + 离线 + 同步）。

设计文档（配置实战：从简单到高级.md）定义了完整的企业级系统，实际实现差距集中在：
- AI 对话功能（0%）— 产品核心价值
- 离线模式（0%）— 核心差异化
- 数据同步（0%）— Push/Pull/Queue
- 向量搜索 RAG（0%）— 知识库核心能力
- 安全隔离（~15%）— 企业级必需
- SQLite→PG 切换 — 生产就绪

## 关键决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| LLM 调用路径 | Rust 本地调用 | 延迟低，支持离线，复用已有 orchestrator |
| API Key 管理 | 双层 Key（企业+个人） | 在线走企业 Key（统一计量），离线走个人 Key |
| 实现路径 | 功能驱动，逐层深入 | 每阶段有可演示成果，风险可控 |
| 冲突策略 | server-wins | 企业场景管理员数据优先，简单可靠 |
| PG 切换 | 抽象层 + 环境变量 | 保留 SQLite 作为开发/本地模式 |

## 已有基础设施（可复用）

### Rust 侧（local-app/src/）
- `agent/llm.rs` — LLM 客户端（OpenAI + Anthropic），需加 streaming
- `agent/orchestrator.rs` — Agent 注册/消息处理，需暴露为 Tauri commands
- `agent/tools.rs` — 工具框架（3 个占位实现），需完善
- `memory/` — 3 层记忆系统（conversation + long_term + vector），已可用
- `gateway/` — Telegram + 飞书网关（已有框架）
- `db/mod.rs` — SQLite 4 表（conversations, agents, memories, vectors）

### Node.js 后端（admin-backend/）
- WebSocket `/ws` — 实时通信（心跳、消息推送）
- Qdrant 向量搜索 — 集成 + 缓存策略
- CRDT 协作编辑 — Yjs 并发编辑
- Token 用量追踪 — 完整模型（usage/quota/alert）
- 同步队列 — 优先级事件同步框架

### 前端（frontend/src/）
- 6 个 CRUD 页面 + Tauri HTTP wrapper + JWT 认证
- 无对话 UI、无设置页面

---

## Phase 8a：AI 对话核心

### 目标
用户打开桌面应用，能创建 Agent、发起对话、收到 LLM 流式回复、查看历史。

### 架构
```
ChatPage (React)
  ↓ invoke('send_message', {agentId, message})
  ↓ invoke('create_agent', {name, model, systemPrompt})
  ↓ invoke('list_agents')
  ↓ invoke('get_conversations', {agentId})
Tauri Commands (新增 ~8 个)
  ↓
Orchestrator + MemorySystem (已有，微调)
  ↓
LlmClient (已有) → OpenAI / Anthropic API
  ↓
SQLite 本地存储 (已有 conversations/agents/memories 表)
```

### 改动清单
| 文件 | 改动 |
|------|------|
| `local-app/src/main.rs` | 新增 8 个 Tauri commands |
| `local-app/src/agent/orchestrator.rs` | streaming 支持，agent CRUD 暴露 |
| `local-app/src/agent/llm.rs` | SSE streaming 解析 |
| `frontend/src/pages/ChatPage.tsx` | **新建** 对话界面 |
| `frontend/src/pages/SettingsPage.tsx` | **新建** API Key 配置 |
| `frontend/src/components/Sidebar.tsx` | 添加导航项 |
| `frontend/src/App.tsx` | 添加路由 |

### 数据流
1. SettingsPage 输入 API Key → `invoke('save_config')` → AES 加密存本地
2. 创建 Agent → `invoke('create_agent')` → 存 agents 表
3. 发消息 → `invoke('send_message')` → Orchestrator → LlmClient → 流式返回 → 存 conversations
4. 切换 Agent → `invoke('get_conversations')` → 加载历史

### 关键设计
- **流式输出**：Tauri event system（`app.emit_all`）推送 token chunks
- **API Key 存储**：SQLite `settings` 表，AES-256-GCM 加密
- **对话上下文**：最近 20 条消息作为 LLM context，超出存 long_term memory

---

## Phase 8b：RAG 知识增强

### 目标
对话时自动检索企业知识库相关文档，注入 LLM 上下文。

### 架构
```
用户发消息
  ↓ Orchestrator.process_message()
  ↓ 1. 提取查询意图
  ↓ 2. RAG 检索
  ↓    ├─ 在线：HTTP → Node.js → Qdrant
  ↓    └─ 离线：本地 SQLite FTS5
  ↓ 3. 检索结果注入 system prompt
  ↓ 4. 调用 LLM
  ↓
返回带引用来源的回复
```

### 改动清单
| 文件 | 改动 |
|------|------|
| `local-app/src/agent/rag.rs` | **新建** RAG 检索模块 |
| `local-app/src/agent/orchestrator.rs` | 插入 RAG 检索步骤 |
| `admin-backend/src/routes/knowledge-base.ts` | 新增向量化接口 |
| `admin-backend/src/routes/search.ts` | 增强搜索接口 |
| `frontend/src/pages/ChatPage.tsx` | 消息显示引用来源 |
| `frontend/src/pages/KnowledgeBasePage.tsx` | 向量化按钮 |

### 关键设计
- **Embedding**：复用后端 mock embedding（384维），后续替换 text-embedding-3-small
- **检索策略**：top-5 chunks，相似度阈值 0.7
- **离线降级**：SQLite FTS5 全文搜索
- **文档分块**：500 token/块，50 token 重叠

---

## Phase 8c：离线模式 + 数据同步

### 目标
断网时应用完全可用，上线后自动同步。

### 架构
```
本地实例 (Tauri)
  NetworkMonitor ← 定时检测连通性
  SyncManager
    ├─ EventQueue (SQLite sync_events 表)
    ├─ PullSync (版本号比对 → 增量下载)
    └─ PushSync (队列事件 → 批量上传)
  LocalCache
    ├─ 企业知识库快照
    ├─ Agent 模板快照
    └─ 用户配置
         ↕ WebSocket + 5分钟定时 Pull
远程服务器 (Node.js)
  ├─ WebSocket 推送变更通知
  ├─ GET /sync/changes?since=version
  └─ POST /sync/events
```

### 改动清单
| 文件 | 改动 |
|------|------|
| `local-app/src/sync/mod.rs` | **新建** SyncManager |
| `local-app/src/sync/network.rs` | **新建** 网络检测 |
| `local-app/src/sync/event_queue.rs` | **新建** 事件队列 |
| `local-app/src/sync/pull.rs` | **新建** 拉取变更 |
| `local-app/src/sync/push.rs` | **新建** 推送变更 |
| `local-app/src/sync/cache.rs` | **新建** 缓存管理 |
| `local-app/src/db/mod.rs` | 新增 sync_events、cache_meta 表 |
| `local-app/src/main.rs` | 初始化 SyncManager |
| `admin-backend/src/routes/sync.ts` | **新建** 同步 API |
| `frontend/src/components/Navbar.tsx` | 网络状态指示器 |

### 同步协议
```json
{
  "id": "uuid",
  "version": "auto_increment",
  "entity_type": "knowledge_doc | agent_template | token_usage",
  "entity_id": "uuid",
  "action": "create | update | delete",
  "data": {},
  "timestamp": "ISO8601",
  "source": "local | remote"
}
```

- Pull：last_sync_version → GET /sync/changes → 按 version 顺序应用
- Push：sync_events(pending) → POST /sync/events → 冲突 server-wins → 标记 synced
- 频率：WebSocket 实时 + 5 分钟定时兜底
- 缓存：30 天内访问过的热数据本地缓存

---

## Phase 8d：安全隔离 + 生产化

### 安全隔离
```
第1层：多租户 — SQL 强制 WHERE enterprise_id，中间件自动注入
第2层：RBAC — admin(全部) / manager(管理) / user(只读+对话)
第3层：加密 — 本地 AES-256-GCM，服务端环境变量
第4层：审计 — audit_logs 表记录关键操作 (who/what/when/ip)
```

### SQLite → PostgreSQL
- 抽象 Database 层 + 环境变量 DB_TYPE 切换
- 迁移脚本 SQLite → PG 一次性导入
- 保留 SQLite 作为开发/本地模式

### Docker 部署
```yaml
services:
  postgres: (PG 14)
  qdrant: (向量数据库)
  backend: (Node.js + 依赖 PG/Qdrant)
  nginx: (反向代理 + 静态文件)
```

### 改动清单
| 文件 | 改动 |
|------|------|
| `admin-backend/src/middleware/rbac.ts` | **新建** RBAC |
| `admin-backend/src/middleware/tenant.ts` | **新建** 多租户 |
| `admin-backend/src/middleware/audit.ts` | **新建** 审计日志 |
| `admin-backend/src/db/postgres.ts` | **新建** PG 适配器 |
| `admin-backend/src/db/index.ts` | **新建** 数据库抽象层 |
| `admin-backend/scripts/migrate-sqlite-to-pg.ts` | **新建** 迁移脚本 |
| `docker-compose.yml` | **新建** |
| `Dockerfile` | **新建** |
| `nginx/nginx.conf` | **新建** |

---

## 总改动估算

| Phase | 新建文件 | 修改文件 | 预计规模 |
|-------|---------|---------|---------|
| 8a | 2 | 5 | ~15 文件 |
| 8b | 1 | 5 | ~10 文件 |
| 8c | 7 | 4 | ~15 文件 |
| 8d | 8 | 4 | ~15 文件 |
| **合计** | **18** | **18** | **~55 文件** |

## 实现顺序

```
Phase 8a (AI 对话) → 可对话的桌面应用
  ↓
Phase 8b (RAG) → 能引用知识库的 AI 助手
  ↓
Phase 8c (离线+同步) → 断网可用 + 自动同步
  ↓
Phase 8d (安全+生产化) → 企业级部署就绪
```
