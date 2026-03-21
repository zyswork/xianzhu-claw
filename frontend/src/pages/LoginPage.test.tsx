import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginPage from './LoginPage'

describe('LoginPage', () => {
  it('应该渲染登录表单', () => {
    render(<LoginPage />)

    expect(screen.getByText('YonClaw 登录')).toBeInTheDocument()
    expect(screen.getByLabelText('企业 ID')).toBeInTheDocument()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('应该允许用户输入凭证', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)

    const enterpriseInput = screen.getByLabelText('企业 ID')
    const emailInput = screen.getByLabelText('邮箱')
    const passwordInput = screen.getByLabelText('密码')

    await user.type(enterpriseInput, 'enterprise_123')
    await user.type(emailInput, 'user@example.com')
    await user.type(passwordInput, 'password123')

    expect(enterpriseInput).toHaveValue('enterprise_123')
    expect(emailInput).toHaveValue('user@example.com')
    expect(passwordInput).toHaveValue('password123')
  })

  it('应该有提交按钮', () => {
    render(<LoginPage />)
    const submitButton = screen.getByRole('button', { name: '登录' })
    expect(submitButton).toBeInTheDocument()
    expect(submitButton).not.toBeDisabled()
  })
})
