# Batch 3 完整设计文档

**日期**: 2026-03-15
**阶段**: Batch 3 - 通信系统优先并行开发
**目标**: 10-12 周内实现 P0 + P1 + 部分 P2 功能，系统完成度达到 100%
**并行模式**: 三队列独立并行，定期集成检查点

---

## 1. 核心决策确认

### 1.1 实现方案
- **方案 C** (全面实现，10-12 周)
- 完成 P0 + P1 + 部分 P2 功能
- 通信系统优先，知识库和离线支持并行补充

### 1.2 技术决策

| 决策项 | 选择 | 理由 |
|------|------|------|
| 推送方式 | WebSocket + SSE/Polling 降级 | 实时性 + 兼容性 |
| 离线程度 | 核心功能离线 | 80% 用户体验，实现可控 |
| 冲突解决 | 混合 CRDTs (关键文档) | 平衡复杂度和可靠性 |
| 并行模式 | 三队列独立，定期同步 | 快速、依赖清晰 |
| 搜索方案 | 向量搜索 + 热冷分层 | 语义理解 + 性能兼顾 |
| 事件溯源 | 所有操作记录为事件 | 完全可追溯、支持重放 |

---

## 2. 架构设计

### 2.1 三队列并行架构

```
┌─────────────────────────────────────────────────────────┐
│         Batch 3: 通信优先并行架构 (10-12 周)           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 队列 A (通信系统)  ← 最关键，其他依赖它                │
│ ├─ Week 1-3: Push 通知 + WebSocket 基础                │
│ ├─ Week 4-6: WebSocket 完善 + CRDTs 冲突解决          │
│ └─ Week 7-9: 事件溯源完整化 + 降级机制                │
│                                                         │
│ 队列 B (知识库增强)                                     │
│ ├─ Week 1-3: 向量搜索基础 (Qdrant)                    │
│ ├─ Week 4-5: 热冷数据分层                             │
│ └─ Week 7-9: 搜索优化 + 沙箱执行                      │
│                                                         │
│ 队列 C (离线支持)                                       │
│ ├─ Week 1-3: 事件溯源框架搭建                         │
│ ├─ Week 4-5: 完整离线支持 (基于队列 A)               │
│ └─ Week 5-6: 缓存策略完善                             │
│                                                         │
│ Week 10-12: 全面集成 + 优化 + 部署                    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

**Backend (Node.js)**:
- WebSocket: `ws` 0.8.14
- 推送队列: `ioredis` 5.3.0
- 向量搜索: `qdrant-client` 2.1.0
- CRDT: `yjs` 13.6.0
- 事件溯源: 自定义事件表 + 重放引擎

**Frontend (Tauri + React)**:
- WebSocket: `@tauri-apps/api`
- 降级: `eventsource` 2.0.2 (SSE)
- 向量搜索: `qdrant-client` (Rust)
- CRDT: `yjs` 13.6.0
- 事件溯源: 本地 SQLite + 重放引擎

---

## 3. 队列 A - 通信系统 (Week 1-9)

### 3.1 目标
企业管理后台 ↔ 本地实例的实时双向通信、离线透明切换、多实例协调。

### 3.2 Week 1-2: Push 通知 + WebSocket 基础 (M1)

**功能**:
- 单向推送（管理后台 → 本地实例）
- 推送通知类型：知识库更新、Agent 模板更新、Token 告警
- WebSocket 连接管理 (建立、心跳 30 秒、自动重连)
- 本地实例的 ACK 确认

**数据库**:
```sql
-- 推送通知
CREATE TABLE PushNotification (
  id TEXT PRIMARY KEY,
  enterpriseId TEXT NOT NULL,
  type TEXT, -- KNOWLEDGE_BASE_UPDATE, AGENT_TEMPLATE_UPDATE, TOKEN_ALERT
  payload JSON,
  createdAt TIMESTAMP,
  status TEXT -- sent, delivered, acked
);

