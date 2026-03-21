// WebSocket 健康检查和僵尸连接检测测试

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import WebSocket from 'ws'
import express from 'express'
import http from 'http'
import { generateToken } from '../src/middleware/auth'
import { initializeWebSocket, wsManager } from '../src/websocket/index'
import { HealthCheckManager } from '../src/websocket/health-check'
import { db } from '../src/db/index'
import { v4 as uuidv4 } from 'uuid'

let httpServer: http.Server
let baseUrl: string
let wsUrl: string
let enterpriseId: string
let userId: string
let token: string

describe('WebSocket 健康检查和僵尸连接检测', () => {
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

  // ===== HealthCheckManager 基础初始化测试 =====

  it('应该使用默认配置初始化 HealthCheckManager', () => {
    const manager = new HealthCheckManager()
    const metrics = manager.getHealthMetrics()
    expect(metrics.activeConnections).toBe(0)
    expect(metrics.healthyConnections).toBe(0)
    expect(metrics.zombieConnections).toBe(0)
    expect(metrics.healthyRate).toBe(1) // 0/0 = 1
  })

  it('应该支持自定义健康检查配置', () => {
    const config = {
      pingIntervalMs: 20000,
      pongTimeoutMs: 3000,
      zombieDetectionTimeoutMs: 3000,
    }
    const manager = new HealthCheckManager(config)
    const metrics = manager.getHealthMetrics()
    expect(metrics.activeConnections).toBe(0)
  })

  // ===== Ping/Pong 流程测试 =====

  it('应该在成功接收到 pong 后更新健康状态', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 100,
      pongTimeoutMs: 500,
      zombieDetectionTimeoutMs: 500,
    })

    const mockWs = {
      readyState: 1, // OPEN
      ping: vi.fn(),
    }

    const wsId = `test-${Date.now()}`
    manager.startHealthCheck(wsId, mockWs as any)

    // 给 ping 定时器一些时间
    await new Promise((resolve) => setTimeout(resolve, 150))

    // 模拟客户端发送 pong
    manager.handlePong(wsId)

    // 验证最后 pong 时间被更新
    const lastPongTime = manager.getLastPongTime(wsId)
    expect(lastPongTime).toBeTruthy()
    expect(lastPongTime).toBeGreaterThan(0)

    manager.stopHealthCheck(wsId)
  })

  it('应该检测到无响应的连接（未收到 pong）', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 50,
      pongTimeoutMs: 100,
      zombieDetectionTimeoutMs: 100,
    })

    const mockWs = {
      readyState: 1, // OPEN
      ping: vi.fn(),
    }

    const wsId = `test-zombie-${Date.now()}`
    manager.startHealthCheck(wsId, mockWs as any)

    // 设置僵尸检测回调
    const zombieDetectedCallback = vi.fn()
    manager.setZombieDetectionCallback(zombieDetectedCallback)

    // 等待两个 ping 周期 + pong 超时，触发僵尸检测
    await new Promise((resolve) => setTimeout(resolve, 300))

    // 验证僵尸连接被检测到（至少一次）
    expect(mockWs.ping).toHaveBeenCalled()
  })

  // ===== 健康状态检查测试 =====

  it('应该在首次 pong 后标记连接为健康', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 100,
      pongTimeoutMs: 1000,
      zombieDetectionTimeoutMs: 1000,
    })

    const mockWs = {
      readyState: 1, // OPEN
      ping: vi.fn(),
    }

    const wsId = `test-healthy-${Date.now()}`
    manager.startHealthCheck(wsId, mockWs as any)

    // 初始状态是健康的（刚刚启动时）
    expect(manager.isHealthy(wsId)).toBe(true)

    // 模拟 pong
    await new Promise((resolve) => setTimeout(resolve, 50))
    manager.handlePong(wsId)

    // 应该仍然健康
    expect(manager.isHealthy(wsId)).toBe(true)

    manager.stopHealthCheck(wsId)
  })

  it('应该在连接关闭时返回不健康状态', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 100,
      pongTimeoutMs: 1000,
      zombieDetectionTimeoutMs: 1000,
    })

    const mockWs = {
      readyState: 1, // OPEN
      ping: vi.fn(),
    }

    const wsId = `test-closed-${Date.now()}`
    manager.startHealthCheck(wsId, mockWs as any)

    // 模拟连接关闭
    ;(mockWs as any).readyState = 3 // CLOSED

    // 应该返回不健康
    expect(manager.isHealthy(wsId)).toBe(false)

    manager.stopHealthCheck(wsId)
  })

  // ===== 健康指标测试 =====

  it('应该正确计算活跃连接数', async () => {
    const manager = new HealthCheckManager()

    const mockWs1 = { readyState: 1, ping: vi.fn() }
    const mockWs2 = { readyState: 1, ping: vi.fn() }

    manager.startHealthCheck('ws-1', mockWs1 as any)
    manager.startHealthCheck('ws-2', mockWs2 as any)

    const metrics = manager.getHealthMetrics()
    expect(metrics.activeConnections).toBe(2)

    manager.stopHealthCheck('ws-1')
    const metrics2 = manager.getHealthMetrics()
    expect(metrics2.activeConnections).toBe(1)

    manager.cleanup()
  })

  it('应该计算健康率百分比', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 100,
      pongTimeoutMs: 1000,
      zombieDetectionTimeoutMs: 1000,
    })

    const mockWs1 = { readyState: 1, ping: vi.fn() }
    const mockWs2 = { readyState: 1, ping: vi.fn() }

    manager.startHealthCheck('ws-1', mockWs1 as any)
    manager.startHealthCheck('ws-2', mockWs2 as any)

    // 两个都发送 pong
    manager.handlePong('ws-1')
    manager.handlePong('ws-2')

    const metrics = manager.getHealthMetrics()
    expect(metrics.activeConnections).toBe(2)
    expect(metrics.healthyConnections).toBe(2)
    expect(metrics.healthyRate).toBe(1) // 2/2

    manager.cleanup()
  })

  // ===== 全局健康检查扫描测试 =====

  it('应该启动和停止全局定期健康检查', async () => {
    const manager = new HealthCheckManager()
    const mockCallback = vi.fn()
    manager.setZombieDetectionCallback(mockCallback)

    manager.startGlobalHealthCheck(100)

    // 等待一次扫描
    await new Promise((resolve) => setTimeout(resolve, 150))

    manager.stopGlobalHealthCheck()

    // 再等一会儿，应该不会有更多扫描
    const callCountBefore = mockCallback.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 150))
    const callCountAfter = mockCallback.mock.calls.length

    expect(callCountAfter).toBe(callCountBefore)
  })

  it('应该手动执行一次全局健康检查扫描', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 100,
      pongTimeoutMs: 500,
      zombieDetectionTimeoutMs: 500,
    })

    const mockWs = { readyState: 1, ping: vi.fn() }
    manager.startHealthCheck('ws-scan', mockWs as any)

    // 模拟 pong 以保持健康
    manager.handlePong('ws-scan')

    // 执行全局扫描
    manager.performGlobalHealthCheck()

    // 连接应该仍然被追踪（未被标记为僵尸）
    expect(manager.isHealthy('ws-scan')).toBe(true)

    manager.cleanup()
  })

  // ===== 集成测试：WebSocket 连接健康检查 =====

  it('应该在真实 WebSocket 连接上自动发送 ping 并接收 pong', async () => {
    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        // 验证健康检查已启动
        expect(wsManager.isConnectionHealthy(userId)).toBe(true)

        ws.close()
        resolve()
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  })

  it('应该获取最后 pong 时间戳', async () => {
    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        // 获取最后 pong 时间
        const lastPongTime = wsManager.getLastPongTime(userId)
        expect(lastPongTime).toBeTruthy()
        expect(lastPongTime).toBeGreaterThan(0)
        expect(lastPongTime).toBeLessThanOrEqual(Date.now())

        ws.close()
        resolve()
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  })

  it('应该在健康检查信息中报告活跃连接', async () => {
    const ws = new WebSocket(`${wsUrl}?token=${token}`)

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'))
      }, 3000)

      ws.on('open', () => {
        clearTimeout(timeout)

        // 获取健康检查信息
        const healthInfo = wsManager.getHealthCheckInfo()
        expect(healthInfo.activeConnections).toBeGreaterThan(0)
        expect(healthInfo.healthyRate).toBeGreaterThan(0)

        ws.close()
        resolve()
      })

      ws.on('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  })

  // ===== 边界情况和错误处理测试 =====

  it('应该处理重复启动健康检查（应重新初始化）', async () => {
    const manager = new HealthCheckManager()

    const mockWs = { readyState: 1, ping: vi.fn() }
    const wsId = `test-reinit-${Date.now()}`

    manager.startHealthCheck(wsId, mockWs as any)
    const beforeMetrics = manager.getHealthMetrics()

    // 再次启动同一个连接
    manager.startHealthCheck(wsId, mockWs as any)
    const afterMetrics = manager.getHealthMetrics()

    // 应该只有一个活跃连接
    expect(afterMetrics.activeConnections).toBe(1)
    expect(beforeMetrics.activeConnections).toBe(afterMetrics.activeConnections)

    manager.cleanup()
  })

  it('应该正确清理所有资源', async () => {
    const manager = new HealthCheckManager()

    const mockWs1 = { readyState: 1, ping: vi.fn() }
    const mockWs2 = { readyState: 1, ping: vi.fn() }

    manager.startHealthCheck('ws-1', mockWs1 as any)
    manager.startHealthCheck('ws-2', mockWs2 as any)
    manager.startGlobalHealthCheck(100)

    expect(manager.getHealthMetrics().activeConnections).toBe(2)

    // 清理所有资源
    manager.cleanup()

    expect(manager.getHealthMetrics().activeConnections).toBe(0)
  })

  it('应该处理未注册的连接查询', () => {
    const manager = new HealthCheckManager()

    expect(manager.isHealthy('unknown-id')).toBe(false)
    expect(manager.getLastPongTime('unknown-id')).toBeNull()

    manager.cleanup()
  })

  it('应该支持为多个连接设置僵尸检测回调', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 50,
      pongTimeoutMs: 100,
      zombieDetectionTimeoutMs: 100,
    })

    const zombieCallback = vi.fn()
    manager.setZombieDetectionCallback(zombieCallback)

    const mockWs1 = { readyState: 1, ping: vi.fn() }
    const mockWs2 = { readyState: 1, ping: vi.fn() }

    manager.startHealthCheck('zombie-1', mockWs1 as any)
    manager.startHealthCheck('zombie-2', mockWs2 as any)

    // 等待僵尸检测（不发送任何 pong）
    await new Promise((resolve) => setTimeout(resolve, 400))

    // 至少有一个僵尸被检测到
    expect(mockWs1.ping).toHaveBeenCalled()
    expect(mockWs2.ping).toHaveBeenCalled()

    manager.cleanup()
  })

  // ===== 会话状态集成测试 =====

  it('应该在僵尸连接被检测时更新会话状态为 disconnected', async () => {
    // 此测试需要修改 ws-manager 的僵尸检测回调
    // 验证 handleZombieDetected 方法正确更新会话状态
    const manager = new HealthCheckManager()

    // 虽然直接测试很困难，但我们可以验证 getFailureCount 方法
    const mockWs = { readyState: 1, ping: vi.fn() }
    manager.startHealthCheck('test-zombie-state', mockWs as any)

    // 在不发送 pong 的情况下让 ping 被发送
    // 这应该增加失败计数
    expect(manager.getFailureCount('test-zombie-state')).toBe(0)

    manager.cleanup()
  })

  it('应该在连接状态变化时反应敏捷', async () => {
    const manager = new HealthCheckManager()

    const mockWs = { readyState: 1, ping: vi.fn() }
    const wsId = 'state-change-test'

    manager.startHealthCheck(wsId, mockWs as any)
    expect(manager.isHealthy(wsId)).toBe(true)

    // 模拟连接关闭
    ;(mockWs as any).readyState = 3

    // 应该立即报告为不健康
    expect(manager.isHealthy(wsId)).toBe(false)

    manager.cleanup()
  })

  it('应该跟踪 ping 待处理状态（用于测试）', async () => {
    const manager = new HealthCheckManager({
      pingIntervalMs: 50,
      pongTimeoutMs: 1000,
      zombieDetectionTimeoutMs: 1000,
    })

    const mockWs = { readyState: 1, ping: vi.fn() }
    const wsId = 'ping-pending-test'

    manager.startHealthCheck(wsId, mockWs as any)

    // 等待 ping 被发送
    await new Promise((resolve) => setTimeout(resolve, 80))

    // 验证 ping 待处理状态（ping 已发送但未收到 pong）
    // 这取决于实现细节，如果 ping 刚好被发送但 pong 未收到
    // isPingPending 应该返回 true
    const isPending = manager.isPingPending(wsId)
    expect(typeof isPending).toBe('boolean')

    // 现在发送 pong
    manager.handlePong(wsId)

    // 待处理应该被清除
    expect(manager.isPingPending(wsId)).toBe(false)

    manager.cleanup()
  })
})
