# Tauri 前端集成 - 立即实现指南

**目的**: Phase 5a 快速实现清单，从本周开始执行

---

## 快速开始 (30 分钟)

### Step 0: 环境检查

```bash
cd /Users/zys/.openclaw/workspace/yonclaw/my-openclaw

# 检查前端项目
cd frontend && npm list | grep -E "react|vite|axios"

# 检查 Tauri
cd ../local-app && cargo --version
```

### Step 1: 创建环境文件

```bash
cd frontend

# 创建开发环境配置
cat > .env.development << 'EOF'
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_API_TIMEOUT=30000
VITE_LOG_LEVEL=debug
VITE_ENABLE_DEVTOOLS=true
EOF

# 创建生产环境配置
cat > .env.production << 'EOF'
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_API_TIMEOUT=10000
VITE_LOG_LEVEL=error
VITE_ENABLE_DEVTOOLS=false
EOF

# 更新 .gitignore
echo ".env.local" >> .gitignore
```

### Step 2: 创建 API 配置模块

```bash
cat > src/api/config.ts << 'EOF'
/**
 * API 配置模块
 *
 * 使用 Vite 环境变量确保多环境支持
 */

interface ApiConfig {
  baseURL: string
  timeout: number
  retryAttempts: number
  retryDelay: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/**
 * 动态读取环境变量
 */
export const apiConfig: ApiConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1',
  timeout: parseInt(import.meta.env.VITE_API_TIMEOUT || '10000'),
  retryAttempts: import.meta.env.DEV ? 2 : 3,
  retryDelay: 1000,
  logLevel: (import.meta.env.VITE_LOG_LEVEL as any) || 'error',
}

export const isDevelopment = import.meta.DEV
export const isProduction = !import.meta.DEV

/**
 * 日志工具
 */
export const logger = {
  debug: (...args: any[]) => {
    if (apiConfig.logLevel === 'debug') {
      console.log('[DEBUG]', ...args)
    }
  },
  info: (...args: any[]) => {
    if (['debug', 'info'].includes(apiConfig.logLevel)) {
      console.log('[INFO]', ...args)
    }
  },
  warn: (...args: any[]) => {
    if (['debug', 'info', 'warn'].includes(apiConfig.logLevel)) {
      console.warn('[WARN]', ...args)
    }
  },
  error: (...args: any[]) => {
    console.error('[ERROR]', ...args)
  },
}
EOF
```

### Step 3: 更新 API 客户端

```bash
cat > src/api/client.ts << 'EOF'
import axios, { AxiosError, AxiosInstance } from 'axios'
import { apiConfig, logger } from './config'

let retryCount = 0

export const apiClient: AxiosInstance = axios.create({
  baseURL: apiConfig.baseURL,
  timeout: apiConfig.timeout,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * 请求拦截器
 */
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = \`Bearer \${token}\`
    }
    return config
  },
  (error) => {
    logger.error('请求配置错误:', error)
    return Promise.reject(error)
  }
)

/**
 * 响应拦截器
 */
apiClient.interceptors.response.use(
  (response) => {
    logger.debug('API 响应成功:', response.status)
    retryCount = 0
    return response
  },
  async (error: AxiosError) => {
    const config = error.config as any

    // 处理 401 错误
    if (error.response?.status === 401) {
      logger.warn('认证失败，清除 token')
      localStorage.removeItem('token')
      window.location.href = '/login'
      return Promise.reject(error)
    }

    // 处理后端连接失败 (无响应)
    if (!error.response) {
      logger.error('后端连接失败:', error.message)

      // 触发全局错误事件
      window.dispatchEvent(
        new CustomEvent('backend-connection-error', {
          detail: { error, timestamp: Date.now() }
        })
      )

      return Promise.reject(error)
    }

    // 处理服务器错误（5xx）和网络超时 - 自动重试
    const shouldRetry =
      (!error.response || error.response.status >= 500) &&
      retryCount < apiConfig.retryAttempts

    if (shouldRetry) {
      retryCount += 1
      const delay = apiConfig.retryDelay * Math.pow(2, retryCount - 1)

      logger.warn(
        \`请求失败，准备重试 (\${retryCount}/\${apiConfig.retryAttempts})，延迟 \${delay}ms\`
      )

      await new Promise((resolve) => setTimeout(resolve, delay))
      return apiClient(config)
    }

    return Promise.reject(error)
  }
)
EOF
```

### Step 4: 创建健康检查 Hook

