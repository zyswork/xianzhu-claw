# Week 4-6 深度集成实现计划

> **对于 Claude**: 必须使用 superpowers:subagent-driven-development 来并行执行这个计划的多个任务。

**目标**: 完成 Queue A M3-M4、Queue B M2、Queue C M2 的深度集成，支持完整的离线-在线同步工作流。

**架构**: 
- Queue A M3 建立持久连接和重连机制
- Queue A M4 使用 Yjs CRDT 解决冲突
- Queue B M2 实现热数据缓存和冷数据分层
- Queue C M2 完整离线支持，事件回放和优先级同步

**技术栈**: ws (WebSocket)、Yjs (CRDT)、better-sqlite3、Redis (缓存)、Qdrant

---

## 第一阶段：Queue A M3 - WebSocket 连接持久化 (Week 4, 5 天)

### 任务 1.1: 连接重连机制

**文件**:
- 修改: `admin-backend/src/websocket/ws-manager.ts`
- 修改: `admin-backend/src/websocket/index.ts`
- 创建: `admin-backend/src/websocket/reconnect.ts`
- 测试: `admin-backend/tests/websocket-reconnect.test.ts`

**目的**: 实现连接断开后的自动重连，支持指数退避策略（最多 3 次重试，间隔 1-30 秒）。

**具体要求**:
1. 创建 ReconnectManager 类，支持指数退避（初始 1 秒，最大 30 秒，倍数 2）
2. 连接断开时自动尝试重连
3. 3 次失败后停止重试，更新会话为 'disconnected'
4. 测试: 验证重连次数、延迟时间、最终状态
5. 所有测试必须通过

**完成标志**: 
- [ ] reconnect.ts 实现完成
- [ ] ws-manager.ts 集成重连逻辑
- [ ] 3+ 个重连相关测试通过
- [ ] 代码提交

---

### 任务 1.2: 会话持久化存储

**文件**:
- 修改: `admin-backend/src/db/sqlite.ts`
- 修改: `admin-backend/src/db/index.ts`
- 创建: `admin-backend/src/models/session.ts`
- 测试: `admin-backend/tests/session-persistence.test.ts`

**目的**: 在数据库中持久化 WebSocket 会话状态，支持连接恢复。

**具体要求**:
1. 定义 WebSocketSession 数据模型（id, userId, connectedAt, lastHeartbeat, status）
2. 创建/读取/更新会话数据库方法
3. 断开连接时保存会话状态
4. 重连时恢复会话
5. 2+ 个持久化测试通过

**完成标志**:
- [ ] session.ts 模型定义
- [ ] 数据库方法实现
- [ ] 2+ 个持久化测试通过
- [ ] 代码提交

---

### 任务 1.3: 心跳和健康检查

**文件**:
- 修改: `admin-backend/src/websocket/ws-manager.ts`
- 创建: `admin-backend/src/websocket/health-check.ts`
- 测试: `admin-backend/tests/websocket-health.test.ts`

**目的**: 检测僵尸连接，自动清理断开的会话，维持连接活跃。

**具体要求**:
1. 实现 5 秒超时检测（无响应则视为僵尸连接）
2. 自动清理断开的会话
3. 每 30 秒发送 ping，等待 pong 响应
4. 提供健康检查指标（活跃连接数、失败率）
5. 2+ 个健康检查测试通过

**完成标志**:
- [ ] health-check.ts 实现
- [ ] 集成到 ws-manager 和 index.ts
- [ ] 2+ 个健康检查测试通过
- [ ] 代码提交

---

## 第二阶段：Queue A M4 - CRDT 冲突解决 (Week 5, 3 天)

### 任务 2.1: Yjs 集成与同步

**文件**:
- 创建: `admin-backend/src/crdt/yjs-manager.ts`
- 创建: `admin-backend/src/crdt/sync.ts`
- 创建: `admin-backend/src/services/crdt.service.ts`
- 测试: `admin-backend/tests/crdt-sync.test.ts`

