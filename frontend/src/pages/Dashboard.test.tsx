import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import Dashboard from './Dashboard'

describe('Dashboard', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token')
  })

  it('应该渲染仪表板标题', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('仪表板')).toBeInTheDocument()
    })
  })

  it('应该显示企业信息卡片', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/企业信息/)).toBeInTheDocument()
    })
  })

  it('应该显示快速导航菜单', async () => {
    render(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/用户管理/)).toBeInTheDocument()
      expect(screen.getByText(/知识库/)).toBeInTheDocument()
      expect(screen.getByText(/Agent 模板/)).toBeInTheDocument()
      expect(screen.getByText(/Token 监控/)).toBeInTheDocument()
    })
  })
})