-- WebSocket 会话
CREATE TABLE WebSocketSession (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  connectedAt TIMESTAMP,
  lastHeartbeat TIMESTAMP,
  status TEXT -- active, disconnected
);

-- 通知日志
CREATE TABLE NotificationLog (
  id TEXT PRIMARY KEY,
  notificationId TEXT,
  userId TEXT,
  deliveredAt TIMESTAMP,
  ackAt TIMESTAMP
);
```

**API 端点**:
```
POST /notifications/:notificationId/ack
GET /notifications/history
WebSocket /ws
```

**验收标准**:
- [ ] WebSocket 连接建立、心跳、自动重连
- [ ] 推送通知发送和 ACK 记录
- [ ] 离线通知历史可追赶 (GET /notifications/history)
- [ ] 测试用例 ≥ 12 个

### 3.3 Week 2-3: Pull 同步 + 增量更新 (M2)

**功能**:
- 本地实例定期拉取更新 (5 分钟周期或手动触发)
- 智能增量：版本号控制，只下载有变更的数据
- 支持多种资源：知识库文档、Agent 模板、Token 使用

**数据库**:
```sql
-- 同步日志
CREATE TABLE SyncLog (
  userId TEXT PRIMARY KEY,
  lastSyncAt TIMESTAMP,
  lastSyncVersion INT
);

-- 变更记录
CREATE TABLE ChangedItems (
  id TEXT PRIMARY KEY,
  type TEXT, -- document, template, usage
  itemId TEXT,
  version INT,
  changeTimestamp TIMESTAMP
);
```

**API 端点**:
```
GET /sync/status
POST /sync/pull
  Request: { lastSyncVersion, resources: ['documents', 'templates', 'usage'] }
  Response: { changes: [...], newVersion }
POST /sync/checkpoint
```

**验收标准**:
- [ ] 增量同步工作，无重复下载
- [ ] 版本号递增控制
- [ ] 冲突检测 (版本号不连续)
- [ ] 测试用例 ≥ 8 个

### 3.4 Week 4-5: WebSocket 完善 + 降级策略 (M3)

**功能**:
- WebSocket 健壮性：心跳、重连 (指数退避)、错误处理
- 降级策略：WebSocket → SSE → HTTP Polling
- 混合通信：同时使用 Push (实时) + Pull (可靠)

**降级流程**:
```
连接尝试 1 → WebSocket 成功 ✓
连接尝试 2-3 → WebSocket 失败 → 等待 1 秒
连接尝试 4+ → 降级 SSE
SSE 失败 3 次 → 降级 HTTP Polling (30 秒)
```

**验收标准**:
- [ ] 所有降级路径测试通过
- [ ] 重连指数退避正确（1s, 2s, 4s, ...）
- [ ] 混合通信：Push + Pull 同时工作
- [ ] 测试用例 ≥ 10 个

### 3.5 Week 5-6: 冲突解决 + CRDTs (M4)

**功能**:
- 简单冲突：版本号 + 时间戳 (大部分数据)
- 关键文档冲突：使用 Yjs CRDT 自动合并
- 冲突检测和解决算法

**冲突解决优先级**:
```
1. 版本号：本地 < 服务器 → 下载服务器版本
2. 时间戳：最后修改时间最新的获胜
3. CRDTs：自动合并冲突修改（关键文档）
```

**数据库**:
```sql
-- 冲突记录
CREATE TABLE DocumentConflict (
  documentId TEXT,
  localVersion INT,
  serverVersion INT,
  resolution TEXT -- crdt_merged, timestamp_resolved
);