**目的**: 集成 Yjs CRDT 库，支持无冲突的并发编辑和自动同步。

**具体要求**:
1. 安装 yjs 和 lib0 依赖
2. 实现 YjsManager 类（文档管理、状态编码/解码）
3. 实现状态向量同步（sync step）
4. 支持两个客户端并发编辑合并（无冲突）
5. 3+ 个 CRDT 测试通过（并发编辑、一致性、冲突解决）

**完成标志**:
- [ ] yjs 依赖安装
- [ ] YjsManager 和 sync.ts 实现
- [ ] 3+ 个 CRDT 测试通过（包括并发编辑冲突）
- [ ] 代码提交

---

## 第三阶段：Queue B M2 - 热冷数据分层 (Week 4-5, 5 天)

**依赖**: 等待 Queue A M3 完成（连接持久化）

### 任务 3.1: 缓存层设计与热冷数据分层

**文件**:
- 创建: `admin-backend/src/cache/cache-manager.ts`
- 创建: `admin-backend/src/cache/hot-cold-strategy.ts`
- 修改: `admin-backend/src/db/index.ts` (添加缓存装饰器)
- 测试: `admin-backend/tests/cache-hot-cold.test.ts`

**目的**: 实现热数据（频繁访问）缓存在内存，冷数据（不常用）存储在磁盘的分层策略。

**具体要求**:
1. 实现 CacheManager 类（LRU 缓存，最多 1000 条记录）
2. 实现热冷数据分层策略：访问频率 > 5 次/小时 = 热，自动晋升到缓存
3. 30 分钟未访问的热数据自动降级到磁盘
4. 支持手动晋升/降级
5. 3+ 个缓存和分层测试通过

**完成标志**:
- [ ] CacheManager 和 hot-cold-strategy.ts 实现
- [ ] 集成到数据库查询
- [ ] 3+ 个缓存测试通过（包括晋升/降级）
- [ ] 代码提交

---

### 任务 3.2: Qdrant 向量缓存与搜索优化

**文件**:
- 创建: `admin-backend/src/cache/vector-cache.ts`
- 修改: `admin-backend/src/services/qdrant.service.ts`
- 修改: `admin-backend/src/routes/search.ts`
- 测试: `admin-backend/tests/vector-cache.test.ts`

**目的**: 缓存频繁的向量搜索结果，减少 Qdrant 查询，提升搜索性能。

**具体要求**:
1. 实现 VectorCache 类（缓存搜索结果和 embeddings）
2. 查询相同或相似的 embedding 返回缓存结果（相似度 > 0.95）
3. 插入/更新文档时自动失效相关缓存
4. 缓存命中率 > 70% 的测试场景
5. 2+ 个向量缓存测试通过

**完成标志**:
- [ ] VectorCache 实现
- [ ] 集成到 Qdrant 查询
- [ ] 2+ 个向量缓存测试通过（包括命中率）
- [ ] 代码提交

---

## 第四阶段：Queue C M2 - 完整离线支持 (Week 5-6, 5 天)

**依赖**: 等待 Queue A M4 完成（CRDT）和 Queue B M2 完成（缓存）

### 任务 4.1: 事件回放引擎

**文件**:
- 创建: `admin-backend/src/services/event-replay.service.ts`
- 修改: `admin-backend/src/db/index.ts` (事件查询方法)
- 测试: `admin-backend/tests/event-replay.test.ts`

**目的**: 从事件日志重建任意时间点的资源状态，支持离线恢复和审计追踪。

**具体要求**:
1. 实现 EventReplayService 类
2. 从事件日志顺序回放，重建资源当前状态
3. 支持指定时间戳，重建该时刻的资源状态
4. 处理 CREATE/UPDATE/DELETE/EXECUTE 四种事件类型
5. 3+ 个事件回放测试通过（包括部分回放、时间旅行）

**完成标志**:
- [ ] EventReplayService 实现
- [ ] 事件查询方法扩展
- [ ] 3+ 个事件回放测试通过（包括时间旅行）
- [ ] 代码提交

