# OpenClaw 架构设计

## 概述

OpenClaw 采用三层架构设计，分离关注点，提高系统的可维护性和可扩展性。

```
┌─────────────────────────────────────────────────────────┐
│                    用户界面层                             │
│  ┌──────────────────┐          ┌──────────────────┐    │
│  │  Web 前端        │          │  桌面应用        │    │
│  │  (React/Vite)   │          │  (Tauri/Rust)   │    │
│  └────────┬─────────┘          └────────┬─────────┘    │
└───────────┼──────────────────────────────┼──────────────┘
            │                              │
            └──────────────┬───────────────┘
                           │ HTTP/REST API
┌──────────────────────────┴──────────────────────────────┐
│                    应用服务层                             │
│  ┌────────────────────────────────────────────────┐    │
│  │  Express.js API 服务器                         │    │
│  │  - 认证与授权                                  │    │
│  │  - 业务逻辑处理                                │    │
│  │  - 数据验证                                    │    │
│  │  - 错误处理                                    │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────┴───────────────────────────────────┐
│                    数据持久化层                           │
│  ┌────────────────────────────────────────────────┐    │
│  │  SQLite 数据库                                 │    │
│  │  - 用户管理                                    │    │
│  │  - 企业信息                                    │    │
│  │  - 知识库                                      │    │
│  │  - Agent 模板                                 │    │
│  │  - Token 使用统计                             │    │
│  └────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────┘
```

## 模块设计

### 1. 后台 API (admin-backend)

#### 目录结构

```
admin-backend/
├── src/
│   ├── db/              # 数据库层
│   │   ├── index.ts     # 数据库导出接口
│   │   └── sqlite.ts    # SQLite 实现
│   │
│   ├── middleware/      # Express 中间件
│   │   ├── auth.ts      # JWT 认证中间件
│   │   ├── validation.ts # 请求验证中间件
│   │   └── validator.ts # 验证规则定义
│   │
│   ├── models/          # 数据模型
│   │   ├── user.ts      # 用户模型
│   │   ├── enterprise.ts # 企业模型
│   │   ├── knowledge-base.ts # 知识库模型
│   │   ├── agent-template.ts # Agent 模板模型
│   │   └── token-usage.ts # Token 使用统计模型
│   │
│   ├── routes/          # API 路由
│   │   ├── mod.ts       # 路由注册
│   │   ├── auth.ts      # 认证路由
│   │   ├── users.ts     # 用户管理路由
│   │   ├── enterprises.ts # 企业管理路由
│   │   ├── knowledge-base.ts # 知识库路由
│   │   ├── agent-templates.ts # Agent 模板路由
│   │   └── token-monitoring.ts # Token 监控路由
│   │
│   ├── utils/           # 工具函数
│   │   └── errors.ts    # 错误处理
│   │
│   └── index.ts         # 应用入口
│
└── tests/               # 测试文件
```

#### 核心模块说明

**数据库层 (db/)**
- 提供统一的数据库接口
- 支持 SQLite 数据库
- 处理连接池和事务管理

**中间件层 (middleware/)**
- `auth.ts`: JWT 令牌验证，保护受限端点
- `validation.ts`: 请求体和查询参数验证
- `validator.ts`: 使用 Joi 定义验证规则

**数据模型层 (models/)**
- 定义数据结构和业务逻辑
- 提供 CRUD 操作接口
- 处理数据验证和转换

**路由层 (routes/)**
- 定义 API 端点
- 处理请求和响应
- 调用模型层进行业务处理

#### API 设计原则

- RESTful 风格
- 统一的错误响应格式
- JWT 令牌认证
- 请求参数验证

### 2. 前端应用 (frontend)

#### 目录结构

```
frontend/
├── src/
│   ├── api/             # API 客户端
│   │   ├── client.ts    # Axios 实例配置
│   │   ├── auth.ts      # 认证 API
│   │   ├── users.ts     # 用户 API
│   │   └── enterprises.ts # 企业 API
│   │
│   ├── components/      # 可复用组件
│   │   ├── Layout.tsx   # 布局组件
│   │   ├── Navbar.tsx   # 导航栏
│   │   ├── Sidebar.tsx  # 侧边栏
│   │   └── SplashScreen.tsx # 启动屏
│   │
│   ├── hooks/           # 自定义 Hooks
│   │   └── useBackendConnection.ts # 后台连接 Hook
│   │
│   ├── pages/           # 页面组件
│   │   ├── LoginPage.tsx # 登录页
│   │   ├── Dashboard.tsx # 仪表板
│   │   ├── UsersPage.tsx # 用户管理
│   │   ├── AgentTemplatesPage.tsx # Agent 模板
│   │   ├── KnowledgeBasePage.tsx # 知识库
│   │   └── TokenMonitoringPage.tsx # Token 监控
│   │
│   ├── store/           # 状态管理 (Zustand)
│   │   ├── authStore.ts # 认证状态
│   │   ├── enterpriseStore.ts # 企业状态
│   │   └── index.ts     # 状态导出
│   │
│   ├── __tests__/       # 测试文件
│   │   ├── performance/ # 性能测试
│   │   └── components/  # 组件测试
│   │
│   ├── App.tsx          # 应用根组件
│   └── main.tsx         # 应用入口
│
└── package.json
```

