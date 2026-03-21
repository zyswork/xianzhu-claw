# 补全缺失功能 - 完整实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 补全 my-openclaw Admin Platform 的所有 20+ 个缺失功能，从 60% 完成度提升至 100% 生产级。

**Architecture:**
- 批次化并行实现（3 个批次，共 35+ 个任务）
- 批次 1（基础设施）先行完成，为批次 2 铺垫
- 批次 2 的 4 个子模块可独立并行
- 批次 3 基于前两个批次，主要是优化和高级功能
- 采用 TDD 模式：失败测试 → 最小实现 → 通过测试 → 提交

**Tech Stack:**
- 前端: React 18, TypeScript, Zustand, Vite
- 后端: Node.js, Express, TypeScript
- 数据库: PostgreSQL + Prisma ORM
- 邮件: Nodemailer
- 测试: Vitest (前端), Jest (后端)
- 文件上传: Multer
- 实时通信: Socket.io (后续)

---

## 前置准备

在开始任何任务之前，确保：
1. 在 git worktree 中隔离工作空间
2. 创建 feature branch: `git checkout -b feature/complete-missing-features`
3. 更新记忆文件: `.claude/projects/.../MEMORY.md`

---

# 批次 1: 基础设施 (2 周)

## Task 1.1: 设置 PostgreSQL 和 Prisma ORM

### 文件:
- Create: `admin-backend/prisma/schema.prisma` - Prisma 数据库 schema
- Create: `admin-backend/.env.example` - 环境变量模板
- Create: `docker-compose.yml` - PostgreSQL Docker 配置
- Modify: `admin-backend/package.json` - 添加 Prisma 依赖
- Create: `admin-backend/src/db/prisma.ts` - Prisma 客户端

### 步骤

**Step 1: 安装 Prisma 依赖**

运行命令:
```bash
cd admin-backend
npm install @prisma/client prisma --save
npm install -D prisma
```

验证:
```bash
npx prisma --version
```

预期: 显示 Prisma 版本号 (如 v5.x.x)

**Step 2: 创建 Prisma Schema**

文件: `admin-backend/prisma/schema.prisma`

```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/d/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Enterprise {
  id        String     @id @default(cuid())
  name      String
  industry  String?
  contact   Json?      // { email, phone, address }
  subscription Json?   // { plan, startDate, renewalDate, status }
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  users              User[]
  documents          KnowledgeBaseDocument[]
  templates          AgentTemplate[]
  tokenUsage         TokenUsage[]
  tokenAlerts        TokenAlert[]

  @@index([name])
}

model User {
  id        String     @id @default(cuid())
  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  enterpriseId String

  email     String
  name      String
  passwordHash String
  role      String     @default("user") // admin, user, viewer
  permissions String[] @default([])     // read, write, delete, manage
  status    String     @default("active") // active, inactive, suspended

  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
  lastLogin DateTime?

  activityLogs ActivityLog[]

  @@unique([email, enterpriseId])
  @@index([enterpriseId])
}

model KnowledgeBaseDocument {
  id        String     @id @default(cuid())
  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  enterpriseId String

  title     String
  content   String
  contentType String @default("text") // text, markdown, html
  tags      String[]
  permissions Json?   // { read: [], write: [] }
  version   Int      @default(1)
  status    String   @default("draft") // draft, published
  vectorized Boolean @default(false)

  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([enterpriseId])
  @@index([status])
}

model AgentTemplate {
  id        String     @id @default(cuid())
  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  enterpriseId String

  name      String
  description String?
  category  String?
  config    Json       // 模板配置
  version   String
  status    String     @default("draft") // draft, testing, published, deprecated
  permissions Json?    // { visibility, canUse[], canEdit[] }
  tags      String[]

  createdBy String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  publishedAt DateTime?

  @@index([enterpriseId])
  @@index([status])
}

model TokenUsage {
  id        String     @id @default(cuid())
  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  enterpriseId String

  userId    String
  timestamp DateTime @default(now())
  type      String   // query, execute, process, other
  module    String   // knowledge-base, agent, text-processing, other
  tokensUsed Int
  cost      Float
  status    String   @default("success") // success, failed
  details   Json?

  @@index([enterpriseId])
  @@index([timestamp])
}

model TokenAlert {
  id        String     @id @default(cuid())
  enterprise Enterprise @relation(fields: [enterpriseId], references: [id], onDelete: Cascade)
  enterpriseId String

  type      String     // threshold, budget
  threshold Int
  notificationChannels String[] // email, webhook
  status    String     @default("active") // active, resolved
  createdAt DateTime   @default(now())

  @@index([enterpriseId])
}

model ActivityLog {
  id        String     @id @default(cuid())
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String

  action    String     // create, update, delete, login
  resource  String     // user, document, template, etc
  details   Json?
  timestamp DateTime   @default(now())

  @@index([userId])
  @@index([timestamp])
}
```

