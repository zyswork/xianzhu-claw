# 完成缺失功能 - 设计文档

**日期**: 2026-03-15
**状态**: 已批准
**范围**: 补全所有 20+ 个缺失功能，达到生产级质量

---

## 目标

将 my-openclaw Admin Platform 从当前的 ~60% 完成度提升至 100% 生产级实现。

### 核心目标
- ✅ 补全所有 Tier 1 (8个)、Tier 2 (7个)、Tier 3 (5个) 缺失功能
- ✅ 从内存数据库迁移到 PostgreSQL
- ✅ 实现完整的 API 端点和业务逻辑
- ✅ 前后端同步开发，充分测试
- ✅ 4-6 周内交付生产级应用

---

## 范围分析

### Tier 1 - 高优先级 (8 个)
1. **文件上传** - 知识库、模板、批量导入
2. **批量操作** - 用户、文档的批量导入/删除
3. **真实通知** - Token 告警邮件、Webhook 发送
4. **报告导出** - Token 监控的 PDF/Excel 导出
5. **版本管理 API** - 知识库的版本 CRUD API
6. **模板测试** - Agent 模板的 `/test` 端点
7. **Token 刷新** - 认证系统的会话管理
8. **用户状态** - 用户的启用/禁用/暂停管理

### Tier 2 - 中优先级 (7 个)
- RAG/向量化搜索
- 活动日志/审计追踪
- 实时更新 (WebSocket)
- 使用统计
- 成本预测趋势
- 模板克隆
- 批量导入导出

### Tier 3 - 低优先级 (5 个)
- 离线支持
- 高级搜索
- Webhook 推送
- 邮箱验证
- 密码重置自服务

---

## 实现策略

### 执行模式: 并行模块式 (方案 B)

```
批次 1 (周 1-2): 基础设施
  ├─ 数据库迁移: PostgreSQL
  ├─ 认证完整化: Token 刷新、密码重置
  └─ 通知系统: Nodemailer + Webhook 框架

批次 2 (周 1-4): 核心模块并行
  ├─ 2a: 用户管理完整化 (周 1-2)
  ├─ 2b: 知识库版本控制 (周 2-3)
  ├─ 2c: Agent 模板测试框架 (周 2-3)
  └─ 2d: Token 监控完整化 (周 3-4)

批次 3 (周 4-6): 高级功能和优化
  ├─ RAG/向量化
  ├─ 实时更新 (WebSocket)
  ├─ 自动化 (Webhook、Cron)
  └─ 工程优化 (文档、性能、安全)
```

### 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **数据库** | PostgreSQL + Prisma ORM | 生产就绪、类型安全、迁移工具完善 |
| **邮件** | Nodemailer | 轻量、开源、支持多种 SMTP |
| **文件存储** | 本地文件系统 (可选 S3) | 快速实现，可后续迁移 |
| **向量数据库** | Pinecone/Weaviate (可选) | 高级功能，可后续集成 |
| **WebSocket** | Socket.io | 实时通信，成熟库 |
| **并行开发** | 4 个子模块同时 | 充分利用并行性 |

### 依赖关系

```
批次 1 (基础) ──────┐
                   │
           ┌───────┴───────┬───────────┬──────────┐
           ▼               ▼           ▼          ▼
         2a             2b           2c         2d
      (用户)        (知识库)      (模板)      (Token)
           │               │           │          │
           └───────────────┴───────────┴──────────┘
                           │
                           ▼
                        批次 3
                     (高级功能)
```

---

## 工作项分解

### 批次 1: 基础设施 (周 1-2)

#### 1a. 数据库迁移 (PostgreSQL)
- 设计 Schema（5 个主表：users, enterprises, documents, templates, token_usage）
- 集成 Prisma ORM
- 创建初始迁移脚本
- Docker Compose PostgreSQL 配置
- 测试数据播种

#### 1b. 认证完整化
- POST `/auth/refresh-token` - Token 刷新机制
- POST `/auth/reset-password` - 邮件重置流程
- POST `/auth/verify-email` - 邮箱验证
- GET `/auth/me` - 当前用户信息
- PUT `/auth/change-password` - 修改密码
- 前端: 登出按钮、Token 自动刷新、密码重置表单

#### 1c. 通知系统框架
- Nodemailer SMTP 集成
- 邮件模板系统
- Webhook 签名和重试机制
- 通知队列管理
- 前端: 通知偏好设置

---

### 批次 2: 核心模块并行 (周 1-4)

#### 2a. 用户管理完整化 (周 1-2)
- 后端:
  - POST `/users/enterprise/:enterpriseId/bulk-create` - 批量创建
  - POST `/users/enterprise/:enterpriseId/bulk-delete` - 批量删除
  - PUT `/users/:id/status` - 用户启用/禁用/暂停
  - GET `/users/:id/activity-log` - 活动日志
  - POST `/users/:id/reset-password` - 管理员密码重置
