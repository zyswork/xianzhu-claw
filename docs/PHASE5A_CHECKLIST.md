# Phase 5a 实现检查清单

**期限**: 本周五  
**所有者**: 前端开发  
**复杂度**: ⭐⭐ (中等)

---

## 📋 任务分解

### Stage 1: 准备 (30 分钟)

- [ ] 阅读 `TAURI_FRONTEND_INTEGRATION_REVIEW.md`
- [ ] 阅读 `PHASE5A_QUICK_START.md`
- [ ] 确认后端 (`admin-backend`) 能正常启动
- [ ] 确认 `npm list` 显示所有依赖已安装

**验证命令:**
```bash
cd frontend && npm list | grep -E "react|vite|axios"
cd ../admin-backend && npm run dev &
curl http://localhost:3000/health
kill %1  # 停止后端
```

---

### Stage 2: 环境配置 (30 分钟)

#### Task 2.1: 创建环境文件

- [ ] 创建 `frontend/.env.development`
- [ ] 创建 `frontend/.env.production`
- [ ] 添加到 `.gitignore` (如需要)

**检查:**
```bash
cd frontend
cat .env.development | grep VITE_API_BASE_URL
cat .env.production | grep VITE_API_TIMEOUT
```

#### Task 2.2: 创建配置模块

- [ ] 创建 `frontend/src/api/config.ts`
- [ ] 确保导出 `apiConfig` 对象
- [ ] 确保导出 `logger` 工具

**检查:**
```bash
grep -n "export const apiConfig" src/api/config.ts
grep -n "export const logger" src/api/config.ts
```

---

### Stage 3: API 改进 (45 分钟)

#### Task 3.1: 更新 API 客户端

- [ ] 更新 `frontend/src/api/client.ts`
- [ ] 导入 `apiConfig` 和 `logger`
- [ ] 实现请求拦截器 (添加 token)
- [ ] 实现响应拦截器 (错误处理)
- [ ] 添加全局错误事件 (`backend-connection-error`)

**检查:**
```bash
grep "import.* apiConfig" src/api/client.ts  # ✅
grep "401" src/api/client.ts                  # ✅
grep "backend-connection-error" src/api/client.ts  # ✅
```

#### Task 3.2: 测试 API 配置

- [ ] 启动开发服务器: `npm run dev`
- [ ] 打开浏览器 DevTools
- [ ] 检查 Console 中的日志输出
- [ ] 验证 API 请求有 Authorization header

---

### Stage 4: 健康检查 Hook (1 小时)

#### Task 4.1: 创建 useBackendHealth

- [ ] 创建 `frontend/src/hooks/useBackendHealth.ts`
- [ ] 实现 `useBackendHealth` 函数
- [ ] 支持 `status` 返回值: 'connecting' | 'connected' | 'error'
- [ ] 支持自动重试逻辑

**检查:**
```bash
grep -n "BackendStatus" src/hooks/useBackendHealth.ts  # 类型定义
grep -n "checkHealth" src/hooks/useBackendHealth.ts    # 检查函数
grep -n "useCallback" src/hooks/useBackendHealth.ts    # 使用 React hooks
```

#### Task 4.2: 测试健康检查

- [ ] 启动后端和前端: `npm run dev`
- [ ] 打开 DevTools Console
- [ ] 应该看到 "[DEBUG] 检查后端健康状态..."
- [ ] 停止后端，观察重连日志
- [ ] 重启后端，确认恢复连接

---

### Stage 5: 启动屏幕 (1.5 小时)

#### Task 5.1: 创建 SplashScreen 组件

- [ ] 创建 `frontend/src/components/SplashScreen.tsx`
- [ ] 实现进度更新逻辑
- [ ] 实现 4 个启动阶段
- [ ] 支持 `isVisible` 和 `onReady` props

**检查:**
```bash
grep -n "SplashScreenProps" src/components/SplashScreen.tsx
grep -n "const stages = " src/components/SplashScreen.tsx
grep -n "onReady()" src/components/SplashScreen.tsx
```

#### Task 5.2: 创建样式文件

- [ ] 创建 `frontend/src/styles/splash-screen.css`
- [ ] 实现渐变背景
- [ ] 实现浮动动画
- [ ] 实现进度条样式

**检查:**
```bash
grep "splash-screen {" src/styles/splash-screen.css      # 主容器
grep "@keyframes float" src/styles/splash-screen.css     # 动画
grep "progress-fill" src/styles/splash-screen.css        # 进度条
```

#### Task 5.3: 测试启动屏幕

- [ ] `npm run dev` 启动应用
- [ ] 应该看到启动屏幕 (蓝色渐变)
- [ ] Logo 应该有浮动效果
- [ ] 进度条应该平滑更新
- [ ] 2 秒后应该自动消失

---

### Stage 6: 错误处理 (45 分钟)

#### Task 6.1: 创建 ErrorBoundary 组件

- [ ] 创建 `frontend/src/components/ErrorBoundary.tsx`
- [ ] 实现 React 错误边界逻辑
- [ ] 显示错误信息和堆栈跟踪
- [ ] 提供重新加载按钮

**检查:**
```bash
grep "class ErrorBoundary" src/components/ErrorBoundary.tsx
grep "getDerivedStateFromError" src/components/ErrorBoundary.tsx
grep "componentDidCatch" src/components/ErrorBoundary.tsx
```

#### Task 6.2: 测试错误边界

