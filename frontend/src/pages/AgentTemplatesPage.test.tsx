import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AgentTemplatesPage from './AgentTemplatesPage'

describe('AgentTemplatesPage', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token')
  })

  it('应该渲染 Agent 模板页面标题', async () => {
    render(<AgentTemplatesPage />)
    await waitFor(() => {
      expect(screen.getByText('Agent 模板')).toBeInTheDocument()
    })
  })

  it('应该显示模板列表', async () => {
    render(<AgentTemplatesPage />)
    await waitFor(() => {
      expect(screen.getByText(/模板列表/)).toBeInTheDocument()
    })
  })

  it('应该有创建模板按钮', async () => {
    render(<AgentTemplatesPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /创建模板/ })).toBeInTheDocument()
    })
  })

  it('应该显示模板卡片', async () => {
    render(<AgentTemplatesPage />)
    await waitFor(() => {
      expect(screen.getAllByText(/分类/)).toHaveLength(2)
    })
  })
})