#### 核心模块说明

**API 客户端 (api/)**
- 封装 Axios 实例
- 提供类型安全的 API 调用
- 处理请求拦截和错误处理

**组件层 (components/)**
- 可复用的 UI 组件
- 布局和导航组件
- 遵循单一职责原则

**自定义 Hooks (hooks/)**
- 业务逻辑复用
- 后台连接管理
- 状态同步

**页面层 (pages/)**
- 完整的页面功能
- 组合多个组件
- 处理页面级状态

**状态管理 (store/)**
- 使用 Zustand 管理全局状态
- 认证状态管理
- 企业信息缓存

#### 前端架构特点

- 组件化设计
- 状态集中管理
- 类型安全 (TypeScript)
- 响应式设计
- 性能优化

### 3. 桌面应用 (local-app)

#### 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Rust + Tauri
- **构建**: Cargo + Tauri CLI

#### 目录结构

```
local-app/
├── src/                 # React 源代码
│   └── (同 frontend 结构)
│
├── src-tauri/           # Rust 源代码
│   ├── src/
│   │   └── main.rs      # Tauri 应用入口
│   └── Cargo.toml       # Rust 依赖
│
├── Cargo.toml           # 项目配置
└── tauri.conf.json      # Tauri 配置
```

#### Tauri 集成

- 提供原生系统集成
- 文件系统访问
- 系统托盘支持
- 窗口管理

## 数据流

### 用户认证流程

```
1. 用户输入凭证
   ↓
2. 前端发送登录请求
   ↓
3. 后台验证凭证
   ↓
4. 生成 JWT 令牌
   ↓
5. 前端存储令牌
   ↓
6. 后续请求携带令牌
   ↓
7. 后台验证令牌
```

### 数据获取流程

```
1. 前端组件挂载
   ↓
2. 调用 API 客户端
   ↓
3. 发送 HTTP 请求
   ↓
4. 后台处理请求
   ↓
5. 查询数据库
   ↓
6. 返回响应数据
   ↓
7. 前端更新状态
   ↓
8. 组件重新渲染
```

## 数据库设计

### 核心表结构

**users 表**
- id: 用户 ID
- username: 用户名
- email: 邮箱
- password_hash: 密码哈希
- enterprise_id: 所属企业
- role: 用户角色
- created_at: 创建时间
- updated_at: 更新时间

**enterprises 表**
- id: 企业 ID
- name: 企业名称
- description: 企业描述
- created_at: 创建时间
- updated_at: 更新时间

**knowledge_bases 表**
- id: 知识库 ID
- enterprise_id: 所属企业
- name: 知识库名称
- description: 描述
- created_at: 创建时间
- updated_at: 更新时间

**agent_templates 表**
- id: 模板 ID
- enterprise_id: 所属企业
- name: 模板名称
- description: 描述
- config: 配置 JSON
- created_at: 创建时间
- updated_at: 更新时间

**token_usage 表**
- id: 记录 ID
- enterprise_id: 所属企业
- date: 统计日期
- tokens_used: 使用的 Token 数
- created_at: 创建时间

## 安全设计

### 认证与授权

- JWT 令牌认证
- 基于角色的访问控制 (RBAC)
- 密码加密存储
- 令牌过期管理

### 数据保护

- 请求参数验证
- SQL 注入防护
- CORS 配置
- 敏感数据加密

### 错误处理

- 统一的错误响应格式
- 错误日志记录
- 敏感信息隐藏

## 扩展性设计

### 模块化架构

- 清晰的模块边界
- 依赖注入模式
- 易于添加新功能

### 插件系统

可以通过以下方式扩展系统：

1. **添加新的 API 端点**
   - 在 `routes/` 中创建新的路由文件
   - 在 `models/` 中定义数据模型
   - 在 `routes/mod.ts` 中注册路由

2. **添加新的前端页面**
   - 在 `pages/` 中创建新的页面组件
   - 在 `api/` 中添加 API 调用
   - 在 `App.tsx` 中配置路由

3. **扩展数据库**
   - 修改 `db/sqlite.ts` 中的初始化脚本
   - 添加新的数据模型
   - 更新相关的路由处理器

## 性能优化

### 前端优化

- 代码分割和懒加载
- 组件记忆化
- 状态管理优化
- 网络请求缓存

### 后台优化

- 数据库查询优化
- 连接池管理
- 响应压缩
- 缓存策略

### 桌面应用优化

- 原生性能
- 资源管理
- 启动时间优化

## 部署架构

### 开发环境

- 本地开发服务器
- 热重载支持
- 调试工具

### 生产环境

- Docker 容器化
- 负载均衡
- 数据库备份
- 日志收集

## 相关文档

- [代码风格指南](./code-style.md)
- [贡献指南](./contributing.md)
- [API 文档](../api.md)

---

最后更新：2026-03-15