验证:
```bash
npx prisma validate
```

预期: "✔ Your schema is valid"

**Step 3: 创建 Docker Compose 配置**

文件: `admin-backend/docker-compose.yml`

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: openclaw
      POSTGRES_PASSWORD: openclaw123
      POSTGRES_DB: openclaw_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openclaw"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

验证:
```bash
docker-compose up -d
docker-compose ps
```

预期: postgres 容器正在运行

**Step 4: 创建 .env.example**

文件: `admin-backend/.env.example`

```env
# Database
DATABASE_URL="postgresql://openclaw:openclaw123@localhost:5432/openclaw_db?schema=public"

# JWT
JWT_SECRET="your-secret-key-here"
JWT_EXPIRE="7d"

# Mail
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"

# App
NODE_ENV="development"
PORT="3001"
```

验证:
```bash
cd admin-backend && cp .env.example .env
```

**Step 5: 创建 Prisma 客户端模块**

文件: `admin-backend/src/db/prisma.ts`

```typescript
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
})

export default prisma
```

验证:
```bash
npx prisma generate
```

预期: Prisma Client 生成成功

**Step 6: 初始化数据库**

运行:
```bash
npx prisma migrate dev --name init
```

预期: 创建初始 migration 文件，并在 PostgreSQL 中创建表

**Step 7: 提交**

```bash
git add admin-backend/prisma/ admin-backend/.env.example admin-backend/src/db/prisma.ts docker-compose.yml admin-backend/package.json
git commit -m "feat: 集成 Prisma ORM 和 PostgreSQL

- 添加 Prisma schema 定义（用户、知识库、模板、Token 等 5 个主表）
- 创建 Docker Compose PostgreSQL 配置
- 初始化 Prisma 客户端
- 执行初始数据库迁移

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 1.2: 迁移现有数据库逻辑到 Prisma

### 文件:
- Modify: `admin-backend/src/routes/users.ts` - 使用 Prisma 替代内存 DB
- Modify: `admin-backend/src/routes/knowledge-base.ts`
- Modify: `admin-backend/src/routes/agent-templates.ts`
- Modify: `admin-backend/src/routes/token-monitoring.ts`
- Modify: `admin-backend/src/routes/enterprises.ts`
- Delete: `admin-backend/src/db/index.ts` (旧的内存数据库)

### 步骤

**Step 1: 更新 users 路由使用 Prisma**

修改: `admin-backend/src/routes/users.ts`

```typescript
import { Router, Request, Response } from 'express'
import prisma from '../db/prisma.js'

const router = Router()

// 获取用户列表
router.get('/enterprise/:enterpriseId', async (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const users = await prisma.user.findMany({
      where: { enterpriseId },
    })
    res.json({ users, total: users.length })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    res.status(500).json({ error: '获取用户列表失败' })
  }
})

// 创建用户
router.post('/enterprise/:enterpriseId', async (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { email, name, role, permissions } = req.body

    const user = await prisma.user.create({
      data: {
        enterpriseId,
        email,
        name,
        role: role || 'user',
        permissions: permissions || [],
        passwordHash: 'temp_hash', // 后续完善
      },
    })
    res.status(201).json(user)
  } catch (error) {
    console.error('创建用户失败:', error)
    res.status(500).json({ error: '创建用户失败' })
  }
})

// 获取用户详情
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
    })
    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }
    res.json(user)
  } catch (error) {
    res.status(500).json({ error: '获取用户失败' })
  }
})

// 更新用户
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: req.body,
    })
    res.json(user)
  } catch (error) {
    res.status(500).json({ error: '更新用户失败' })
  }
})

// 删除用户
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.user.delete({
      where: { id: req.params.id },
    })
    res.json({ message: '用户已删除' })
  } catch (error) {
    res.status(500).json({ error: '删除用户失败' })
  }
})

