// WebSocket 健康检查管理模块
// 实现心跳检测和僵尸连接清理机制

import { WebSocket } from 'ws'

export interface HealthCheckConfig {
  // ping 发送间隔，单位毫秒，默认 30000ms（30 秒）
  pingIntervalMs: number
  // pong 响应超时，单位毫秒，默认 5000ms（5 秒）
  pongTimeoutMs: number
  // 僵尸连接检测超时，单位毫秒，默认 5000ms（5 秒）
  zombieDetectionTimeoutMs: number
}

export interface ConnectionHealthState {
  // WebSocket ID
  wsId: string
  // WebSocket 连接
  ws: WebSocket
  // 最后一次 pong 时间戳
  lastPongTime: number | null
  // 是否已发送 ping 但未收到 pong
  pingPending: boolean
  // ping 发送时间戳
  pingSentTime: number | null
  // ping 检测定时器
  pingTimer: NodeJS.Timeout | null
  // pong 响应超时定时器
  pongTimeoutTimer: NodeJS.Timeout | null
  // 失败次数
  failureCount: number
}

/**
 * WebSocket 健康检查管理器
 * 检测僵尸连接、自动清理断开的会话、维持连接活跃
 */
export class HealthCheckManager {
  private config: HealthCheckConfig
  // 存储每个连接的健康检查状态
  private healthStates: Map<string, ConnectionHealthState> = new Map()
  // 全局健康检查定时器
  private globalHealthCheckTimer: NodeJS.Timeout | null = null
  // 回调：清理僵尸连接
  private onZombieDetected: ((wsId: string) => void) | null = null

  constructor(config?: Partial<HealthCheckConfig>) {
    this.config = {
      pingIntervalMs: config?.pingIntervalMs ?? 30000,
      pongTimeoutMs: config?.pongTimeoutMs ?? 5000,
      zombieDetectionTimeoutMs: config?.zombieDetectionTimeoutMs ?? 5000,
    }
  }

  /**
   * 设置僵尸连接检测回调
   * @param callback 回调函数
   */
  setZombieDetectionCallback(callback: (wsId: string) => void): void {
    this.onZombieDetected = callback
  }

  /**
   * 启动对单个连接的心跳检查
   * @param wsId WebSocket ID
   * @param ws WebSocket 连接
   */
  startHealthCheck(wsId: string, ws: WebSocket): void {
    // 如果已存在该连接的健康检查，先停止它
    if (this.healthStates.has(wsId)) {
      this.stopHealthCheck(wsId)
    }

    // 初始化健康检查状态
    const healthState: ConnectionHealthState = {
      wsId,
      ws,
      lastPongTime: Date.now(),
      pingPending: false,
      pingSentTime: null,
      pingTimer: null,
      pongTimeoutTimer: null,
      failureCount: 0,
    }

    this.healthStates.set(wsId, healthState)

    // 启动 ping 定时器
    this.startPingTimer(wsId)
  }

  /**
   * 停止单个连接的心跳检查
   * @param wsId WebSocket ID
   */
  stopHealthCheck(wsId: string): void {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return
    }

    // 清理定时器
    if (healthState.pingTimer) {
      clearInterval(healthState.pingTimer)
      healthState.pingTimer = null
    }

    if (healthState.pongTimeoutTimer) {
      clearTimeout(healthState.pongTimeoutTimer)
      healthState.pongTimeoutTimer = null
    }