-- 操作日志 (用于 CRDT 重放)
CREATE TABLE OperationLog (
  id TEXT PRIMARY KEY,
  documentId TEXT,
  operation JSON,
  timestamp TIMESTAMP
);
```

**验收标准**:
- [ ] Yjs CRDT 集成测试通过
- [ ] 冲突自动解决成功率 ≥ 95%
- [ ] 冲突历史可查询
- [ ] 测试用例 ≥ 10 个

### 3.6 Week 7-9: 事件溯源 + 降级机制 (M5)

**功能**:
- 所有操作记录为事件（不可变日志）
- 事件重放引擎（可从任何时间点恢复状态）
- 降级机制的完善

**事件模型**:
```typescript
interface Event {
  id: string
  userId: string
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE'
  resource: 'conversation' | 'agent' | 'document' | 'task'
  resourceId: string
  payload: any
  timestamp: DateTime
  version: number
  status: 'pending' | 'synced'
}
```

**验收标准**:
- [ ] 事件完整性日志 (100% 操作记录)
- [ ] 事件重放正确性（重放 = 原始结果）
- [ ] 降级机制在各种网络状况下正常工作
- [ ] 测试用例 ≥ 15 个

---

## 4. 队列 B - 知识库增强 (Week 1-9)

### 4.1 目标
从关键词搜索升级到语义搜索，实现热冷数据分层，优化搜索体验。

### 4.2 Week 1-3: 向量搜索基础 (M1)

**功能**:
- Qdrant 向量数据库集成
- 文档向量化 (嵌入)
- 语义搜索实现

**嵌入模型**:
- 服务器端：OpenAI text-embedding-3-small
- 本地端：sentence-transformers (离线)
- 同步：服务器生成，本地缓存

**数据库**:
```sql
CREATE TABLE DocumentEmbedding (
  documentId TEXT,
  version INT,
  embedding FLOAT[], -- 向量
  createdAt TIMESTAMP
);

CREATE TABLE SearchLog (
  id TEXT PRIMARY KEY,
  query TEXT,
  userId TEXT,
  resultCount INT,
  topScore FLOAT,
  timestamp TIMESTAMP
);
```

**API 端点**:
```
POST /knowledge-base/search/semantic
  Request: { query, topK: 10 }
  Response: { results: [{ documentId, title, score, snippet }] }
POST /knowledge-base/:id/embedding (生成向量)
GET /knowledge-base/search-stats
```

**验收标准**:
- [ ] 向量搜索工作 (本地 + 远程)
- [ ] 搜索准确率评估 (Top 10 相关度)
- [ ] 性能 < 500ms
- [ ] 测试用例 ≥ 10 个

### 4.3 Week 2-4: 热冷数据分层 (M2)

**功能**:
- 热数据（30 天内）：本地 SQLite + Qdrant
- 冷数据（超过 30 天）：服务器 PostgreSQL + Qdrant
- 自动分层和迁移

**热冷定义**:
```
热数据：最近 30 天内被访问过的文档
冷数据：超过 30 天未被访问的文档
转移：每天评估，自动转移
```

**缓存策略**:
```
初始化：下载最近 30 天的热数据
定期同步：每天检查新增/更新
访问时：冷数据自动下载到本地
定期清理：超过 30 天自动删除
```

**数据库**:
```sql
CREATE TABLE AccessLog (
  documentId TEXT,
  userId TEXT,
  accessedAt TIMESTAMP
);

