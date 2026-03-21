# 第四阶段继续 - 导航栏、API 集成、状态管理、响应式设计

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成前端应用的核心功能集成，包括统一的导航布局、后端 API 集成、全局状态管理和响应式设计。

**Architecture:**
- 创建 Layout 组件作为所有页面的容器，包含导航栏和侧边栏
- ��用 Zustand 作为全局状态管理库，管理用户认证、企业信息等全局状态
- 创建 API 客户端层，统一处理与后端的通信
- 使用 CSS Grid 和 Flexbox 实现响应式设计

**Tech Stack:** React 18, Vite, TypeScript, Zustand, Axios, Vitest

---

## Task 1: 创建 Layout 组件和导航栏

**Files:**
- Create: `frontend/src/components/Layout.tsx`
- Create: `frontend/src/components/Navbar.tsx`
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/Layout.test.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: 写失败的测试**

```typescript
// frontend/src/components/Layout.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Layout from './Layout'

describe('Layout', () => {
  it('应该渲染导航栏', () => {
    render(
      <Layout>
        <div>测试内容</div>
      </Layout>
    )
    expect(screen.getByText('OpenClaw')).toBeInTheDocument()
  })

  it('应该渲染侧边栏', () => {
    render(
      <Layout>
        <div>测试内容</div>
      </Layout>
    )
    expect(screen.getByText(/仪表板/)).toBeInTheDocument()
  })

  it('应该渲染子内容', () => {
    render(
      <Layout>
        <div>测试内容</div>
      </Layout>
    )
    expect(screen.getByText('测试内容')).toBeInTheDocument()
  })
})
```

**Step 2: 运行测试验证失败**

```bash
cd frontend && npm test 2>&1 | grep -E "FAIL|PASS"
```

Expected: FAIL - Layout 组件不存在

**Step 3: 创建 Navbar 组件**

```typescript
// frontend/src/components/Navbar.tsx
export default function Navbar() {
  const handleLogout = () => {
    localStorage.removeItem('token')
    window.location.href = '/login'
  }

  return (
    <nav style={{
      padding: '15px 20px',
      backgroundColor: '#007bff',
      color: 'white',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <h1 style={{ margin: 0 }}>OpenClaw</h1>
      <button
        onClick={handleLogout}
        style={{
          padding: '8px 16px',
          backgroundColor: 'white',
          color: '#007bff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        退出登录
      </button>
    </nav>
  )
}
```

**Step 4: 创建 Sidebar 组件**

```typescript
// frontend/src/components/Sidebar.tsx
import { Link } from 'react-router-dom'

export default function Sidebar() {
  const menuItems = [
    { label: '仪表板', path: '/dashboard' },
    { label: '用户管理', path: '/users' },
    { label: '知识库', path: '/knowledge-base' },
    { label: 'Agent 模板', path: '/agent-templates' },
    { label: 'Token 监控', path: '/token-monitoring' },
  ]

  return (
    <aside style={{
      width: '200px',
      backgroundColor: '#f8f9fa',
      padding: '20px',
      borderRight: '1px solid #ddd',
      minHeight: 'calc(100vh - 60px)',
    }}>
      <nav>
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              display: 'block',
              padding: '10px 15px',
              marginBottom: '5px',
              color: '#333',
              textDecoration: 'none',
              borderRadius: '4px',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e9ecef')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
```

**Step 5: 创建 Layout 组件**

```typescript
// frontend/src/components/Layout.tsx
import Navbar from './Navbar'
import Sidebar from './Sidebar'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />
      <div style={{ display: 'flex', flex: 1 }}>
        <Sidebar />
        <main style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  )
}
```

**Step 6: 运行测试验证通过**

```bash
npm test 2>&1 | grep -E "Test Files|Tests"
```

Expected: PASS - 3 个测试通过

**Step 7: 提交**

```bash
git add frontend/src/components/Layout.tsx frontend/src/components/Navbar.tsx frontend/src/components/Sidebar.tsx frontend/src/components/Layout.test.tsx
git commit -m "feat: phase 4 - 创建 Layout 组件和导航栏"
```

---

## Task 2: 安装 Zustand 并创建状态管理

**Files:**
- Create: `frontend/src/store/index.ts`
- Create: `frontend/src/store/authStore.ts`
- Create: `frontend/src/store/enterpriseStore.ts`

**Step 1: 安装 Zustand**

```bash
npm install zustand
```

**Step 2: 创建认证状态管理**

```typescript
// frontend/src/store/authStore.ts
import { create } from 'zustand'

interface User {
  id: string
  email: string
  name: string
  role: string
  enterpriseId: string
}

interface AuthStore {
  user: User | null
  token: string | null
  setUser: (user: User) => void
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  setUser: (user) => set({ user }),
  setToken: (token) => {
    localStorage.setItem('token', token)
    set({ token })
  },
  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null })
  },
}))
```

**Step 3: 创建企业状态管理**

```typescript
// frontend/src/store/enterpriseStore.ts
import { create } from 'zustand'

interface Enterprise {
  id: string
  name: string
  description: string
  industry: string
  size: string
}

interface EnterpriseStore {
  enterprise: Enterprise | null
  setEnterprise: (enterprise: Enterprise) => void
}

export const useEnterpriseStore = create<EnterpriseStore>((set) => ({
  enterprise: null,
  setEnterprise: (enterprise) => set({ enterprise }),
}))
```

