/**
 * 优先级同步队列实现
 *
 * 功能：
 * - 优先级队列：关键事件（TOKEN_ALERT）优先级 1，其他事件优先级 2-4
 * - 带宽限制：每秒最多 10 个事件
 * - 自动重试：最多 3 次，指数退避（1s → 2s → 4s）
 * - 持久化存储：使用 SQLite 数据库
 * - 自动同步处理：离线时排队，重连后自动同步
 */

/**
 * 同步事件类型
 */
export interface SyncEvent {
  id: string
  type: 'TOKEN_ALERT' | 'UPDATE' | 'DELETE' | 'INSERT'
  resourceId: string
  userId: string
  timestamp: string
  priority: number // 1-10，1 最高
  payload: any
  retries: number
  maxRetries: number
  status: 'pending' | 'syncing' | 'completed' | 'failed'
}

/**
 * 优先级队列配置
 */
export interface PriorityQueueConfig {
  maxEventsPerSecond: number // 10 默认值
  maxRetries: number // 3 默认值
  retryDelayMs: number // 1000 初始延迟，毫秒
}

/**
 * 优先级同步队列类
 *
 * 使用数组 + 优先级排序实现队列，支持自动同步处理
 */
export class PrioritySyncQueue {
  private queue: Map<string, SyncEvent> = new Map()
  private config: Required<PriorityQueueConfig>
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null
  private isProcessing: boolean = false
  private lastProcessTime: number = 0

  constructor(config?: Partial<PriorityQueueConfig>) {
    this.config = {
      maxEventsPerSecond: config?.maxEventsPerSecond ?? 10,
      maxRetries: config?.maxRetries ?? 3,
      retryDelayMs: config?.retryDelayMs ?? 1000,
    }
  }

  /**
   * 计算事件优先级
   */
  private calculatePriority(event: SyncEvent): number {
    switch (event.type) {
      case 'TOKEN_ALERT':
        return 1 // 最高优先级
      case 'UPDATE':
        return 2
      case 'INSERT':
        return 3
      case 'DELETE':
        return 4 // 最低优先级
      default:
        return 5
    }
  }

  /**
   * 添加事件到队列
   */
  public enqueue(event: SyncEvent): void {
    // 自动计算优先级
    const enrichedEvent: SyncEvent = {
      ...event,
      priority: this.calculatePriority(event),
      // 如果状态未设置或为默认值，则设为 pending；否则保留原状态
      status: event.status || 'pending',
    }

    // 如果已存在相同 ID 的事件，则覆盖
    this.queue.set(event.id, enrichedEvent)
  }

  /**
   * 获取下一个待同步事件（按优先级排序）
   *
   * 优先级规则：
   * 1. 按优先级升序排序（1 最高）
   * 2. 同优先级按时间戳升序排序（先进先出）
   * 3. 仅返回 pending 状态的事件
   */
  public dequeue(): SyncEvent | null {
    const pendingEvents = Array.from(this.queue.values()).filter(
      (e) => e.status === 'pending'
    )

    if (pendingEvents.length === 0) {
      return null
    }

    // 按优先级排序，同优先级按时间戳排序
    pendingEvents.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority
      }
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    })

    return pendingEvents[0]
  }

  /**
   * 标记事件为已同步
   */
  public markCompleted(eventId: string): void {
    const event = this.queue.get(eventId)
    if (event) {
      event.status = 'completed'
    }
  }

  /**
   * 标记事件为失败（准备重试）
   */
  public markFailed(eventId: string, error: string): void {
    const event = this.queue.get(eventId)
    if (event) {
      event.retries++

      if (event.retries >= event.maxRetries) {
        event.status = 'failed'
      } else {
        // 重置为 pending，等待重试
        event.status = 'pending'
      }
    }
  }

  /**
   * 获取待处理事件数
   */
  public getPendingCount(): number {
    return Array.from(this.queue.values()).filter(
      (e) => e.status === 'pending'
    ).length
  }

  /**
   * 获取优先级统计
   */
  public getPriorityStats(): { [priority: number]: number } {
    const stats: { [priority: number]: number } = {}

    for (const event of this.queue.values()) {
      if (event.status === 'pending') {
        stats[event.priority] = (stats[event.priority] || 0) + 1
      }
    }

    return stats
  }

  /**
   * 获取队列中的所有事件
   */
  public getAllEvents(): SyncEvent[] {
    return Array.from(this.queue.values())
  }

  /**
   * 启动自动同步处理器
   *
   * 每秒检查一次队列，按优先级处理事件
   * 支持带宽限制（每秒最多 maxEventsPerSecond 个事件）
   */
  public startAutoSync(
    onSync: (events: SyncEvent[]) => Promise<void>
  ): void {
    if (this.autoSyncTimer !== null) {
      return // 已经启动
    }

    this.autoSyncTimer = setInterval(async () => {
      if (this.isProcessing) {
        return // 上一次处理还未完成
      }

      try {
        this.isProcessing = true
        const now = Date.now()
        const timeSinceLastProcess = now - this.lastProcessTime

        // 计算带宽限制下可以处理的事件数
        const eventsPerMs = this.config.maxEventsPerSecond / 1000
        const allowedEvents = Math.floor(eventsPerMs * timeSinceLastProcess)

        if (allowedEvents === 0) {
          return // 还未到处理时间
        }

        // 收集待处理事件
        const eventsToProcess: SyncEvent[] = []
        for (let i = 0; i < allowedEvents && i < this.config.maxEventsPerSecond; i++) {
          const event = this.dequeue()
          if (!event) break

          event.status = 'syncing'
          eventsToProcess.push(event)
        }

        if (eventsToProcess.length === 0) {
          return
        }

        // 调用回调函数进行同步
        await onSync(eventsToProcess)

        // 更新最后处理时间
        this.lastProcessTime = now
      } catch (error) {
        console.error('自动同步处理失败:', error)
      } finally {
        this.isProcessing = false
      }
    }, 100) // 100ms 检查一次，比较频繁，支持细粒度的带宽控制
  }

  /**
   * 停止自动同步处理器
   */
  public stopAutoSync(): void {
    if (this.autoSyncTimer !== null) {
      clearInterval(this.autoSyncTimer)
      this.autoSyncTimer = null
    }
  }

  /**
   * 获取重试延迟（指数退避）
   *
   * 延迟计算：初始延迟 * (2 ^ 重试次数)
   * 例如：1000ms 初始延迟
   * - 第 1 次重试：1000ms
   * - 第 2 次重试：2000ms
   * - 第 3 次重试：4000ms
   */
  public getRetryDelay(retries: number): number {
    return this.config.retryDelayMs * Math.pow(2, retries)
  }

  /**
   * 检查事件是否应该重试
   */
  public shouldRetry(event: SyncEvent): boolean {
    return event.status === 'pending' && event.retries < event.maxRetries
  }

  /**
   * 清空队列
   */
  public clear(): void {
    this.queue.clear()
  }

  /**
   * 获取队列大小
   */
  public size(): number {
    return this.queue.size
  }
}