CREATE TABLE CachePolicy (
  documentId TEXT,
  hotUntil TIMESTAMP,
  tier TEXT -- hot, cold
);
```

**验收标准**:
- [ ] 热冷分层自动工作
- [ ] 搜索流程：本地 → 远程 (快到慢)
- [ ] 缓存命中率 ≥ 70%
- [ ] 存储占用可控 (< 1GB)
- [ ] 测试用例 ≥ 10 个

### 4.4 Week 4-5: 搜索优化 (M3)

**功能**:
- 高级搜索语法 (AND/OR/NOT)
- 排序：相关度、时间、热度
- 自动完成 (搜索建议)
- 搜索分析 (热门查询、无结果)

**搜索语法**:
```
"销售 AND 政策" → 两个词都出现
"销售 OR 商业" → 至少一个出现
"销售 NOT 退货" → 排除某个词
```

**验收标准**:
- [ ] 高级搜索语法正确解析
- [ ] 搜索建议自动完成工作
- [ ] 热门查询统计正确
- [ ] 无结果查询识别 (用于改进)
- [ ] 测试用例 ≥ 12 个

### 4.5 Week 7-9: 安全隔离 - 沙箱执行 (可选)

**功能**:
- 白名单模式：只允许预定义的命令
- 资源限制：CPU、内存、磁盘、网络
- 超时限制：30 秒
- 审批流程：危险操作需要管理员审批

**验收标准**:
- [ ] 沙箱执行隔离工作
- [ ] 超时机制正确
- [ ] 审批流程可用
- [ ] 测试用例 ≥ 8 个

---

## 5. 队列 C - 离线支持完整化 (Week 1-9)

### 5.1 目标
完整的离线工作流、上线后自动同步、无数据丢失、智能缓存。

### 5.2 Week 1-3: 事件溯源框架 (M1)

**功能**:
- 所有操作记录为事件（不可变）
- 事件存储到本地 SQLite
- 事件版本号控制

**本地队列**:
```
conversations: 本地创建的对话
agents: 本地创建的 Agent
documents: 本地编辑的文档
tasks: 执行的任务
tokenUsage: Token 使用记录
syncQueue: 待同步事件
```

**验收标准**:
- [ ] 事件记录完整
- [ ] 版本号递增正确
- [ ] 事件持久化到 SQLite
- [ ] 测试用例 ≥ 10 个

### 5.3 Week 2-4: 完整离线支持 (M2)

**功能**:
- 离线时创建对话、执行 Agent、编辑本地知识库
- 上线后自动同步所有变更
- 冲突自动解决 (基于队列 A 的 CRDTs)

**离线时可做的事**:
```
✅ 创建新对话
✅ 执行 Agent (基于本地模型)
✅ 编辑本地知识库
✅ 查看已缓存的企业知识库
✅ 查看对话历史
✅ 创建/编辑 Agent
✅ 记录 Token 使用
```

**上线同步流程**:
```
1. 检查网络连接
2. 获取服务器版本
3. 合并数据：
   - 新创建的对话 → 上传
   - 编辑的对话 → 冲突检测
   - 新创建的 Agent → 上传
   - 编辑的 Agent → 冲突检测
   - Token 使用 → 批量上报
   - 事件 → 重放到服务器
4. 同步本地缓存
5. 标记事件为 synced
```

**数据库**:
```sql
CREATE TABLE Event (
  id TEXT PRIMARY KEY,
  userId TEXT,
  type TEXT, -- CREATE, UPDATE, DELETE, EXECUTE
  resource TEXT,
  resourceId TEXT,
  payload JSON,
  timestamp TIMESTAMP,
  version INT,
  status TEXT -- pending, synced
);