export default router
```

验证:
```bash
npm run dev
curl http://localhost:3001/users/enterprise/ent_xxx
```

预期: 返回用户列表 (可能为空，但无错误)

**Step 2: 同步更新其他路由**

对以下文件重复类似步骤：
- knowledge-base.ts - 使用 `prisma.knowledgeBaseDocument`
- agent-templates.ts - 使用 `prisma.agentTemplate`
- token-monitoring.ts - 使用 `prisma.tokenUsage`
- enterprises.ts - 使用 `prisma.enterprise`

（详细代码省略，遵循相同的 Prisma 模式）

**Step 3: 删除旧的内存数据库模块**

运行:
```bash
rm admin-backend/src/db/index.ts
```

验证:
```bash
grep -r "from.*db/index" admin-backend/src/
```

预期: 无搜索结果 (所有导入已更新)

**Step 4: 运行测试**

```bash
npm test
```

预期: 所有测试通过

**Step 5: 提交**

```bash
git add admin-backend/src/routes/
git commit -m "feat: 迁移数据库逻辑到 Prisma ORM

- 更新所有 5 个路由模块使用 Prisma 客户端
- 删除旧的内存数据库模块
- 保持 API 接口兼容性
- 所有测试通过

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 1.3: 实现 Token 刷新机制

### 文件:
- Modify: `admin-backend/src/routes/auth.ts` - 添加 refresh-token, verify-email, logout 等
- Create: `admin-backend/src/middleware/refresh-token.ts` - Token 刷新中间件
- Modify: `admin-backend/src/middleware/auth.ts` - 更新认证中间件支持 refresh token
- Create: `tests/auth.test.ts` - 认证流程测试

### 步骤

**Step 1: 编写失败测试 - Token 刷新**

文件: `admin-backend/tests/auth.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/index.js'

describe('认证模块', () => {
  describe('POST /auth/refresh-token', () => {
    it('应该用 refresh token 获取新的 access token', async () => {
      // 先登录获取 tokens
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
          enterpriseId: 'ent_test',
        })

      expect(loginRes.status).toBe(200)
      const { token: accessToken, refreshToken } = loginRes.body

      // 用 refresh token 获取新 access token
      const refreshRes = await request(app)
        .post('/auth/refresh-token')
        .send({ refreshToken })

      expect(refreshRes.status).toBe(200)
      expect(refreshRes.body).toHaveProperty('token')
      expect(refreshRes.body.token).not.toBe(accessToken) // 新 token
    })

    it('refresh token 无效时应返回 401', async () => {
      const res = await request(app)
        .post('/auth/refresh-token')
        .send({ refreshToken: 'invalid_token' })

      expect(res.status).toBe(401)
    })
  })

  describe('GET /auth/me', () => {
    it('应该返回当前用户信息', async () => {
      // 登录
      const loginRes = await request(app)
        .post('/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password123',
          enterpriseId: 'ent_test',
        })

      const { token } = loginRes.body

      // 获取当前用户
      const meRes = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(meRes.status).toBe(200)
      expect(meRes.body).toHaveProperty('email', 'test@example.com')
    })
  })
})
```

运行:
```bash
npm test tests/auth.test.ts
```

预期: 测试失败 (因为 API 还没实现)

**Step 2: 实现 Token 刷新 API**

修改: `admin-backend/src/routes/auth.ts`

```typescript
import { Router, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../db/prisma.js'

const router = Router()
const JWT_SECRET = process.env.JWT_SECRET || 'secret'

// 现有的登录端点...

// 新增: POST /auth/refresh-token
router.post('/refresh-token', (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body

    if (!refreshToken) {
      res.status(400).json({ error: 'Refresh token 不能为空' })
      return
    }

    // 验证 refresh token
    const decoded = jwt.verify(refreshToken, JWT_SECRET + '_refresh')
    if (typeof decoded !== 'object' || !decoded.id) {
      res.status(401).json({ error: 'Refresh token 无效' })
      return
    }

    // 生成新的 access token
    const newAccessToken = jwt.sign(
      { id: decoded.id, email: decoded.email, enterpriseId: decoded.enterpriseId },
      JWT_SECRET,
      { expiresIn: '1h' }
    )

    res.json({ token: newAccessToken })
  } catch (error) {
    res.status(401).json({ error: 'Refresh token 验证失败' })
  }
})

// 新增: GET /auth/me
router.get('/me', (req: Request, res: Response) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (!token) {
      res.status(401).json({ error: '未提供 token' })
      return
    }

    const decoded = jwt.verify(token, JWT_SECRET)
    if (typeof decoded !== 'object' || !decoded.id) {
      res.status(401).json({ error: 'Token 无效' })
      return
    }

    // 从数据库获取用户最新信息
    prisma.user.findUnique({ where: { id: decoded.id } }).then((user) => {
      if (!user) {
        res.status(404).json({ error: '用户不存在' })
        return
      }
      res.json({ id: user.id, email: user.email, name: user.name })
    })
  } catch (error) {
    res.status(401).json({ error: '获取用户失败' })
  }
})

export default router
```