- 前端:
  - 批量操作 UI (复选框、批量操作按钮)
  - 用户禁用/启用切换
  - 活动日志面板

#### 2b. 知识库版本控制 (周 2-3)
- 后端:
  - GET `/knowledge-base/:id/versions` - 版本列表
  - GET `/knowledge-base/:id/versions/:versionId` - 获取版本
  - POST `/knowledge-base/:id/versions/:versionId/restore` - 恢复版本
  - POST `/knowledge-base/:id/publish` - 发布条目
  - 文件上传处理 (Multer: PDF/Word/Markdown)
  - 高级搜索和过滤
- 前端:
  - 版本历史面板
  - 文件上传组件
  - 条目发布工作流

#### 2c. Agent 模板测试框架 (周 2-3)
- 后端:
  - POST `/agent-templates/:id/test` - 测试模板（含输入参数、输出结果）
  - GET `/agent-templates/:id/parameters` - 参数提取
  - POST `/agent-templates/import` - 导入配置
  - POST `/agent-templates/:id/export` - 导出配置
  - POST `/agent-templates/:id/clone` - 克隆模板
- 前端:
  - 测试页面（参数输入、结果显示）
  - 导入导出按钮
  - 克隆模板确认对话

#### 2d. Token 监控完整化 (周 3-4)
- 后端:
  - 真实告警通知（邮件 + Webhook）
  - POST `/token-monitoring/:enterpriseId/export` - 报告导出
  - GET `/token-monitoring/:enterpriseId/trends` - 趋势数据和预测
  - POST `/token-monitoring/:enterpriseId/budget` - 预算管理
  - DELETE `/token-monitoring/alerts/:alertId` - 删除告警
- 前端:
  - 报告下载按钮
  - 预算设置页面
  - 趋势预测图表

---

### 批次 3: 高级功能和优化 (周 4-6)

#### 3a. RAG/向量化搜索 (周 4-5)
- 向量数据库集成（可选：Pinecone/Weaviate）
- 知识库条目向量化
- 语义搜索 API

#### 3b. 实时更新 (周 4-5)
- Socket.io WebSocket 管理
- 事件推送系统
- 前端实时订阅

#### 3c. 自动化和集成 (周 5-6)
- Webhook 事件配置
- Cron 任务框架
- 流程自动化

#### 3d. 工程优化 (周 5-6)
- OpenAPI/Swagger API 文档
- 性能基准测试和优化
- 安全审计和加固
- E2E 测试（关键流程）

---

## 质量标准

### 前端
- ✅ 所有新功能的 UI 组件完整
- ✅ 响应式设计验证
- ✅ 组件级单元测试 (Vitest)
- ✅ 集成测试（关键流程）

### 后端
- ✅ 所有新 API 端点完整
- ✅ 业务逻辑正确性验证
- ✅ 单元测试覆盖 >= 80%
- ✅ 集成测试（数据库、邮件、Webhook）
- ✅ API 文档（Swagger/OpenAPI）

### 数据库
- ✅ Schema 设计合理
- ✅ 迁移脚本完备
- ✅ 备份和恢复机制
- ✅ 性能索引优化

### 安全
- ✅ 权限检查完整
- ✅ 输入验证和清理
- ✅ CORS 配置正确
- ✅ 速率限制（可选）
- ✅ SQL 注入防护

---

## 成功指标

| 指标 | 目标 | 验证方式 |
|------|------|---------|
| **API 完成度** | 54% → 100% | API 端点数统计 |
| **功能完成度** | 60% → 100% | 功能清单检查 |
| **测试通过率** | 100% | npm test 输出 |
| **代码覆盖率** | >= 80% | Vitest 覆盖率报告 |
| **API 文档** | 100% | Swagger/OpenAPI 验证 |
| **生产就绪** | 是 | 部署检查清单 |

---

## 风险和缓解

| 风险 | 概率 | 缓解策略 |
|------|------|---------|
| **数据库迁移延期** | 中 | 提前准备 Schema 和迁移脚本 |
| **Tier 2 功能赶不上** | 中 | 优先 Tier 1，Tier 2 可选后延 |
| **通知系统集成困难** | 低 | 使用成熟库 (Nodemailer)，早期测试 |
| **并行开发冲突** | 低 | 清晰的代码分界，独立的 Feature Branch |

---

## 时间估计

| 批次 | 并行度 | 预计工期 |
|------|--------|---------|
| **批次 1** | 1 (顺序) | 2 周 |
| **批次 2** | 4 (并行) | 3 周 (不是 12 周) |
| **批次 3** | 2-3 (并行) | 2 周 |
| **总计** | - | **4-6 周** |

---

## 下一步

1. ✅ 设计文档已批准
2. ⏭️ 调用 `superpowers:writing-plans` 创建详细实现计划
3. ⏭️ 启动 git worktree 隔离工作空间
4. ⏭️ 执行 `superpowers:subagent-driven-development` 并行实现

---

*此设计文档已由用户批准，准备进入实现阶段。*