    // 从映射中移除
    this.healthStates.delete(wsId)
  }

  /**
   * 启动 ping 定时器
   * @param wsId WebSocket ID
   */
  private startPingTimer(wsId: string): void {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return
    }

    // 清理之前的定时器
    if (healthState.pingTimer) {
      clearInterval(healthState.pingTimer)
    }

    // 启动新的定时器
    const pingTimer = setInterval(() => {
      this.sendPing(wsId)
    }, this.config.pingIntervalMs)

    healthState.pingTimer = pingTimer
  }

  /**
   * 发送 ping 消息
   * @param wsId WebSocket ID
   */
  private sendPing(wsId: string): void {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return
    }

    // 检查连接状态
    if (healthState.ws.readyState !== WebSocket.OPEN) {
      this.stopHealthCheck(wsId)
      return
    }

    // 如果上一个 ping 还未收到 pong，标记为失败
    if (healthState.pingPending) {
      healthState.failureCount++

      // 如果连续失败次数超过 1 次，标记为僵尸连接
      if (healthState.failureCount > 1) {
        this.markAsZombie(wsId)
        return
      }
    }

    // 发送 ping
    try {
      healthState.ws.ping()
      healthState.pingPending = true
      healthState.pingSentTime = Date.now()
      healthState.failureCount = 0

      // 设置 pong 响应超时定时器
      this.setPongTimeoutTimer(wsId)
    } catch (error) {
      console.error(`❌ ping 发送失败 (${wsId}):`, error)
      this.stopHealthCheck(wsId)
    }
  }

  /**
   * 设置 pong 响应超时定时器
   * @param wsId WebSocket ID
   */
  private setPongTimeoutTimer(wsId: string): void {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return
    }

    // 清理之前的超时定时器
    if (healthState.pongTimeoutTimer) {
      clearTimeout(healthState.pongTimeoutTimer)
    }

    // 设置新的超时定时器
    const timeoutTimer = setTimeout(() => {
      healthState.pongTimeoutTimer = null

      // 检查是否仍未收到 pong
      if (healthState.pingPending && healthState.pingSentTime) {
        const elapsedTime = Date.now() - healthState.pingSentTime
        if (elapsedTime >= this.config.pongTimeoutMs) {
          // pong 响应超时，不重置 pingPending，让下一次 ping 检测失败
          // 这会导致 failureCount 增加，最终标记为僵尸
        }
      }
    }, this.config.pongTimeoutMs)

    healthState.pongTimeoutTimer = timeoutTimer
  }

  /**
   * 处理 pong 响应
   * @param wsId WebSocket ID
   */
  handlePong(wsId: string): void {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return
    }

    const now = Date.now()
    healthState.lastPongTime = now
    healthState.pingPending = false
    healthState.pingSentTime = null
    healthState.failureCount = 0

    // 清理超时定时器
    if (healthState.pongTimeoutTimer) {
      clearTimeout(healthState.pongTimeoutTimer)
      healthState.pongTimeoutTimer = null
    }
  }

  /**
   * 标记连接为僵尸连接
   * @param wsId WebSocket ID
   */
  private markAsZombie(wsId: string): void {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return
    }

    console.warn(`⚠️  检测到僵尸连接: ${wsId}`)

    // 停止健康检查
    this.stopHealthCheck(wsId)

    // 触发回调
    if (this.onZombieDetected) {
      this.onZombieDetected(wsId)
    }
  }

  /**
   * 检查连接是否健康
   * @param wsId WebSocket ID
   * @returns 是否健康
   */
  isHealthy(wsId: string): boolean {
    const healthState = this.healthStates.get(wsId)
    if (!healthState) {
      return false
    }

    // 检查连接状态
    if (healthState.ws.readyState !== WebSocket.OPEN) {
      return false
    }

    // 检查上一次 pong 时间
    if (healthState.lastPongTime === null) {
      return false
    }

    const timeSinceLastPong = Date.now() - healthState.lastPongTime
    // 如果距离上次 pong 超过 ping 间隔 + pong 超时时间，认为不健康
    const healthyTimeout = this.config.pingIntervalMs + this.config.pongTimeoutMs

    return timeSinceLastPong <= healthyTimeout
  }

  /**
   * 获取最后一次 pong 的时间戳
   * @param wsId WebSocket ID
   * @returns 时间戳，如果不存在则返回 null
   */
  getLastPongTime(wsId: string): number | null {
    const healthState = this.healthStates.get(wsId)
    return healthState?.lastPongTime ?? null
  }

  /**
   * 获取健康检查统计信息
   * @returns 统计对象
   */
  getHealthMetrics(): {
    activeConnections: number
    zombieConnections: number
    healthyConnections: number
    healthyRate: number
  } {
    const activeConnections = this.healthStates.size

    let healthyConnections = 0
    for (const healthState of this.healthStates.values()) {
      if (this.isHealthy(healthState.wsId)) {
        healthyConnections++
      }
    }

    const zombieConnections = activeConnections - healthyConnections
    const healthyRate = activeConnections === 0 ? 1 : healthyConnections / activeConnections

    return {
      activeConnections,
      zombieConnections,
      healthyConnections,
      healthyRate,
    }
  }

  /**
   * 启动全局定期健康检查扫描
   * @param intervalMs 扫描间隔（毫秒）
   */
  startGlobalHealthCheck(intervalMs: number = 60000): void {
    // 如果已有扫描定时器，先清理
    if (this.globalHealthCheckTimer) {
      clearInterval(this.globalHealthCheckTimer)
    }

    this.globalHealthCheckTimer = setInterval(() => {
      this.performGlobalHealthCheck()
    }, intervalMs)
  }

  /**
   * 停止全局定期健康检查扫描
   */
  stopGlobalHealthCheck(): void {
    if (this.globalHealthCheckTimer) {
      clearInterval(this.globalHealthCheckTimer)
      this.globalHealthCheckTimer = null
    }
  }

  /**
   * 执行一次全局健康检查扫描
   * 清理所有不健康的连接
   */
  performGlobalHealthCheck(): void {
    const wsIds = Array.from(this.healthStates.keys())

    for (const wsId of wsIds) {
      const healthState = this.healthStates.get(wsId)
      if (!healthState) {
        continue
      }

      // 检查连接状态
      if (healthState.ws.readyState !== WebSocket.OPEN) {
        this.stopHealthCheck(wsId)
        continue
      }

      // 检查是否健康
      if (!this.isHealthy(wsId)) {
        // 标记为僵尸连接
        this.markAsZombie(wsId)
      }
    }
  }

  /**
   * 清理所有健康检查
   */
  cleanup(): void {
    // 停止全局扫描
    this.stopGlobalHealthCheck()

    // 停止所有连接的健康检查
    const wsIds = Array.from(this.healthStates.keys())
    for (const wsId of wsIds) {
      this.stopHealthCheck(wsId)
    }

    // 清除回调
    this.onZombieDetected = null
  }

  /**
   * 获取连接的失败次数（用于测试）
   * @param wsId WebSocket ID
   * @returns 失败次数，如果不存在则返回 -1
   */
  getFailureCount(wsId: string): number {
    const healthState = this.healthStates.get(wsId)
    return healthState?.failureCount ?? -1
  }

  /**
   * 获取连接是否在等待 pong（用于测试）
   * @param wsId WebSocket ID
   * @returns 是否在等待 pong
   */
  isPingPending(wsId: string): boolean {
    const healthState = this.healthStates.get(wsId)
    return healthState?.pingPending ?? false
  }
}
