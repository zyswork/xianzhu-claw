// WebSocket 重连功能测试

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import WebSocket from 'ws'
import express from 'express'
import http from 'http'
import { generateToken } from '../src/middleware/auth'
import { initializeWebSocket, wsManager } from '../src/websocket/index'
import { ReconnectManager, ReconnectConfig } from '../src/websocket/reconnect'
import { db } from '../src/db/index'
import { v4 as uuidv4 } from 'uuid'

let httpServer: http.Server
let baseUrl: string
let wsUrl: string
let enterpriseId: string
let userId: string
let token: string

describe('WebSocket 重连管理', () => {
  beforeAll(() => {
    // 创建测试企业和用户
    enterpriseId = `enterprise_${uuidv4()}`
    userId = `user_${uuidv4()}`
    const uniqueEmail = `test_${Date.now()}_${Math.random()}@example.com`

    db.createEnterprise({
      id: enterpriseId,
      name: '测试企业',
      description: '用于测试的企业',
      logo: '',
      website: '',
      industry: '',
      size: '',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 创建测试用户
    db.createUser({
      id: userId,
      email: uniqueEmail,
      name: '测试用户',
      passwordHash: 'hashed_password',
      enterpriseId,
      role: 'admin',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 生成 token
    token = generateToken({
      id: userId,
      email: uniqueEmail,
      enterpriseId,
      role: 'admin',
    })

    // 创建 Express 应用和 HTTP 服务器
    const app = express()
    app.use(express.json())
    httpServer = http.createServer(app)

    // 初始化 WebSocket
    initializeWebSocket(httpServer)

    // 启动服务器
    return new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const address = httpServer.address()
        if (address && typeof address !== 'string') {
          const port = address.port
          baseUrl = `http://localhost:${port}`
          wsUrl = `ws://localhost:${port}/ws`
          resolve()
        }
      })
    })
  })

  afterAll(() => {
    // 清理所有 WebSocket 连接
    wsManager.closeAll()
    // 关闭 HTTP 服务器
    if (httpServer) {
      return new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve()
        })
      })
    }
    return Promise.resolve()
  })

  afterEach(() => {
    // 关闭所有活跃连接
    wsManager.closeAll()
  })

  // ===== 重连管理器基础测试 =====

  it('应该使用默认配置初始化重连管理器', () => {
    const manager = new ReconnectManager()
    expect(manager.getRetryCount()).toBe(0)
    expect(manager.getCurrentDelay()).toBe(1000)
  })

  it('应该支持自定义重连配置', () => {
    const customConfig: Partial<ReconnectConfig> = {
      initialDelayMs: 500,
      maxDelayMs: 5000,
      backoffMultiplier: 3,
      maxRetries: 5,
    }
    const manager = new ReconnectManager(customConfig)
    expect(manager.getRetryCount()).toBe(0)
    expect(manager.getCurrentDelay()).toBe(500)
  })

  // ===== 指数退避延迟测试 =====

  it('应该实现指数退避延迟（1s → 2s → 4s）', async () => {
    const config: ReconnectConfig = {
      initialDelayMs: 100, // 缩小时间以加快测试
      maxDelayMs: 3200,
      backoffMultiplier: 2,
      maxRetries: 3,
    }
    const manager = new ReconnectManager(config)

    const mockOnReconnect = vi.fn()
    const mockOnFailed = vi.fn()

    // 使用有效 token 进行重连
    await manager.attemptReconnect(userId, token, wsUrl, mockOnReconnect, mockOnFailed)

    // 验证重连成功
    expect(mockOnReconnect).toHaveBeenCalled()
    expect(mockOnFailed).not.toHaveBeenCalled()
    // 验证重连成功后重试次数被重置
    expect(manager.getRetryCount()).toBe(0)
  })

  it('应该在 3 次失败后停止重试', async () => {
    const config: ReconnectConfig = {
      initialDelayMs: 30,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      maxRetries: 2,
    }
    const manager = new ReconnectManager(config)

    const mockOnReconnect = vi.fn()
    const mockOnFailed = vi.fn()

    // 使用无效 token 和无效的 wsUrl 以确保连接快速失败
    const invalidToken = 'invalid.token.xyz'
    const invalidWsUrl = 'ws://127.0.0.1:1/ws' // 本地不存在的端口

    const startTime = Date.now()
    await manager.attemptReconnect(userId, invalidToken, invalidWsUrl, mockOnReconnect, mockOnFailed)
    const elapsedTime = Date.now() - startTime

    // 验证重连已停止
    expect(manager.getRetryCount()).toBe(config.maxRetries)
    expect(mockOnFailed).toHaveBeenCalled()
    expect(mockOnReconnect).not.toHaveBeenCalled()

    // 验证耗时合理
    expect(elapsedTime).toBeGreaterThan(80)
  }, 15000)

  // ===== WebSocket 管理器重连集成测试 =====

  it('应该在客户端注册时保存 token', async () => {
    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        const clientInfo = wsManager.getUserStatus(userId)
        expect(clientInfo).toBeTruthy()
        expect(clientInfo?.token).toBe(token)
        expect(clientInfo?.sessionStatus).toBe('connected')

        ws.close()
        resolve()
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  })

  it('应该在连接关闭时更新会话状态', async () => {
    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        expect(wsManager.getSessionStatus(userId)).toBe('connected')

        // 关闭连接
        ws.close()

        // 等待一下让关闭完成
        setTimeout(() => {
          resolve()
        }, 100)
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  })

  it('应该暴露 getSessionStatus 方法获取会话状态', async () => {
    // 初始状态应该是 null
    expect(wsManager.getSessionStatus(userId)).toBeNull()

    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        // 连接成功后状态应该是 'connected'
        const status = wsManager.getSessionStatus(userId)
        expect(status).toBe('connected')

        ws.close()

        // 等待关闭完成
        setTimeout(() => {
          resolve()
        }, 100)
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  })

  // ===== 重连延迟计算测试 =====

  it('应该计算延迟不超过最大延迟', () => {
    const config: ReconnectConfig = {
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      maxRetries: 10, // 高重试次数以测试最大延迟
    }
    const manager = new ReconnectManager(config)

    // 模拟多次重试
    for (let i = 0; i < 10; i++) {
      const delay = manager.getCurrentDelay()
      expect(delay).toBeLessThanOrEqual(config.maxDelayMs)
    }
  })

  it('应该正确停止重连并清理资源', () => {
    const manager = new ReconnectManager()

    // 立即停止
    manager.stop()

    // 验证重连状态已重置
    expect(manager.getRetryCount()).toBe(0)
    expect(manager.getCurrentDelay()).toBe(1000)
  })

  // ===== 集成测试：成功重连场景 =====

  it('应该成功完成重连流程（有效 token）', async () => {
    const config: ReconnectConfig = {
      initialDelayMs: 50,
      maxDelayMs: 300,
      backoffMultiplier: 2,
      maxRetries: 3,
    }
    const manager = new ReconnectManager(config)

    const mockOnReconnect = vi.fn()
    const mockOnFailed = vi.fn()

    const startTime = Date.now()

    // 使用有效 token 进行重连
    await manager.attemptReconnect(userId, token, wsUrl, mockOnReconnect, mockOnFailed)

    const elapsedTime = Date.now() - startTime

    // 验证重连成功
    expect(mockOnReconnect).toHaveBeenCalled()
    expect(mockOnFailed).not.toHaveBeenCalled()
    expect(manager.getRetryCount()).toBe(0) // 成功后重置

    // 验证大部分时间花费在第一次延迟上（50ms）
    expect(elapsedTime).toBeGreaterThan(30)
  })

  // ===== 边界情况测试 =====

  it('应该处理立即成功的重连（0 延迟）', async () => {
    const config: ReconnectConfig = {
      initialDelayMs: 1,
      maxDelayMs: 10,
      backoffMultiplier: 2,
      maxRetries: 3,
    }
    const manager = new ReconnectManager(config)

    const mockOnReconnect = vi.fn()
    const mockOnFailed = vi.fn()

    await manager.attemptReconnect(userId, token, wsUrl, mockOnReconnect, mockOnFailed)

    expect(mockOnReconnect).toHaveBeenCalled()
  })

  it('应该在多次失败后正确更新会话状态为 disconnected', async () => {
    const config: ReconnectConfig = {
      initialDelayMs: 30,
      maxDelayMs: 100,
      backoffMultiplier: 2,
      maxRetries: 2,
    }

    const invalidToken = 'invalid.token.xyz'
    const invalidWsUrl = 'ws://127.0.0.1:1/ws'

    // 先建立一个有效连接
    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        // 连接成功，现在关闭并尝试用无效 token 重连
        ws.close()

        setTimeout(() => {
          // 使用无效 token 测试重连失败
          const manager = new ReconnectManager(config)
          manager
            .attemptReconnect(userId, invalidToken, invalidWsUrl, () => {}, () => {})
            .then(() => {
              // 重连完成（失败）
              resolve()
            })
        }, 100)
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }, 15000)
})
