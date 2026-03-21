# my-openclaw 生产部署实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 my-openclaw 项目部署到生产环境

**架构：** 本地 Tauri 应用 → 服务器 Express API (39.102.55.3:3000) → PostgreSQL 14

**技术栈：** Node.js + Express + PostgreSQL 14 + Tauri + React

---

## 第一阶段：后端数据库迁移

### Task 1.1: 安装 PostgreSQL 驱动

**Step 1: 安装 pg 包**
```bash
cd admin-backend
npm install pg @types/pg
```

**Step 2: 验证安装**
```bash
npm list pg
```

**Step 3: 提交**
```bash
git add admin-backend/package.json admin-backend/package-lock.json
git commit -m "feat: add PostgreSQL driver dependency"
```

---

### Task 1.2: 创建 PostgreSQL 连接模块

**文件：** `admin-backend/src/db/postgres.ts`

**Step 1: 创建模块**
```typescript
import { Pool } from 'pg'

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'openclaw',
  user: process.env.DB_USER || 'openclaw_user',
  password: process.env.DB_PASSWORD || '',
  max: 20,
})

export default pool
```

**Step 2: 提交**
```bash
git add admin-backend/src/db/postgres.ts
git commit -m "feat: create PostgreSQL connection module"
```

---

## 第二阶段：后端部署到服务器

### Task 2.1: 准备服务器环境

**Step 1: 在服务器上创建应用目录**
```bash
ssh -i ~/.ssh/google_compute_engine zys@39.102.55.3
mkdir -p /opt/openclaw
cd /opt/openclaw
```

**Step 2: 上传代码**
```bash
scp -i ~/.ssh/google_compute_engine -r admin-backend zys@39.102.55.3:/opt/openclaw/
```

**Step 3: 安装依赖**
```bash
cd /opt/openclaw/admin-backend
npm install --production
npm run build
```

**Step 4: 配置环境变量**
```bash
cat > .env << EOF
NODE_ENV=production
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=openclaw
DB_USER=openclaw_user
DB_PASSWORD=secure_password
JWT_SECRET=your_jwt_secret
EOF
```

**Step 5: 启动服务**
```bash
npm install -g pm2
pm2 start dist/index.js --name openclaw-api
pm2 save
```

**Step 6: 验证服务**
```bash
curl http://localhost:3000/health
```

---

## 第三阶段：本地应用配置和打包

### Task 3.1: 配置 API 地址

**文件：** `frontend/src/config/api.ts`

**Step 1: 更新配置**
```typescript
export const API_BASE_URL = 'http://39.102.55.3:3000'
export const WS_URL = 'ws://39.102.55.3:3000'
```

**Step 2: 提交**
```bash
git add frontend/src/config/api.ts
git commit -m "feat: configure production API endpoints"
```

---

### Task 3.2: 打包 Tauri 应用

**Step 1: 构建前端**
```bash
cd frontend
npm run build
```

**Step 2: 打包应用**
```bash
cd local-app
npm run tauri build
```

**Step 3: 验证生成的文件**
```bash
ls -la local-app/src-tauri/target/release/bundle/
```

**Step 4: 提交**
```bash
git add -A
git commit -m "feat: build production Tauri application"
```

---

## 部署检查清单

- [ ] PostgreSQL 驱动已安装
- [ ] 后端代码已上传到服务器
- [ ] 环境变量已配置
- [ ] 后端服务已启动 (pm2)
- [ ] API 地址已配置
- [ ] Tauri 应用已打包
- [ ] 系统测试已通过

---

**计划完成！** 现在可以开始执行。