**Step 4: 创建状态管理导出**

```typescript
// frontend/src/store/index.ts
export { useAuthStore } from './authStore'
export { useEnterpriseStore } from './enterpriseStore'
```

**Step 5: 提交**

```bash
git add frontend/src/store/
git commit -m "feat: phase 4 - 添加 Zustand 状态管理"
```

---

## Task 3: 创建 API 客户端层

**Files:**
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/api/enterprises.ts`
- Create: `frontend/src/api/users.ts`

**Step 1: 创建 API 客户端**

```typescript
// frontend/src/api/client.ts
import axios from 'axios'

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 添加请求拦截器，自动添加 token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 添加响应拦截器，处理 401 错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)
```

**Step 2: 创建认证 API**

```typescript
// frontend/src/api/auth.ts
import { apiClient } from './client'

export const authAPI = {
  login: (enterpriseId: string, email: string, password: string) =>
    apiClient.post('/auth/login', { enterpriseId, email, password }),
  register: (enterpriseId: string, email: string, name: string, password: string) =>
    apiClient.post('/auth/register', { enterpriseId, email, name, password }),
}
```

**Step 3: 创建企业 API**

```typescript
// frontend/src/api/enterprises.ts
import { apiClient } from './client'

export const enterprisesAPI = {
  getAll: () => apiClient.get('/enterprises'),
  getById: (id: string) => apiClient.get(`/enterprises/${id}`),
  create: (data: any) => apiClient.post('/enterprises', data),
  update: (id: string, data: any) => apiClient.put(`/enterprises/${id}`, data),
  delete: (id: string) => apiClient.delete(`/enterprises/${id}`),
}
```

**Step 4: 创建用户 API**

```typescript
// frontend/src/api/users.ts
import { apiClient } from './client'

export const usersAPI = {
  getByEnterprise: (enterpriseId: string) =>
    apiClient.get(`/users?enterpriseId=${enterpriseId}`),
  getById: (id: string) => apiClient.get(`/users/${id}`),
  create: (data: any) => apiClient.post('/users', data),
  update: (id: string, data: any) => apiClient.put(`/users/${id}`, data),
  delete: (id: string) => apiClient.delete(`/users/${id}`),
}
```

**Step 5: 提交**

```bash
git add frontend/src/api/
git commit -m "feat: phase 4 - 创建 API 客户端层"
```

---

## Task 4: 安装 React Router 并更新应用结构

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/package.json`

**Step 1: 安装 React Router**

```bash
npm install react-router-dom
```

**Step 2: 更新 App.tsx**

```typescript
// frontend/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import UsersPage from './pages/UsersPage'
import KnowledgeBasePage from './pages/KnowledgeBasePage'
import AgentTemplatesPage from './pages/AgentTemplatesPage'
import TokenMonitoringPage from './pages/TokenMonitoringPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('token')
  return token ? children : <Navigate to="/login" />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute>
              <Layout>
                <UsersPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/knowledge-base"
          element={
            <ProtectedRoute>
              <Layout>
                <KnowledgeBasePage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/agent-templates"
          element={
            <ProtectedRoute>
              <Layout>
                <AgentTemplatesPage />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/token-monitoring"
          element={
            <ProtectedRoute>
              <Layout>
                <TokenMonitoringPage />
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
```

**Step 3: 提交**

```bash
git add frontend/src/App.tsx frontend/package.json
git commit -m "feat: phase 4 - 添加 React Router 和应用路由"
```

---

## Task 5: 实现响应式设计

**Files:**
- Create: `frontend/src/styles/responsive.css`
- Modify: `frontend/src/components/Layout.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

**Step 1: 创建响应式样式**

```css
/* frontend/src/styles/responsive.css */
@media (max-width: 768px) {
  aside {
    width: 100% !important;
    min-height: auto !important;
    border-right: none !important;
    border-bottom: 1px solid #ddd !important;
  }

  main {
    padding: 10px !important;
  }

  nav {
    flex-direction: column !important;
  }

  button {
    margin-top: 10px !important;
  }
}

@media (max-width: 480px) {
  h1 {
    font-size: 18px !important;
  }

  main {
    padding: 5px !important;
  }

  table {
    font-size: 12px !important;
  }
}
```

**Step 2: 更新 Layout 组件支持响应式**

```typescript
// 在 Layout.tsx 中添加响应式样式
import '../styles/responsive.css'
```

**Step 3: 提交**

```bash
git add frontend/src/styles/responsive.css
git commit -m "feat: phase 4 - 添加响应式设计"
```

---

## Task 6: 运行完整测试并验证

**Step 1: 运行所有测试**

```bash
npm test 2>&1 | tail -20
```

Expected: 所有测试通过

**Step 2: 编译检查**

```bash
npm run build 2>&1 | tail -10
```

Expected: 编译成功

**Step 3: 最终提交**

```bash
git log --oneline -10
```

---

## 执行选项

计划已完成并保存到 `docs/plans/2026-03-15-phase4-continuation.md`。

**两种执行方式：**

**1. 子代理驱动（当前会话）** - 我为每个任务派遣新的子代理，任务间进行审查，快速迭代

**2. 并行会话（单独）** - 在新会话中使用 executing-plans，批量执行并设置检查点

你想选择哪种方式？
