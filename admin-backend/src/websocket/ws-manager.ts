// WebSocket 连接管理器
// 管理活跃客户端连接、心跳、广播消息等

import { WebSocket } from 'ws'
import { ReconnectManager, ReconnectConfig } from './reconnect.js'
import { HealthCheckManager } from './health-check.js'

export interface WebSocketMessage {
  type: string
  data: any
  timestamp?: number
}

export interface ClientInfo {
  userId: string
  ws: WebSocket
  connectedAt: Date
  lastHeartbeat: Date
  token?: string // 用于重连时验证
  sessionStatus?: 'connected' | 'disconnected' | 'reconnecting'
}

export class WebSocketManager {
  private clients: Map<string, ClientInfo> = new Map()
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map()
  private reconnectManagers: Map<string, ReconnectManager> = new Map()
  private healthCheckManager: HealthCheckManager = new HealthCheckManager()
  private readonly HEARTBEAT_INTERVAL = 30000 // 30 秒
  private readonly HEARTBEAT_TIMEOUT = 5000 // 心跳超时时间
  private reconnectConfig: ReconnectConfig = {
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    maxRetries: 3,
  }

  constructor() {
    // 设置僵尸连接检测回调
    this.healthCheckManager.setZombieDetectionCallback((wsId: string) => {
      // 通过 userId 从 wsId 恢复（wsId 使用 userId_timestamp 格式或直接使用 userId）
      // 实际上，为了简化，我们需要维护从 wsId 到 userId 的映射
      // 但在当前架构中，wsId 就是 userId
      const userId = wsId
      this.handleZombieDetected(userId)
    })
  }

  /**
   * 注册客户端连接
   * @param userId 用户 ID
   * @param ws WebSocket 连接
   * @param token JWT 认证 token (用于重连)
   */
  registerClient(userId: string, ws: WebSocket, token?: string): void {
    // 如果用户已有连接，先关闭旧连接
    if (this.clients.has(userId)) {
      const oldClient = this.clients.get(userId)!
      this.unregisterClient(userId)
    }

    // 注册新连接
    const clientInfo: ClientInfo = {
      userId,
      ws,
      connectedAt: new Date(),
      lastHeartbeat: new Date(),
      token,
      sessionStatus: 'connected',
    }

    this.clients.set(userId, clientInfo)
    console.log(`✓ WebSocket 客户端已连接: ${userId}，当前连接数: ${this.clients.size}`)

    // 启动心跳
    this.startHeartbeat(userId, ws)
  }

  /**
   * 注销客户端连接
   * @param userId 用户 ID
   */
  unregisterClient(userId: string): void {
    const clientInfo = this.clients.get(userId)
    if (clientInfo) {
      // 停止心跳
      this.stopHeartbeat(userId)

      // 关闭 WebSocket 连接
      if (clientInfo.ws.readyState === WebSocket.OPEN) {
        clientInfo.ws.close(1000, '连接已断开')
      }

      // 从映射中移除
      this.clients.delete(userId)
      console.log(`✓ WebSocket 客户端已断开: ${userId}，当前连接数: ${this.clients.size}`)
    }
  }

  /**
   * 启动心跳检测
   * @param userId 用户 ID
   * @param ws WebSocket 连接
   */
  startHeartbeat(userId: string, ws: WebSocket): void {
    // 停止之前的心跳（如果存在）
    this.stopHeartbeat(userId)

    const intervalId = setInterval(() => {
      const clientInfo = this.clients.get(userId)
      if (!clientInfo) {
        clearInterval(intervalId)
        return
      }

      // 检查连接状态
      if (clientInfo.ws.readyState !== WebSocket.OPEN) {
        this.unregisterClient(userId)
        return
      }

      // 发送 ping 消息
      try {
        const message: WebSocketMessage = {
          type: 'ping',
          data: { timestamp: Date.now() },
        }
        clientInfo.ws.send(JSON.stringify(message))
        clientInfo.lastHeartbeat = new Date()
      } catch (error) {
        console.error(`❌ 心跳发送失败 (${userId}):`, error)
        this.unregisterClient(userId)
      }
    }, this.HEARTBEAT_INTERVAL)

    this.heartbeatIntervals.set(userId, intervalId)
  }