CREATE TABLE SyncQueue (
  eventId TEXT PRIMARY KEY,
  status TEXT -- pending, syncing, synced
);
```

**验收标准**:
- [ ] 离线创建的对话可以上线同步
- [ ] 事件重放正确
- [ ] 冲突自动解决
- [ ] 无数据丢失
- [ ] 测试用例 ≥ 15 个

### 5.4 Week 4-5: 缓存策略完善 (M3)

**功能**:
- L1：热对话 (最近 7 天，100 MB，内存)
- L2：对话归档 (最近 30 天，500 MB，磁盘)
- L3：知识库热数据 (30 天，1 GB)
- L4：Agent 模板 (无限期)
- 自动淘汰 (LRU) 和用户控制

**存储清理**:
```
定期检查（每天 1 次）
- 超过容量 → 触发淘汰
- LRU 优先删除
- 用户可手动清空缓存
```

**压缩机制**:
```
对话压缩：保留最新 10 条消息
附件压缩：图片 JPEG、去重
数据库优化：定期 VACUUM
```

**验收标准**:
- [ ] 多层缓存工作正确
- [ ] 自动淘汰 LRU 正确
- [ ] 存储占用可控
- [ ] 压缩率 > 30%
- [ ] 测试用例 ≥ 10 个

### 5.5 Week 5-6: 集成与健壮性 (M4)

**功能**:
- 双向同步确认
- 冲突处理 (基于混合 CRDTs)
- 断线重连
- 数据验证和修复

**验收标准**:
- [ ] 双向同步正确
- [ ] 断线重连工作
- [ ] 数据一致性验证通过
- [ ] 修复机制可用
- [ ] 测试用例 ≥ 12 个

---

## 6. 时间表与里程碑

### 6.1 总体时间表

```
Week 1-3: 三队列 M1 里程碑
├─ 队列 A: Push 通知 + WebSocket 基础
├─ 队列 B: 向量搜索基础
└─ 队列 C: 事件溯源框架

Week 4-6: 三队列深化与依赖
├─ 队列 A: WebSocket 完善 + CRDTs (M3-M4)
├─ 队列 B: 热冷数据分层 (M2)
└─ 队列 C: 完整离线支持 (M2)

Week 7-9: 高级功能与优化
├─ 队列 A: 事件溯源完整化
├─ 队列 B: 搜索优化 + 沙箱执行
└─ 队列 C: 缓存策略 + 集成

Week 10-12: 全面集成、优化、部署
├─ Week 10: 三队列集成测试
├─ Week 11: 性能优化 + 文档
└─ Week 12: UAT + 上线准备
```

### 6.2 成功标准

| 指标 | 目标 |
|------|------|
| 功能完整 | P0 100% + P1 80% |
| 测试覆盖 | > 200 个测试用例 |
| 测试通过率 | 100% |
| API 性能 | < 500ms |
| 搜索准确率 | > 80% |
| 离线同步成功率 | 100% |
| 安全审计 | 0 个关键漏洞 |

---

## 7. 风险管理

| 风险 | 等级 | 队列 | 缓解方案 |
|------|------|------|--------|
| WebSocket 连接不稳定 | 中 | A | 充分心跳/重连测试，降级机制 |
| CRDT 冲突复杂性 | 中 | A/C | 选择成熟库 (Yjs)，充分测试 |
| Qdrant 性能 | 中 | B | 压力测试 10K+ 文档 |
| 事件重放一致性 | 高 | C | 多重验证、审计日志 |
| 三队列集成复杂性 | 高 | 全 | 定期集成检查点 |
| 时间计划滑期 | 中 | 全 | 每周进度评估 |

---

## 8. 依赖关系

```
Week 1-3: 三队列独立并行
  ├─ 队列 A 完成 M1 ✓
  ├─ 队列 B 完成 M1 ✓
  └─ 队列 C 完成 M1 ✓

Week 4-6: 队列 A 支持队列 B/C
  ├─ 队列 A 完成 M3 → 队列 B/C 可使用推送、同步
  ├─ 队列 B 完成 M2 → 队列 C 可缓存知识库
  └─ 队列 C 完成 M2 → 完整离线工作流

Week 7-9: 高度集成
  ├─ 队列 A/B/C 的高级功能相互依赖
  └─ 定期集成测试

Week 10-12: 全面集成
  ├─ 三队列汇聚
  ├─ 系统级集成测试
  └─ 性能优化和部署准备
```

---

## 9. 后续计划 (Batch 4+)

- 许可证管理 (P2, 5-7 天)
- 协作编辑 (P3, 8-12 天)
- 入侵检测 (P2, 8-10 天)
- 多语言支持 (P3, 3-5 天)
- 移动端支持 (P3, 12-16 天)

---

**设计完成日期**: 2026-03-15
**下一步**: 调用 `writing-plans` skill 生成详细的实现计划
