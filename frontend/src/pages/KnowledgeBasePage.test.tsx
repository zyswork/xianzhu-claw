import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import KnowledgeBasePage from './KnowledgeBasePage'

describe('KnowledgeBasePage', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token')
  })

  it('应该渲染知识库页面标题', async () => {
    render(<KnowledgeBasePage />)
    await waitFor(() => {
      expect(screen.getByText('知识库')).toBeInTheDocument()
    })
  })

  it('应该显示文档列表', async () => {
    render(<KnowledgeBasePage />)
    await waitFor(() => {
      expect(screen.getByText(/文档列表/)).toBeInTheDocument()
    })
  })

  it('应该有上传文档按钮', async () => {
    render(<KnowledgeBasePage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /上传文档/ })).toBeInTheDocument()
    })
  })

  it('应该显示搜索框', async () => {
    render(<KnowledgeBasePage />)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/搜索文档/)).toBeInTheDocument()
    })
  })
})