```bash
cat > src/hooks/useBackendHealth.ts << 'EOF'
import { useEffect, useState, useCallback } from 'react'
import { apiClient } from '@/api/client'
import { logger } from '@/api/config'

export type BackendStatus = 'connecting' | 'connected' | 'error'

interface UseBackendHealthOptions {
  interval?: number
  timeout?: number
  onStatusChange?: (status: BackendStatus) => void
}

export function useBackendHealth({
  interval = 10000,
  timeout = 2000,
  onStatusChange,
}: UseBackendHealthOptions = {}) {
  const [status, setStatus] = useState<BackendStatus>('connecting')
  const [retries, setRetries] = useState(0)

  const checkHealth = useCallback(async () => {
    try {
      logger.debug('检查后端健康状态...')

      const response = await apiClient.get('/health', { timeout })

      if (response.status === 200) {
        setStatus('connected')
        setRetries(0)
        onStatusChange?.('connected')
        logger.info('后端连接正常')
      }
    } catch (error) {
      logger.warn('后端连接失败:', error)

      if (retries < 3) {
        setRetries((prev) => prev + 1)
        setStatus('connecting')

        // exponential backoff 重试
        const delay = 1000 * Math.pow(2, retries)
        setTimeout(checkHealth, delay)
      } else {
        setStatus('error')
        onStatusChange?.('error')
        logger.error('后端连接失败，已达到最大重试次数')
      }
    }
  }, [retries, timeout, onStatusChange])

  useEffect(() => {
    // 立即进行首次检查
    checkHealth()

    // 定期检查
    const intervalId = setInterval(checkHealth, interval)

    return () => clearInterval(intervalId)
  }, [checkHealth, interval])

  return { status, retries }
}
EOF
```

### Step 5: 创建启动屏幕组件

```bash
cat > src/components/SplashScreen.tsx << 'EOF'
import { useEffect, useState } from 'react'
import '../styles/splash-screen.css'

interface SplashScreenProps {
  isVisible: boolean
  onReady?: () => void
}

export function SplashScreen({ isVisible, onReady }: SplashScreenProps) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('初始化本地服务...')

  useEffect(() => {
    if (!isVisible) return

    // 模拟启动进度
    const stages = [
      { progress: 20, status: '初始化本地服务...', duration: 500 },
      { progress: 50, status: '启动应用框架...', duration: 800 },
      { progress: 80, status: '准备用户界面...', duration: 600 },
      { progress: 100, status: '就绪！', duration: 400 },
    ]

    let currentStage = 0
    let elapsed = 0

    const interval = setInterval(() => {
      if (currentStage < stages.length) {
        const stage = stages[currentStage]
        elapsed += 100

        if (elapsed >= stage.duration) {
          setProgress(stage.progress)
          setStatus(stage.status)
          currentStage += 1
          elapsed = 0

          if (currentStage >= stages.length) {
            clearInterval(interval)
            setTimeout(() => onReady?.(), 500)
          }
        }
      }
    }, 100)

    return () => clearInterval(interval)
  }, [isVisible, onReady])

  if (!isVisible) return null

  return (
    <div className="splash-screen">
      <div className="splash-container">
        <div className="splash-logo">
          <svg viewBox="0 0 100 100" width="120" height="120">
            <circle cx="50" cy="50" r="45" fill="none" stroke="#3b82f6" strokeWidth="2" />
            <text x="50" y="60" textAnchor="middle" fontSize="48" fontWeight="bold" fill="#3b82f6">
              OC
            </text>
          </svg>
        </div>

        <h1 className="splash-title">OpenClaw</h1>

        <div className="splash-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: \`\${progress}%\` }}
            />
          </div>
          <p className="progress-text">\${progress}%</p>
        </div>

        <p className="splash-status">{status}</p>
      </div>
    </div>
  )
}
EOF
```

### Step 6: 创建启动屏幕样式

```bash
cat > src/styles/splash-screen.css << 'EOF'
.splash-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.splash-container {
  text-align: center;
  color: white;
}

.splash-logo {
  margin-bottom: 30px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-20px);
  }
}

.splash-title {
  font-size: 36px;
  font-weight: bold;
  margin: 0 0 30px;
  letter-spacing: 2px;
}

.splash-progress {
  width: 200px;
  margin: 30px auto;
}

.progress-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: white;
  transition: width 0.3s ease;
}

.progress-text {
  margin-top: 10px;
  font-size: 14px;
  opacity: 0.8;
}

.splash-status {
  font-size: 16px;
  margin: 20px 0 0;
  opacity: 0.9;
}
EOF
```

### Step 7: 更新主入口

```bash
cat > src/main.tsx << 'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// 初始化检查
let isAppReady = false

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const root = ReactDOM.createRoot(rootElement)

// 模拟应用初始化延迟
setTimeout(() => {
  isAppReady = true
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}, 2000)
EOF
```

---

## 详细任务分解

### Task A: 配置 Vite 支持环境变量

