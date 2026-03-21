# Phase 9a：灵魂文件 + 上下文管理 + 记忆体深化 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent 拥有"灵魂"——通过工作区文件系统定义人格，通过模块化 PromptSection 组装系统提示词，通过智能上下文管理优化 token 使用，通过记忆体深化实现语义检索注入。

**Architecture:** 管道式架构。SoulEngine 读取工作区 Markdown 文件，各 PromptSection 独立渲染并组装为 system prompt；ContextManager 动态管理对话窗口和 token 预算；MemoryLoader 通过 FTS5 全文搜索实现语义检索并注入上下文；ResponseCache 缓存重复请求节省 API 调用。所有模块通过 Orchestrator 串联。

**Tech Stack:** Rust, sqlx 0.7 (SQLite), async-trait, serde_json, sha2 (SHA-256), tiktoken-rs (token 计数), Tauri 1.5

---

## 前置条件

- Phase 8a 已完成（多供应商 LLM 流式对话）
- 项目根目录：`/Users/zys/.openclaw/workspace/yonclaw/my-openclaw`
- Rust 代码在 `local-app/src/` 下
- 前端代码在 `frontend/src/` 下
- 运行测试命令：`cd local-app && cargo test`
- 运行编译命令：`cd local-app && cargo build`

## 任务总览

| Task | 模块 | 说明 |
|------|------|------|
| 1 | 依赖 + Schema | 添加新依赖，扩展数据库 schema |
| 2 | Agent 工作区 | 工作区目录创建 + 模板文件生成 |
| 3 | PromptSection Trait | SoulEngine 核心 trait 和骨架 |
| 4 | 灵魂 Sections | Identity/Soul/Safety/User/DateTime 各 Section |
| 5 | Memory Trait | 重构记忆体为 trait 抽象 |
| 6 | MemoryLoader | FTS5 全文搜索 + 语义检索 |
| 7 | Memory/Tools Section | MemorySection + ToolsSection |
| 8 | Token 计数器 | TokenCounter 工具模块 |
| 9 | ContextManager | 动态窗口管理 + token 预算 |
| 10 | MessageCompactor | 历史消息压缩 |
| 11 | ResponseCache | 响应缓存（SHA-256 key） |
| 12 | Prompt Caching | Anthropic cache_control 注入 |
| 13 | Gateway 消息重构 | IncomingMessage / OutgoingResponse / StatusUpdate |
| 14 | Orchestrator 集成 | 串联所有模块到对话管道 |
| 15 | 前端适配 | Agent 创建生成工作区 + 灵魂文件编辑 |

---
