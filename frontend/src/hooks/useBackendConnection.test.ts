import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBackendConnection } from './useBackendConnection'

describe('useBackendConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock fetch 全局函数
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('应该返回初始连接状态为 false', () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('连接失败'))
    const { result } = renderHook(() => useBackendConnection())
    expect(result.current.isConnected).toBe(false)
  })

  it('应该返回重连次数', () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('连接失败'))
    const { result } = renderHook(() => useBackendConnection())
    expect(result.current.retryCount).toBe(0)
  })

  it('应该返回连接错误信息', () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('连接失败'))
    const { result } = renderHook(() => useBackendConnection())
    expect(result.current.error).toBeNull()
  })

  it('应该在后端可用时更新连接状态', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    )
    const { result } = renderHook(() => useBackendConnection())

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
    }, { timeout: 5000 })
  })

  it('应该在连接失败时重试', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('连接失败'))
      .mockRejectedValueOnce(new Error('连接失败'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
      )

    const { result } = renderHook(() =>
      useBackendConnection({ maxRetries: 3, retryInterval: 100 })
    )

    await waitFor(() => {
      expect(result.current.retryCount).toBeGreaterThan(0)
    }, { timeout: 5000 })
  })

  it('应该支持自定义重试间隔', () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error('连接失败'))
    const { result } = renderHook(() =>
      useBackendConnection({ retryInterval: 1000 })
    )
    expect(result.current).toBeDefined()
  })

  it('应该在达到最大重试次数后停止重试', async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error('连接失败'))

    const { result } = renderHook(() =>
      useBackendConnection({ maxRetries: 2, retryInterval: 50 })
    )

    await waitFor(() => {
      expect(result.current.error).toContain('已重试')
    }, { timeout: 5000 })
  })

  it('应该在连接成功后清除错误信息', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    )

    const { result } = renderHook(() => useBackendConnection())

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true)
      expect(result.current.error).toBeNull()
    }, { timeout: 5000 })
  })
})