- [ ] 尝试抛出错误：在某个组件中 `throw new Error('test')`
- [ ] 应该被 ErrorBoundary 捕获
- [ ] 应该显示错误页面
- [ ] 点击"重新加载"按钮应该恢复应用

---

### Stage 7: 集成 (1 小时)

#### Task 7.1: 更新 main.tsx

- [ ] 更新 `frontend/src/main.tsx`
- [ ] 延迟应用初始化 2 秒 (模拟启动过程)

**检查:**
```bash
grep "setTimeout" src/main.tsx  # 延迟逻辑
```

#### Task 7.2: 更新 App.tsx

- [ ] 导入 `SplashScreen` 组件
- [ ] 导入 `ErrorBoundary` 组件
- [ ] 导入 `useBackendHealth` hook
- [ ] 条件渲染启动屏幕
- [ ] 包裹应用在 ErrorBoundary 中
- [ ] 显示后端连接状态指示器

**检查:**
```bash
grep "import.*SplashScreen" src/App.tsx          # ✅
grep "import.*ErrorBoundary" src/App.tsx         # ✅
grep "import.*useBackendHealth" src/App.tsx      # ✅
grep "<SplashScreen" src/App.tsx                 # ✅
grep "<ErrorBoundary>" src/App.tsx               # ✅
```

#### Task 7.3: 更新 Tauri 配置

- [ ] 更新 `local-app/src-tauri/tauri.conf.json`
- [ ] 配置 `beforeBuildCommand` 为 `npm run build`
- [ ] 配置 `devPath` 为 `http://localhost:5173`

**检查:**
```bash
grep "beforeBuildCommand" local-app/src-tauri/tauri.conf.json  # npm run build
grep "devPath" local-app/src-tauri/tauri.conf.json             # localhost:5173
```

---

### Stage 8: 测试和验证 (1 小时)

#### Test 8.1: 开发环境测试

```bash
# 终端 1: 启动后端
cd admin-backend && npm run dev

# 终端 2: 启动前端 + Tauri
cd local-app && cargo tauri dev
```

**验证项:**
- [ ] Tauri 窗口打开
- [ ] 看到启动屏幕
- [ ] 进度条平滑更新
- [ ] 2 秒后自动隐藏
- [ ] 看到仪表板或登录页面
- [ ] Console 没有错误

#### Test 8.2: 错误处理测试

```bash
# 测试 1: 后端连接失败
# 在启动屏幕显示期间停止后端
# 应该看到错误提示或自动重连

# 测试 2: 响应错误处理
# 在 API 客户端中人为触发 401 错误
# 应该自动重定向到登录页面
```

#### Test 8.3: 构建测试

```bash
cd frontend && npm run build
# 检查 dist/ 文件大小和结构

cd ../local-app && cargo tauri build --debug
# 检查构建是否成功
```

---

## ✅ 完成条件

- [ ] 所有环境文件创建完成
- [ ] 所有新组件和 hooks 创建完成
- [ ] 所有现有文件更新完成
- [ ] 开发环境测试通过
- [ ] 错误处理测试通过
- [ ] 构建测试通过
- [ ] 无 TypeScript 错误
- [ ] 无 Console 错误

---

## 🐛 常见问题排查

### 问题 1: "Cannot find module '@/api/config'"

**原因**: 路径别名未配置  
**解决**: 检查 `vite.config.ts` 中的 `alias` 配置

```bash
grep "@" vite.config.ts | grep "path.resolve"
```

### 问题 2: "import.meta.env.VITE_* is undefined"

**原因**: Vite 未加载 `.env` 文件  
**解决**: 
```bash
rm -rf node_modules/.vite
npm run dev  # 重新启动，Vite 会重新加载 .env
```

### 问题 3: "Tauri 命令未找到"

**原因**: Tauri CLI 未安装  
**解决**:
```bash
cd local-app
cargo install tauri-cli
```

### 问题 4: "React 不在 scope 中"

**原因**: 忘记导入 React  
**解决**:
```typescript
import React from 'react'  // 在文件顶部
```

---

## 📝 提交信息

```bash
git add -A

git commit -m "feat: phase 5a - 实现启动屏幕和错误处理

- 添加环境变量支持 (.env.development/.env.production)
- 创建 API 配置模块 (src/api/config.ts)
- 改进 API 客户端错误处理和重试机制
- 实现后端健康检查 hook (useBackendHealth)
- 创建启动屏幕组件 (SplashScreen)
- 创建 React 错误边界 (ErrorBoundary)
- 更新 Tauri 配置支持开发流程
- 所有测试通过，无 TypeScript 错误"
```

---

## 📊 进度追踪

| 阶段 | 任务数 | 完成 | 预计时间 |
|------|--------|------|---------|
| Stage 1 | 4 | ☐ | 30m |
| Stage 2 | 4 | ☐ | 30m |
| Stage 3 | 4 | ☐ | 45m |
| Stage 4 | 4 | ☐ | 1h |
| Stage 5 | 6 | ☐ | 1.5h |
| Stage 6 | 4 | ☐ | 45m |
| Stage 7 | 6 | ☐ | 1h |
| Stage 8 | 9 | ☐ | 1h |
| **总计** | **41** | **☐** | **5-6h** |

---

**开始时间**: ___________  
**预计完成**: 本周五  
**实际完成**: ___________  
**遇到问题**: ___________  

