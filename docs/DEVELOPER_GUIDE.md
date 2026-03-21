# OpenClaw 开发者指南

欢迎来到 OpenClaw 项目！本指南将帮助你快速上手开发工作。

## 目录

- [项目概述](#项目概述)
- [开发环境设置](#开发环境设���)
- [项目结构](#项目结构)
- [开发工作流](#开发工作流)
- [常见任务](#常见任务)
- [测试](#测试)
- [代码质量](#代码质量)
- [贡献指南](#贡献指南)
- [常见问题](#常见问题)

## 项目概述

OpenClaw 是一个企业级开源协作平台，由以下三个主要部分组成：

- **本地应用** (`local-app/`) - 使用 Rust + Tauri 构建的跨平台桌面应用
- **Web 前端** (`frontend/`) - 使用 React + Vite + TypeScript 构建的管理界面
- **后台 API** (`admin-backend/`) - 使用 Node.js + Express + TypeScript 构建的企业后台服务

## 开发环境设置

### 系统要求

- Node.js 18+ 和 npm 9+
- Rust 1.70+ (用于本地应用)
- Git

### 初��化项目

```bash
# 克隆仓库
git clone <repository-url>
cd my-openclaw

# 安装所有依赖
npm install --workspaces

# 或分别安装
cd frontend && npm install
cd ../admin-backend && npm install
cd ../local-app && cargo build
```

### 环境变量配置

创建 `.env` 文件在各个模块根目录：

**admin-backend/.env**
```
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
DATABASE_URL=sqlite:./data/openclaw.db
```

**frontend/.env**
```
VITE_API_URL=http://localhost:3000
```

### 启动开发服务器

```bash
# 后台 API (终端 1)
cd admin-backend
npm run dev

# 前端应用 (终端 2)
cd frontend
npm run dev

# 本地应用 (终端 3)
cd local-app
cargo tauri dev
```

## 项目结构

```
my-openclaw/
├── admin-backend/          # 企业后台 API
│   ├── src/
│   │   ├── db/            # 数据库配置和连接
│   │   ├── middleware/    # Express 中间件
│   │   ├── models/        # 数据模型
│   │   ├── routes/        # API 路由
│   │   ├── utils/         # 工具函数
│   │   └── index.ts       # 应用入口
│   ├── tests/             # 测试文件
│   └── package.json
│
├── frontend/              # Web 前端应用
│   ├── src/
│   │   ├── api/          # API 客户端
│   │   ├── components/   # React 组件
│   │   ├── hooks/        # 自定义 Hooks
│   │   ├── pages/        # 页面组件
│   │   ├── store/        # Zustand 状态管理
│   │   ├── __tests__/    # 测试文件
│   │   ├── App.tsx       # 应用根组件
│   │   └── main.tsx      # 应用入口
│   └── package.json
│
├── local-app/            # Tauri 桌面应用
│   ├── src/              # React 源代码
│   ├── src-tauri/        # Rust 源代码
│   ├── Cargo.toml        # Rust 依赖配置
│   └── tauri.conf.json   # Tauri 配置
│
├── docs/                 # 文档
│   ├── development/      # 开发文档
│   ├── guides/          # 用户指南
│   └── performance/     # 性能报告
│
└── tests/               # 集成测试
    ├── integration/
    └── performance/
```

## 开发工作流

### 1. 创建功能分支

```bash
git checkout -b feature/your-feature-name
```

### 2. 开发和测试

- 编写代码
- 运行测试：`npm test`
- 检查代码质量：`npm run lint`

### 3. 提交更改

```bash
git add .
git commit -m "feat: 功能描述"
git push origin feature/your-feature-name
```

### 4. 创建 Pull Request

在 GitHub 上创建 PR，描述你的更改内容。

## 常见任务

### 添加新的 API 端点

1. 在 `admin-backend/src/models/` 中定义数据模型
2. 在 `admin-backend/src/routes/` 中创建路由处理器
3. 在 `admin-backend/src/routes/mod.ts` 中注册路由
4. 编写测试用例

### 添加新的前端页面

1. 在 `frontend/src/pages/` 中创建页面组件
2. 在 `frontend/src/api/` 中添加 API 调用
3. 在 `frontend/src/App.tsx` 中配置路由
4. 编写测试用例

### 更新数据库 Schema

1. 修改 `admin-backend/src/db/sqlite.ts` 中的初始化脚本
2. 运行迁移脚本
3. 更新相关的数据模型

### 添加新的依赖

```bash
# 后台
cd admin-backend
npm install package-name

# 前端
cd frontend
npm install package-name

# 本地应用 (Rust)
cd local-app
cargo add crate-name
```

## 测试

### 运行测试

```bash
# 后台测试
cd admin-backend
npm test

# 前端测试
cd frontend
npm test

# 监视模式
npm run test:watch
```

### 编写测试

遵循以下约定：

- 测试文件放在 `__tests__/` 目录或使用 `.test.ts(x)` 后缀
- 使用 Vitest 作为测试框架
- 为每个功能编写单元测试和集成测试

### 测试覆盖率

```bash
npm test -- --coverage
```

## 代码质量

### 代码风格

项目使用 ESLint 和 TypeScript 进行代码检查。

```bash
# 检查代码
npm run lint

# 自动修复
npm run lint -- --fix
```

### 代码规范

详见 [代码风格指南](./development/code-style.md)

### 类型检查

```bash
# 后台
cd admin-backend
npx tsc --noEmit

# 前端
cd frontend
npx tsc --noEmit
```

## 贡献指南

详见 [贡献指南](./development/contributing.md)

## 常见问题

### Q: 如何重置数据库？

A: 删除 `admin-backend/data/openclaw.db` 文件，重启应用时会自动创建新的数据库。

### Q: 前端无法连接到后台？

A: 检查 `VITE_API_URL` 环境变量是否正确指向后台 API 地址。

### Q: 如何调试 Tauri 应用？

A: 使用 `cargo tauri dev` 启动开发模式，支持热重载和调试工具。

### Q: 如何构建生产版本？

A:
```bash
# 后台
cd admin-backend
npm run build

# 前端
cd frontend
npm run build

# 本地应用
cd local-app
cargo tauri build
```

## 相关文档

- [架构设计](./development/architecture.md)
- [代码风格](./development/code-style.md)
- [贡献指南](./development/contributing.md)
- [API 文档](./api.md)
- [用户指南](./USER_GUIDE.md)

## 获取帮助

- 查看 [常见问题](./development/contributing.md#常见问题)
- 提交 Issue
- 联系维护者

---

最后更新：2026-03-15