**文件**: `frontend/vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    strictPort: false,
  },

  // ✅ 新增: 环境变量支持
  define: {
    'import.meta.env.APP_ENV': JSON.stringify(process.env.NODE_ENV),
  },

  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV === 'development',

    // ✅ 优化代码分割
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            return 'vendor'
          }
          if (id.includes('pages')) {
            return 'pages'
          }
        },
      },
    },
  },
})
```

**测试命令:**

```bash
cd frontend
npm run build
# 检查 dist/ 文件大小
du -sh dist/
```

---

### Task B: 创建错误处理组件

**文件**: `frontend/src/components/ErrorBoundary.tsx`

```typescript
import React, { Component, ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('错误边界捕获:', error, errorInfo)
    this.setState({
      error,
      errorInfo,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', textAlign: 'center' }}>
          <h1>❌ 出现错误</h1>
          <details style={{ whiteSpace: 'pre-wrap' }}>
            {this.state.error && this.state.error.toString()}
            <br />
            {this.state.errorInfo && this.state.errorInfo.componentStack}
          </details>
          <button onClick={() => window.location.reload()}>
            重新加载应用
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

---

### Task C: 集成到 App.tsx

**更新**: `frontend/src/App.tsx`

```typescript
import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SplashScreen } from './components/SplashScreen'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useBackendHealth } from './hooks/useBackendHealth'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const getToken = () => {
    if (typeof window === 'undefined') return null
    try {
      return localStorage.getItem('token')
    } catch {
      return null
    }
  }

  const token = getToken()
  return token ? children : <Navigate to="/login" />
}

export default function App() {
  const [appReady, setAppReady] = useState(false)
  const { status: backendStatus } = useBackendHealth({
    interval: 10000,
  })

  useEffect(() => {
    // 模拟初始化延迟
    const timer = setTimeout(() => {
      setAppReady(true)
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  if (!appReady) {
    return <SplashScreen isVisible={true} onReady={() => setAppReady(true)} />
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        {backendStatus === 'error' && (
          <div className="backend-error-banner">
            ❌ 无法连接到后端服务，部分功能可能不可用
          </div>
        )}

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
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
```

---

### Task D: 更新 Tauri 配置

**文件**: `local-app/src-tauri/tauri.conf.json`

```json
{
  "build": {
    "beforeBuildCommand": "cd ../frontend && npm run build",
    "beforeDevCommand": "cd ../frontend && npm run dev",
    "devPath": "http://localhost:5173",
    "frontendDist": "../frontend/dist"
  },
  "app": {
    "windows": [
      {
        "title": "OpenClaw",
        "width": 1200,
        "height": 800,
        "minWidth": 400,
        "minHeight": 300,
        "resizable": true,
        "fullscreen": false,
        "focus": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "package": {
    "productName": "OpenClaw",
    "version": "0.1.0"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "shell": {
        "all": false,
        "open": true
      }
    },
    "bundle": {
      "active": true,
      "targets": "all",
      "identifier": "com.openclaw.local",
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ]
    }
  }
}
```

---

## 验证清单

完成每一步后，使用以下命令验证:

```bash
# 1. 检查环境变量是否正确加载
cd frontend
npm run dev
# 打开浏览器 DevTools → Console，检查是否有错误

# 2. 检查启动屏幕是否显示
# 看到蓝色渐变背景 + OC logo + 进度条

# 3. 检查后端健康检查是否工作
# 在 Console 中查看是否有 "[DEBUG] 检查后端健康状态..."

# 4. 测试 API 连接
# 登录页面应该能够调用后端 API

# 5. 测试 Tauri 集成
cd ../local-app
cargo tauri dev
# 应该能看到启动屏幕和应用

# 6. 检查错误处理
# 停止后端，查看错误提示是否出现
```

---

## 常见问题

### Q1: `import.meta.env` 未定义

**原因**: Vite 版本过旧

**解决**:
```bash
npm install vite@latest --save-dev
npm run build
```

### Q2: 启动屏幕卡住

**原因**: `onReady` 回调未触发

**检查**:
```typescript
// 在 SplashScreen 组件中添加日志
console.log('启动进度:', progress)
console.log('状态:', status)
```

### Q3: 后端连接失败

**原因**: Node.js 后端未启动

**解决**:
```bash
cd admin-backend
npm install
npm run dev
# 检查 localhost:3000 是否在线
```

---

## 下一步

1. ✅ 完成上述 Step 0-7
2. ✅ 运行验证清单
3. ✅ 提交 PR: "feat: phase 5a - 实现启动屏幕和错误处理"
4. ⏭️ Phase 5b: 系统菜单 + 性能优化

---

**预计完成时间**: 4-6 小时
**复杂度**: ⭐⭐ (中等)
**团队**: 前端 + Tauri (2 人)