---

### 任务 4.2: 优先级同步队列

**文件**:
- 创建: `admin-backend/src/sync/priority-sync.ts`
- 修改: `admin-backend/src/db/sqlite.ts` (sync_queue 表扩展)
- 修改: `admin-backend/src/db/index.ts` (同步方法)
- 测试: `admin-backend/tests/priority-sync.test.ts`

**目的**: 实现优先级队列，关键事件（TOKEN_ALERT）优先同步，支持离线排队和重试。

**具体要求**:
1. 实现 PrioritySyncQueue 类
2. 优先级分层: TOKEN_ALERT (优先级 1) > 其他 (优先级 2)
3. 支持带宽限制（每秒最多 10 个事件）
4. 离线时自动排队，重连后自动同步
5. 最多重试 3 次，指数退避
6. 2+ 个优先级同步测试通过

**完成标志**:
- [ ] PrioritySyncQueue 实现
- [ ] sync_queue 表扩展（priority, retries）
- [ ] 2+ 个优先级同步测试通过（包括重试）
- [ ] 代码提交

---

### 任务 4.3: 完整离线工作流集成测试

**文件**:
- 创建: `admin-backend/tests/offline-workflow.integration.test.ts`

**目的**: 验证完整的离线-在线循环：离线编辑 → 事件排队 → 重连同步 → 冲突解决 → 最终一致性。

**具体要求**:
1. 测试场景: 用户A和B离线编辑同一文档，重连后自动同步和冲突解决
2. 验证最终一致性（两个设备状态相同）
3. 验证事件顺序保证（使用版本号）
4. 验证优先级事件先同步
5. 1 个完整集成测试通过（覆盖整个离线-在线循环）

**完成标志**:
- [ ] 完整离线工作流集成测试实现
- [ ] 1+ 个集成测试通过（Multi-device 离线同步）
- [ ] 代码提交

---

## 执行检查点

### Checkpoint 2.1: Queue A M3 完成 (Week 4 末)
- [ ] 任务 1.1-1.3 全部通过
- [ ] 8+ 个 WebSocket 相关测试通过
- [ ] 连接持久化稳定可用

### Checkpoint 2.2: Queue A M4 完成 (Week 5 中)
- [ ] 任务 2.1 通过
- [ ] 3+ 个 CRDT 测试通过
- [ ] Queue B/C 可以开始开发

### Checkpoint 2.3: Queue B M2 完成 (Week 5 末)
- [ ] 任务 3.1-3.2 全部通过
- [ ] 5+ 个缓存相关测试通过
- [ ] 性能指标: 搜索延迟 < 200ms

### Checkpoint 2.4: Queue C M2 完成 (Week 6 末)
- [ ] 任务 4.1-4.3 全部通过
- [ ] 6+ 个离线相关测试通过
- [ ] 完整离线-在线循环验证通过

---

## 总体时间分配

| 阶段 | 任务 | 预计时间 | 开始时间 |
|------|------|---------|---------|
| 1 | 1.1-1.3 (Queue A M3) | 5 天 | Week 4 周一 |
| 2 | 2.1 (Queue A M4) | 3 天 | Week 5 周一 |
| 3 | 3.1-3.2 (Queue B M2) | 5 天 | Week 4 周三 (并行) |
| 4 | 4.1-4.3 (Queue C M2) | 5 天 | Week 5 周三 (并行) |

**并行策略**: Queue A 优先完成 M3，然后 B/C 可并行进行。

---

## 交付物

**代码**:
- 15+ 个新文件
- 5+ 个修改文件
- 4,000+ 行新代码
- 25+ 个新测试用例

**质量**:
- 100% 测试通过
- 规范合规性审查通过
- 代码质量审查通过
- 最终集成测试通过

**文档**:
- API 文档 (重连、CRDT、缓存、优先级同步)
- 架构文档 (离线-在线工作流)
- Checkpoint 2 验收报告