  /**
   * 停止心跳检测
   * @param userId 用户 ID
   */
  stopHeartbeat(userId: string): void {
    const intervalId = this.heartbeatIntervals.get(userId)
    if (intervalId) {
      clearInterval(intervalId)
      this.heartbeatIntervals.delete(userId)
    }
  }

  /**
   * 向指定用户发送消息
   * @param userId 用户 ID
   * @param message 消息对象
   * @returns 发送是否成功
   */
  sendToUser(userId: string, message: WebSocketMessage): boolean {
    const clientInfo = this.clients.get(userId)
    if (!clientInfo) {
      console.warn(`⚠️  用户未连接: ${userId}`)
      return false
    }

    if (clientInfo.ws.readyState !== WebSocket.OPEN) {
      console.warn(`⚠️  用户连接已关闭: ${userId}`)
      this.unregisterClient(userId)
      return false
    }

    try {
      const payload = {
        ...message,
        timestamp: message.timestamp || Date.now(),
      }
      clientInfo.ws.send(JSON.stringify(payload))
      return true
    } catch (error) {
      console.error(`❌ 消息发送失败 (${userId}):`, error)
      this.unregisterClient(userId)
      return false
    }
  }

  /**
   * 向多个用户广播消息
   * @param userIds 用户 ID 列表
   * @param message 消息对象
   * @returns 成功发送的用户数
   */
  broadcastToUsers(userIds: string[], message: WebSocketMessage): number {
    let successCount = 0
    for (const userId of userIds) {
      if (this.sendToUser(userId, message)) {
        successCount++
      }
    }
    return successCount
  }

  /**
   * 向所有连接的用户广播消息
   * @param message 消息对象
   * @returns 成功发送的用户数
   */
  broadcastToAll(message: WebSocketMessage): number {
    const userIds = Array.from(this.clients.keys())
    return this.broadcastToUsers(userIds, message)
  }

  /**
   * 获取活跃用户连接数
   * @returns 连接数
   */
  getActiveUserCount(): number {
    return this.clients.size
  }

  /**
   * 获取用户连接状态
   * @param userId 用户 ID
   * @returns 用户信息或 null
   */
  getUserStatus(userId: string): ClientInfo | null {
    return this.clients.get(userId) || null
  }

