// WebSocket 会话持久化测试

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { db } from '../src/db/index'
import { WebSocketSession } from '../src/models/session'
import { v4 as uuidv4 } from 'uuid'

let enterpriseId: string
let userId: string
let secondUserId: string

describe('WebSocket 会话持久化', () => {
  beforeAll(() => {
    // 创建测试企业
    enterpriseId = `enterprise_${uuidv4()}`
    userId = `user_${uuidv4()}`
    secondUserId = `user_${uuidv4()}`

    // 创建测试企业
    db.createEnterprise({
      id: enterpriseId,
      name: '测试企业',
      description: '用于会话测试的企业',
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
      email: `session_test_${Date.now()}_${Math.random()}@example.com`,
      name: '测试用户1',
      passwordHash: 'hashed_password',
      enterpriseId,
      role: 'admin',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 创建第二个测试用户
    db.createUser({
      id: secondUserId,
      email: `session_test2_${Date.now()}_${Math.random()}@example.com`,
      name: '测试用户2',
      passwordHash: 'hashed_password',
      enterpriseId,
      role: 'user',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  afterAll(() => {
    // 清理测试数据
    const sessions1 = db.getWebSocketSessionsByUserId(userId)
    sessions1.forEach(session => {
      db.deleteWebSocketSession(session.id)
    })

    const sessions2 = db.getWebSocketSessionsByUserId(secondUserId)
    sessions2.forEach(session => {
      db.deleteWebSocketSession(session.id)
    })

    db.deleteUser(userId)
    db.deleteUser(secondUserId)
    db.deleteEnterprise(enterpriseId)
  })

  afterEach(() => {
    // 每个测试后清理此用户的会话
    const sessions = db.getWebSocketSessionsByUserId(userId)
    sessions.forEach(session => {
      db.deleteWebSocketSession(session.id)
    })
  })

  // ===== 基础 CRUD 操作测试 =====

  it('应该创建 WebSocket 会话并返回 true', () => {
    const sessionId = `session_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }

    const result = db.createWebSocketSession(session)
    expect(result).toBe(true)

    // 验证会话是否真的被创建
    const retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(sessionId)
    expect(retrieved?.userId).toBe(userId)
    expect(retrieved?.status).toBe('connected')
  })

  it('应该按 ID 获取 WebSocket 会话', () => {
    const sessionId = `session_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }

    db.createWebSocketSession(session)

    const retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.id).toBe(sessionId)
    expect(retrieved?.userId).toBe(userId)
    expect(retrieved?.connectedAt).toBe(now)
    expect(retrieved?.lastHeartbeat).toBe(now)
    expect(retrieved?.status).toBe('connected')
  })

  it('按 ID 获取不存在的会话应返回 null', () => {
    const retrieved = db.getWebSocketSessionById(`nonexistent_${uuidv4()}`)
    expect(retrieved).toBeNull()
  })

  it('应该获取单个用户的所有 WebSocket 会话', () => {
    const now = new Date().toISOString()

    // 创建多个会话
    const sessionIds = [1, 2, 3].map(() => `session_${uuidv4()}`)
    sessionIds.forEach(id => {
      const session: WebSocketSession = {
        id,
        userId,
        connectedAt: now,
        lastHeartbeat: now,
        status: 'connected',
      }
      db.createWebSocketSession(session)
    })

    // 获取用户的所有会话
    const sessions = db.getWebSocketSessionsByUserId(userId)
    expect(sessions.length).toBe(3)
    expect(sessions.every(s => s.userId === userId)).toBe(true)
  })

  it('获取不存在用户的会话应返回空数组', () => {
    const sessions = db.getWebSocketSessionsByUserId(`nonexistent_${uuidv4()}`)
    expect(sessions).toEqual([])
  })

  it('应该更新 WebSocket 会话状态并返回 true', () => {
    const sessionId = `session_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }

    db.createWebSocketSession(session)

    // 更新状态为 disconnected
    const result = db.updateWebSocketSessionStatus(sessionId, 'disconnected')
    expect(result).toBe(true)

    // 验证状态已更新
    const retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('disconnected')
  })

  it('更新不存在的会话状态应返回 false', () => {
    const result = db.updateWebSocketSessionStatus(`nonexistent_${uuidv4()}`, 'disconnected')
    expect(result).toBe(false)
  })

  it('应该更新 WebSocket 会话的最后心跳时间并返回 true', async () => {
    const sessionId = `session_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }

    db.createWebSocketSession(session)

    // 等待一点时间，然后更新心跳
    await new Promise(resolve => setTimeout(resolve, 10))
    const result = db.updateWebSocketSessionHeartbeat(sessionId)
    expect(result).toBe(true)

    // 验证心跳时间已更新
    const retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.lastHeartbeat).not.toBe(now)
  })

  it('应该删除指定 ID 的 WebSocket 会话并返回 true', () => {
    const sessionId = `session_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }

    db.createWebSocketSession(session)

    const result = db.deleteWebSocketSession(sessionId)
    expect(result).toBe(true)

    // 验证会话已被删除
    const retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved).toBeNull()
  })

  it('删除不存在的会话应返回 false', () => {
    const result = db.deleteWebSocketSession(`nonexistent_${uuidv4()}`)
    expect(result).toBe(false)
  })

  // ===== 多设备场景测试 =====

  it('应该处理单个用户的多个设备会话', () => {
    const now = new Date().toISOString()

    // 模拟同一用户在不同设备上的会话
    const deviceSessions = [
      { id: `session_phone_${uuidv4()}`, device: '手机' },
      { id: `session_tablet_${uuidv4()}`, device: '平板' },
      { id: `session_desktop_${uuidv4()}`, device: '桌面' },
    ]

    deviceSessions.forEach(({ id }) => {
      const session: WebSocketSession = {
        id,
        userId,
        connectedAt: now,
        lastHeartbeat: now,
        status: 'connected',
      }
      db.createWebSocketSession(session)
    })

    // 获取用户的所有会话
    const sessions = db.getWebSocketSessionsByUserId(userId)
    expect(sessions.length).toBe(3)

    // 验证所有会话都属于同一用户
    expect(sessions.every(s => s.userId === userId)).toBe(true)

    // 模拟断开一个设备的连接
    db.updateWebSocketSessionStatus(deviceSessions[0].id, 'disconnected')

    // 验证其他会话仍然连接
    const updatedSessions = db.getWebSocketSessionsByUserId(userId)
    const connectedCount = updatedSessions.filter(s => s.status === 'connected').length
    expect(connectedCount).toBe(2)
  })

  // ===== 会话恢复场景测试 =====

  it('应该支持会话恢复流程', () => {
    const sessionId = `session_${uuidv4()}`
    const now = new Date().toISOString()

    // 步骤1：创建会话
    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }
    db.createWebSocketSession(session)

    // 步骤2：连接断开，更新状态为 disconnected
    db.updateWebSocketSessionStatus(sessionId, 'disconnected')
    let retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('disconnected')

    // 步骤3：开始重连，更新状态为 reconnecting
    db.updateWebSocketSessionStatus(sessionId, 'reconnecting')
    retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('reconnecting')

    // 步骤4：重连成功，更新状态为 connected 并更新心跳
    db.updateWebSocketSessionStatus(sessionId, 'connected')
    db.updateWebSocketSessionHeartbeat(sessionId)
    retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('connected')
    expect(retrieved?.lastHeartbeat).not.toBe(now)
  })

  // ===== 并发操作测试 =====

  it('应该处理多个并发会话创建操作', () => {
    const now = new Date().toISOString()
    const sessionCount = 10

    // 创建多个会话
    const sessionIds: string[] = []
    for (let i = 0; i < sessionCount; i++) {
      const sessionId = `concurrent_session_${i}_${uuidv4()}`
      sessionIds.push(sessionId)
      const session: WebSocketSession = {
        id: sessionId,
        userId,
        connectedAt: now,
        lastHeartbeat: now,
        status: 'connected',
      }
      db.createWebSocketSession(session)
    }

    // 验证所有会话都已创建
    const sessions = db.getWebSocketSessionsByUserId(userId)
    expect(sessions.length).toBeGreaterThanOrEqual(sessionCount)

    // 验证所有会话都可以通过 ID 获取
    sessionIds.forEach(id => {
      const session = db.getWebSocketSessionById(id)
      expect(session).not.toBeNull()
      expect(session?.id).toBe(id)
    })
  })

  it('应该并发处理心跳更新不会产生冲突', async () => {
    const sessionId = `heartbeat_session_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }
    db.createWebSocketSession(session)

    // 模拟多次心跳更新
    const updates = 5
    for (let i = 0; i < updates; i++) {
      await new Promise(resolve => setTimeout(resolve, 2))
      db.updateWebSocketSessionHeartbeat(sessionId)
    }

    // 验证会话仍然有效且心跳已更新
    const retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.lastHeartbeat).not.toBe(now)
  })

  // ===== 清理操作测试 =====

  it('应该按用户 ID 删除所有会话', () => {
    const now = new Date().toISOString()

    // 创建多个会话
    const sessionCount = 5
    for (let i = 0; i < sessionCount; i++) {
      const sessionId = `cleanup_session_${i}_${uuidv4()}`
      const session: WebSocketSession = {
        id: sessionId,
        userId: secondUserId,
        connectedAt: now,
        lastHeartbeat: now,
        status: 'connected',
      }
      db.createWebSocketSession(session)
    }

    // 验证会话已创建
    let sessions = db.getWebSocketSessionsByUserId(secondUserId)
    expect(sessions.length).toBe(sessionCount)

    // 删除用户的所有会话
    const result = db.deleteWebSocketSessionsByUserId(secondUserId)
    expect(result).toBe(true)

    // 验证所有会话都已被删除
    sessions = db.getWebSocketSessionsByUserId(secondUserId)
    expect(sessions.length).toBe(0)
  })

  it('删除不存在用户的所有会话应返回 false（没有匹配的行）', () => {
    const nonexistentUserId = `nonexistent_user_${uuidv4()}`
    const result = db.deleteWebSocketSessionsByUserId(nonexistentUserId)
    // 没有匹配的行，SQLite 返回 false
    expect(result).toBe(false)
  })

  // ===== 会话状态转换测试 =====

  it('应该正确处理会话状态转换', () => {
    const sessionId = `state_transition_${uuidv4()}`
    const now = new Date().toISOString()

    const session: WebSocketSession = {
      id: sessionId,
      userId,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
    }
    db.createWebSocketSession(session)

    // 验证初始状态
    let retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('connected')

    // 转换: connected -> disconnected
    db.updateWebSocketSessionStatus(sessionId, 'disconnected')
    retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('disconnected')

    // 转换: disconnected -> reconnecting
    db.updateWebSocketSessionStatus(sessionId, 'reconnecting')
    retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('reconnecting')

    // 转换: reconnecting -> connected
    db.updateWebSocketSessionStatus(sessionId, 'connected')
    retrieved = db.getWebSocketSessionById(sessionId)
    expect(retrieved?.status).toBe('connected')
  })

  it('应该在获取会话列表时按 connectedAt 倒序排序', () => {
    const now = new Date()

    // 创建会话，间隔 100ms
    const sessionIds = []
    for (let i = 0; i < 3; i++) {
      const sessionId = `order_session_${i}_${uuidv4()}`
      sessionIds.push(sessionId)
      const session: WebSocketSession = {
        id: sessionId,
        userId,
        connectedAt: new Date(now.getTime() + i * 100).toISOString(),
        lastHeartbeat: new Date().toISOString(),
        status: 'connected',
      }
      db.createWebSocketSession(session)
    }

    // 获取会话并验证排序
    const sessions = db.getWebSocketSessionsByUserId(userId)
    const filteredSessions = sessions.filter(s => sessionIds.includes(s.id))

    // 应该按 connectedAt 倒序排列（最新的在前）
    for (let i = 0; i < filteredSessions.length - 1; i++) {
      const current = new Date(filteredSessions[i].connectedAt).getTime()
      const next = new Date(filteredSessions[i + 1].connectedAt).getTime()
      expect(current).toBeGreaterThanOrEqual(next)
    }
  })
})