验证:
```bash
npm test tests/auth.test.ts
```

预期: 新的测试通过

**Step 3: 提交**

```bash
git add admin-backend/src/routes/auth.ts admin-backend/tests/auth.test.ts
git commit -m "feat: 实现 Token 刷新和当前用户获取

- 添加 POST /auth/refresh-token 端点
- 添加 GET /auth/me 端点
- 支持 refresh token 机制
- 完整的单元测试覆盖

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 1.4: 实现通知系统框架

(类似的 TDD 步骤，篇幅限制，这里简化展示关键代码)

### 实现要点:
- 集成 Nodemailer
- 邮件模板
- Webhook 签名和重试

---

*由于篇幅限制，完整计划包含 35+ 个详细任务。下面是任务概览：*

---

# 任务概览与预计工期

## 批次 1: 基础设施 (2 周)
- Task 1.1: PostgreSQL + Prisma ORM ✅ (详见上)
- Task 1.2: 数据库迁移 ✅ (详见上)
- Task 1.3: Token 刷新 ✅ (详见上)
- Task 1.4: 通知系统框架 (1 周)
- Task 1.5: 密码重置和邮箱验证 (3 天)

## 批次 2: 核心模块并行 (3 周)

### 子批次 2a: 用户管理完整化 (1 周)
- Task 2a.1: 批量创建用户
- Task 2a.2: 批量删除用户
- Task 2a.3: 用户状态管理
- Task 2a.4: 活动日志系统
- Task 2a.5: 前端批量操作 UI

### 子批次 2b: 知识库版本控制 (1 周)
- Task 2b.1: 版本历史 API
- Task 2b.2: 版本恢复功能
- Task 2b.3: 文件上传 (Multer)
- Task 2b.4: 条目发布流程
- Task 2b.5: 前端版本历史面板

### 子批次 2c: Agent 模板测试框架 (1 周)
- Task 2c.1: 模板测试 API
- Task 2c.2: 参数提取功能
- Task 2c.3: 配置导入导出
- Task 2c.4: 模板克隆
- Task 2c.5: 前端测试页面

### 子批次 2d: Token 监控完整化 (1.5 周)
- Task 2d.1: 真实告警通知
- Task 2d.2: 报告导出 (PDF/Excel)
- Task 2d.3: 趋势数据和预测
- Task 2d.4: 预算管理
- Task 2d.5: 前端预算设置页面

## 批次 3: 高级功能和优化 (2 周)
- Task 3.1: RAG/向量化搜索
- Task 3.2: 实时更新 (WebSocket)
- Task 3.3: 自动化框架
- Task 3.4: OpenAPI 文档
- Task 3.5: 性能优化和安全审计

---

# 执行策略

**总体时间**: 4-6 周 (按设计方案)

**并行度**:
- 批次 1: 顺序执行 (2 周)
- 批次 2: 4 个子模块可并行，但在批次 1 完成后开始
- 批次 3: 基于批次 2 完成后进行

**每个任务的流程**:
1. 写失败测试 (TDD)
2. 实现最小代码
3. 测试通过
4. 提交

**验证和评审**:
- 每个任务完成后运行 `npm test`
- 每周做一次 code review
- 性能基准对比

---

# 进度跟踪

## 检查清单

使用以下命令跟踪进度：

```bash
# 运行所有测试
npm test

# 查看测试覆盖率
npm test -- --coverage

# 检查 API 文档
npm run docs

# 性能基准
npm run benchmark
```

## 每日 Commit 模板

```bash
git commit -m "feat: [任务号] - [功能名称]

- [实现细节 1]
- [实现细节 2]
- [测试覆盖]

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

*本计划文档是第一部分（批次 1 详细展开，批次 2-3 概览）。*
*执行过程中会根据实际情况调整，但整体框架和优先级不变。*

*Generated: 2026-03-15*