  /**
   * 获取所有活跃用户列表
   * @returns 用户 ID 列表
   */
  getActiveUsers(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * 检查用户是否在线
   * @param userId 用户 ID
   * @returns 是否在线
   */
  isUserOnline(userId: string): boolean {
    const clientInfo = this.clients.get(userId)
    if (!clientInfo) return false
    return clientInfo.ws.readyState === WebSocket.OPEN
  }

  /**
   * 清理所有连接（用于关闭应用）
   */
  closeAll(): void {
    const userIds = Array.from(this.clients.keys())
    for (const userId of userIds) {
      this.unregisterClient(userId)
    }
    // 停止所有重连尝试
    for (const manager of this.reconnectManagers.values()) {
      manager.stop()
    }
    this.reconnectManagers.clear()
    console.log('✓ 所有 WebSocket 连接已关闭')
  }

  /**
   * 启动重连流程
   * @param userId 用户 ID
   * @param token JWT 认证 token
   * @param wsUrl WebSocket 服务器 URL (例如: ws://localhost:3000/ws)
   */
  async initiateReconnect(userId: string, token: string, wsUrl: string): Promise<void> {
    // 更新会话状态为 reconnecting
    const clientInfo = this.clients.get(userId)
    if (clientInfo) {
      clientInfo.sessionStatus = 'reconnecting'
    }

    // 获取或创建重连管理器
    let reconnectManager = this.reconnectManagers.get(userId)
    if (!reconnectManager) {
      reconnectManager = new ReconnectManager(this.reconnectConfig)
      this.reconnectManagers.set(userId, reconnectManager)
    }

    try {
      await reconnectManager.attemptReconnect(
        userId,
        token,
        wsUrl,
        (ws: WebSocket) => {
          // 重连成功回调
          this.registerClient(userId, ws, token)
          this.reconnectManagers.delete(userId)
        },
        () => {
          // 重连失败回调
          const client = this.clients.get(userId)
          if (client) {
            client.sessionStatus = 'disconnected'
          }
          this.reconnectManagers.delete(userId)
        }
      )
    } catch (error) {
      console.error(`❌ 重连流程异常 (${userId}):`, error)
      const client = this.clients.get(userId)
      if (client) {
        client.sessionStatus = 'disconnected'
      }
      this.reconnectManagers.delete(userId)
    }
  }

  /**
   * 获取用户的会话状态
   * @param userId 用户 ID
   * @returns 会话状态: 'connected' | 'disconnected' | 'reconnecting' | null
   */
  getSessionStatus(userId: string): 'connected' | 'disconnected' | 'reconnecting' | null {
    const clientInfo = this.clients.get(userId)
    return clientInfo?.sessionStatus ?? null
  }

  /**
   * 获取管理器统计信息
   * @returns 统计对象
   */
  getStats(): {
    activeConnections: number
    activeUsers: string[]
    uptime: number
  } {
    return {
      activeConnections: this.clients.size,
      activeUsers: this.getActiveUsers(),
      uptime: process.uptime(),
    }
  }

  /**
   * 处理 pong 响应
   * @param userId 用户 ID
   */
  handlePong(userId: string): void {
    this.healthCheckManager.handlePong(userId)
  }

  /**
   * 处理僵尸连接检测
   * @param userId 用户 ID
   */
  private handleZombieDetected(userId: string): void {
    console.warn(`🧟 僵尸连接已清理: ${userId}`)
    // 注销该连接
    this.unregisterClient(userId)
    // 更新会话状态为 disconnected
    const clientInfo = this.clients.get(userId)
    if (clientInfo) {
      clientInfo.sessionStatus = 'disconnected'
    }
  }

  /**
   * 启动对单个连接的健康检查
   * @param userId 用户 ID
   * @param ws WebSocket 连接
   */
  startHealthCheck(userId: string, ws: WebSocket): void {
    this.healthCheckManager.startHealthCheck(userId, ws)
  }

  /**
   * 停止对单个连接的健康检查
   * @param userId 用户 ID
   */
  stopHealthCheck(userId: string): void {
    this.healthCheckManager.stopHealthCheck(userId)
  }

  /**
   * 执行一次全局健康检查扫描
   */
  performGlobalHealthCheck(): void {
    this.healthCheckManager.performGlobalHealthCheck()
  }

  /**
   * 启动全局定期健康检查扫描
   * @param intervalMs 扫描间隔（毫秒），默认 60000ms（60 秒）
   */
  startGlobalHealthCheckInterval(intervalMs: number = 60000): void {
    this.healthCheckManager.startGlobalHealthCheck(intervalMs)
  }

  /**
   * 停止全局定期健康检查扫描
   */
  stopGlobalHealthCheckInterval(): void {
    this.healthCheckManager.stopGlobalHealthCheck()
  }

  /**
   * 获取健康检查信息
   * @returns 健康检查统计信息
   */
  getHealthCheckInfo(): {
    activeConnections: number
    zombieConnections: number
    healthyConnections: number
    healthyRate: number
  } {
    return this.healthCheckManager.getHealthMetrics()
  }

  /**
   * 获取连接的健康状态
   * @param userId 用户 ID
   * @returns 是否健康
   */
  isConnectionHealthy(userId: string): boolean {
    return this.healthCheckManager.isHealthy(userId)
  }

  /**
   * 获取连接的最后 pong 时间
   * @param userId 用户 ID
   * @returns 时间戳
   */
  getLastPongTime(userId: string): number | null {
    return this.healthCheckManager.getLastPongTime(userId)
  }

  /**
   * 清理所有健康检查资源
   */
  cleanupHealthCheck(): void {
    this.healthCheckManager.cleanup()
  }
}

// 导出单例
export const wsManager = new WebSocketManager()
