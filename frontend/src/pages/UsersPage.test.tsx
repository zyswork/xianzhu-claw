import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsersPage from './UsersPage'

describe('UsersPage', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token')
  })

  it('应该渲染用户管理页面标题', async () => {
    render(<UsersPage />)
    await waitFor(() => {
      expect(screen.getByText('用户管理')).toBeInTheDocument()
    })
  })

  it('应该显示用户列表', async () => {
    render(<UsersPage />)
    await waitFor(() => {
      expect(screen.getByText(/用户列表/)).toBeInTheDocument()
    })
  })

  it('应该有添加用户按钮', async () => {
    render(<UsersPage />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /添加用户/ })).toBeInTheDocument()
    })
  })

  it('应该显示用户表格列', async () => {
    render(<UsersPage />)
    await waitFor(() => {
      expect(screen.getByText(/邮箱/)).toBeInTheDocument()
      expect(screen.getByText(/名称/)).toBeInTheDocument()
      expect(screen.getByText(/角色/)).toBeInTheDocument()
      expect(screen.getByText(/状态/)).toBeInTheDocument()
    })
  })
})
