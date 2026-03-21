// WebSocket 重连管理模块
// 实现指数退避重连策略

import { WebSocket } from 'ws'

export interface ReconnectConfig {
  // 初始重连延迟时间（毫秒），默认 1000ms
  initialDelayMs: number
  // 最大重连延迟时间（毫秒），默认 30000ms
  maxDelayMs: number
  // 重连延迟增长倍数，默认 2
  backoffMultiplier: number
  // 最大重连尝试次数，默认 3
  maxRetries: number
}

/**
 * WebSocket 重连管理器
 * 提供指数退避的自动重连机制
 */
export class ReconnectManager {
  private config: ReconnectConfig
  private retryCount: number = 0
  private currentDelayMs: number
  private retryTimer: NodeJS.Timeout | null = null

  constructor(config: Partial<ReconnectConfig> = {}) {
    this.config = {
      initialDelayMs: config.initialDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      maxRetries: config.maxRetries ?? 3,
    }
    this.currentDelayMs = this.config.initialDelayMs
  }

  /**
   * 尝试重连
   * 实现指数退避策略
   *
   * @param userId 用户 ID
   * @param token JWT 认证 token
   * @param wsUrl WebSocket 连接 URL
   * @param onReconnect 重连成功时的回调
   * @param onFailed 重连失败时的回调
   * @returns Promise 重连流程的 Promise
   */
  async attemptReconnect(
    userId: string,
    token: string,
    wsUrl: string,
    onReconnect: (ws: WebSocket) => void,
    onFailed: () => void
  ): Promise<void> {
    // 重连尝试次数超过限制
    if (this.retryCount >= this.config.maxRetries) {
      console.error(
        `❌ WebSocket 重连失败 (${userId}): 已达到最大重试次数 ${this.config.maxRetries}`
      )
      // 调用失败回调，但保留重试计数用于检查
      onFailed()
      return
    }

    // 计算本次延迟时间
    const delayMs = this.calculateDelay()
    console.log(
      `⏱️  WebSocket 重连等待 ${delayMs}ms (尝试 ${this.retryCount + 1}/${this.config.maxRetries}) (${userId})`
    )

    // 等待指定时间后重连
    await new Promise<void>((resolve) => {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        resolve()
      }, delayMs)
    })

    // 尝试建立新连接
    try {
      const ws = await this.createWebSocketConnection(token, wsUrl)
      console.log(`✓ WebSocket 重连成功 (${userId})`)
      // 成功后重置状态
      this.reset()
      onReconnect(ws)
    } catch (error) {
      console.warn(
        `⚠️  WebSocket 重连尝试失败 (${userId}):`,
        error instanceof Error ? error.message : String(error)
      )
      this.retryCount++
      // 递归尝试下一次重连
      await this.attemptReconnect(userId, token, wsUrl, onReconnect, onFailed)
    }
  }

  /**
   * 创建 WebSocket 连接
   * @param token 认证 token
   * @param wsUrl WebSocket URL
   * @returns 新的 WebSocket 连接
   */
  private createWebSocketConnection(token: string, wsUrl: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const fullUrl = `${wsUrl}?token=${encodeURIComponent(token)}`
      const ws = new WebSocket(fullUrl)

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('WebSocket 连接超时'))
      }, 2000) // 减少超时时间以加快测试

      ws.on('open', () => {
        clearTimeout(timeout)
        resolve(ws)
      })

      ws.on('error', (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  /**
   * 计算下一次重连的延迟时间（指数退避）
   * @returns 延迟时间（毫秒）
   */
  private calculateDelay(): number {
    // 计算延迟: initialDelay * (backoffMultiplier ^ retryCount)
    const delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, this.retryCount)
    // 不超过最大延迟
    const finalDelay = Math.min(delay, this.config.maxDelayMs)
    // 更新当前延迟用于下一次计算
    this.currentDelayMs = finalDelay
    return Math.floor(finalDelay)
  }

  /**
   * 重置重连状态
   */
  private reset(): void {
    this.retryCount = 0
    this.currentDelayMs = this.config.initialDelayMs
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /**
   * 停止重连并清理资源
   */
  stop(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.reset()
  }

  /**
   * 获取当前重试次数
   */
  getRetryCount(): number {
    return this.retryCount
  }

  /**
   * 获取当前延迟时间
   */
  getCurrentDelay(): number {
    return this.currentDelayMs
  }
}
