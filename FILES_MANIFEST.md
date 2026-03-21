# OpenClaw 第二阶段 - 文件清单

## 核心文件列表

### 主程序入口
**文件**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/main.rs`
- 应用启动入口
- 模块初始化
- 数据库、网关、编排器、记忆系统初始化

---

## 数据库模块 (db/)

### 1. mod.rs - 数据库连接管理
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/db/mod.rs`
- Database 结构体定义
- 连接池创建和管理
- Schema 初始化
- 数据库生命周期管理

### 2. schema.rs - 数据库表定义
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/db/schema.rs`
- conversations 表创建
- agents 表创建
- memories 表创建
- vectors 表创建
- 索引创建

### 3. models.rs - 数据模型
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/db/models.rs`
- Conversation 结构体
- Agent 结构体
- Memory 结构体
- Vector 结构体
- 模型构造方法

### 4. queries.rs - 数据库查询
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/db/queries.rs`
- ConversationQueries: 对话 CRUD
- AgentQueries: Agent 配置 CRUD
- MemoryQueries: 记忆体 CRUD
- VectorQueries: 向量 CRUD

---

## 网关模块 (gateway/)

### 1. mod.rs - 网关主模块
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/gateway/mod.rs`
- ChannelHandler 特征定义
- MessageGateway 结构体
- 多通道管理
- 消息路由

### 2. message.rs - 消息规范化
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/gateway/message.rs`
- Channel 枚举 (Telegram, Feishu)
- Message 结构体
- 统一消息格式
- 元数据支持

### 3. telegram.rs - Telegram 集成
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/gateway/telegram.rs`
- TelegramHandler 结构体
- getUpdates 实现
- sendMessage 实现
- 消息转换

### 4. feishu.rs - 飞书集成
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/gateway/feishu.rs`
- FeishuHandler 结构体
- Token 获取
- 消息发送
- 用户信息查询

---

## Agent 模块 (agent/)

### 1. mod.rs - Agent 模块入口
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/agent/mod.rs`
- 模块导出
- 公共接口

### 2. orchestrator.rs - Agent 编排器
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/agent/orchestrator.rs`
- Agent 结构体
- Orchestrator 结构体
- 消息处理流程
- LLM 请求构建
- 工具调用流程

### 3. llm.rs - LLM 调用
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/agent/llm.rs`
- LlmConfig 结构体
- LlmClient 结构体
- OpenAI API 调用
- Anthropic API 调用
- 通用调用接口

### 4. tools.rs - 工具系统
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/agent/tools.rs`
- Tool 特征定义
- WebSearchTool 实现
- CalculatorTool 实现
- FileReadTool 实现
- ToolManager 管理器

---

## 记忆模块 (memory/)

### 1. mod.rs - 记忆系统主入口
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/memory/mod.rs`
- MemorySystem 结构体
- 统一接口
- 子模块导出

### 2. conversation.rs - 对话历史
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/memory/conversation.rs`
- save_conversation(): 保存对话
- get_history(): 获取历史
- search_conversations(): 搜索对话
- delete_old_conversations(): 清理旧对话

### 3. long_term.rs - 长期记忆
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/memory/long_term.rs`
- save_memory(): 保存记忆
- get_memory(): 获取记忆
- save_soul(): 保存灵魂
- get_soul(): 获取灵魂
- save_memory_entry(): 保存经验
- get_memories(): 获取经验
- save_knowledge_entry(): 保存知识
- get_knowledge(): 获取知识

### 4. vector.rs - 向量搜索
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/memory/vector.rs`
- save_vector(): 保存向量
- search_vectors(): 向量搜索
- hybrid_search(): 混合搜索
- get_vector_stats(): 统计信息

---

## 配置文件

### Cargo.toml
**路径**: `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/Cargo.toml`
- 项目元数据
- 依赖声明
- 编译配置

---

## 文件统计

| 类别 | 数量 | 行数 |
|------|------|------|
| 数据库模块 | 4 | 585 |
| 网关模块 | 4 | 550 |
| Agent 模块 | 4 | 760 |
| 记忆模块 | 4 | 570 |
| 主程序 | 1 | 50 |
| **总计** | **17** | **2515** |

---

## 模块依赖关系

```
main.rs
├── db::Database
│   ├── db::schema::init_schema()
│   ├── db::models::{Conversation, Agent, Memory, Vector}
│   └── db::queries::{ConversationQueries, AgentQueries, MemoryQueries, VectorQueries}
│
├── gateway::MessageGateway
│   ├── gateway::message::{Message, Channel}
│   ├── gateway::telegram::TelegramHandler
│   └── gateway::feishu::FeishuHandler
│
├── agent::Orchestrator
│   ├── agent::orchestrator::Agent
│   ├── agent::llm::{LlmClient, LlmConfig}
│   └── agent::tools::{Tool, ToolManager}
│
└── memory::MemorySystem
    ├── memory::conversation::*
    ├── memory::long_term::*
    └── memory::vector::*
```

---

## 快速查找指南

### 需要修改数据库表结构？
→ `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/db/schema.rs`

### 需要添加新的查询操作？
→ `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/db/queries.rs`

### 需要添加新的通道（如 Discord）？
→ 创建 `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/gateway/discord.rs`

### 需要修改 Agent 处理逻辑？
→ `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/agent/orchestrator.rs`

### 需要添加新的工具？
→ `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/agent/tools.rs`

### 需要修改记忆存储逻辑？
→ `/Users/zys/Desktop/yonclaw/my-openclaw/local-app/src/memory/long_term.rs`

---

## 编译和测试

### 检查编译
```bash
cd /Users/zys/Desktop/yonclaw/my-openclaw/local-app
cargo check
```

### 运行测试
```bash
cargo test
```

### 构建发布版本
```bash
cargo build --release
```

---

**最后更新**: 2026-03-15
**状态**: ✅ 完成
