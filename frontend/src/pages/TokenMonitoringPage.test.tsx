import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TokenMonitoringPage from './TokenMonitoringPage'

describe('TokenMonitoringPage', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token')
  })

  it('应该渲染 Token 监控页面标题', async () => {
    render(<TokenMonitoringPage />)
    await waitFor(() => {
      expect(screen.getByText('Token 监控')).toBeInTheDocument()
    })
  })

  it('应该显示配额信息', async () => {
    render(<TokenMonitoringPage />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /月度配额/ })).toBeInTheDocument()
    })
  })

  it('应该显示使用统计', async () => {
    render(<TokenMonitoringPage />)
    await waitFor(() => {
      expect(screen.getByText(/使用统计/)).toBeInTheDocument()
    })
  })

  it('应该显示告警设置', async () => {
    render(<TokenMonitoringPage />)
    await waitFor(() => {
      expect(screen.getByText(/告警设置/)).toBeInTheDocument()
    })
  })
})
