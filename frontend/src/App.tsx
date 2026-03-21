import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense, useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { useBackendConnection } from './hooks/useBackendConnection'
import SplashScreen from './components/SplashScreen'
import SetupPage from './pages/SetupPage'
import Layout from './components/Layout'

// 懒加载页面组件
const Dashboard = lazy(() => import('./pages/Dashboard'))
const AgentListPage = lazy(() => import('./pages/AgentListPage'))
const AgentDetailPage = lazy(() => import('./pages/AgentDetailPage'))
const AgentCreatePage = lazy(() => import('./pages/AgentCreatePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const CronPage = lazy(() => import('./pages/CronPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const MemoryPage = lazy(() => import('./pages/MemoryPage'))
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'))
const TokenMonitoringPage = lazy(() => import('./pages/TokenMonitoringPage'))
const ChannelsPage = lazy(() => import('./pages/ChannelsPage'))
const PluginsPage = lazy(() => import('./pages/PluginsPage'))

function PageLoader() {
  return (
    <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
      加载中...
    </div>
  )
}

function ProtectedPage({ children }: { children: React.ReactNode }) {
  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </Layout>
  )
}

export default function App() {
  const { isConnected, retryCount } = useBackendConnection()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  // 连接后检查是否需要首次设置
  useEffect(() => {
    if (!isConnected) return
    ;(async () => {
      try {
        const setupDone = await invoke<string | null>('get_setting', { key: 'setup_completed' })
        setNeedsSetup(!setupDone)
      } catch {
        setNeedsSetup(true)
      }
    })()
  }, [isConnected])

  if (!isConnected) {
    return (
      <SplashScreen
        message={`正在连接后端... (${retryCount})`}
        progress={Math.min((retryCount / 10) * 100, 95)}
      />
    )
  }

  // 等待检查结果
  if (needsSetup === null) {
    return <SplashScreen message="检查环境..." progress={50} />
  }

  // 首次启动引导
  if (needsSetup) {
    return (
      <SetupPage onComplete={async () => {
        await invoke('set_setting', { key: 'setup_completed', value: 'true' }).catch(() => {})
        setNeedsSetup(false)
      }} />
    )
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/agents" element={<ProtectedPage><AgentListPage /></ProtectedPage>} />
        <Route path="/agents/new" element={<ProtectedPage><AgentCreatePage /></ProtectedPage>} />
        <Route path="/agents/:agentId" element={<ProtectedPage><AgentDetailPage /></ProtectedPage>} />
        <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
        <Route path="/skills" element={<ProtectedPage><SkillsPage /></ProtectedPage>} />
        <Route path="/memory" element={<ProtectedPage><MemoryPage /></ProtectedPage>} />
        <Route path="/cron" element={<ProtectedPage><CronPage /></ProtectedPage>} />
        <Route path="/audit" element={<ProtectedPage><AuditLogPage /></ProtectedPage>} />
        <Route path="/token-monitoring" element={<ProtectedPage><TokenMonitoringPage /></ProtectedPage>} />
        <Route path="/channels" element={<ProtectedPage><ChannelsPage /></ProtectedPage>} />
        <Route path="/plugins" element={<ProtectedPage><PluginsPage /></ProtectedPage>} />
        <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />
        <Route path="*" element={<Navigate to="/agents" replace />} />
      </Routes>
    </HashRouter>
  )
}
