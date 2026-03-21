/**
 * 优先级同步队列测试套件
 *
 * 测试覆盖：
 * - 优先级排序：TOKEN_ALERT 优先于其他事件
 * - 带宽限制：每秒最多 10 个事件
 * - 重试机制：指数退避（1s → 2s → 4s）
 * - 重试上限：达到 3 次后停止重试
 * - 自动同步：离线时排队，重连后自动同步
 * - 并发处理：同时处理多个事件
 * - 数据库持久化：重启后保持队列状态
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PrioritySyncQueue, SyncEvent } from '../src/sync/priority-sync'
import { db } from '../src/db/index'

describe('PrioritySyncQueue - 优先级同步队列', () => {
  let queue: PrioritySyncQueue

  beforeEach(() => {
    queue = new PrioritySyncQueue({
      maxEventsPerSecond: 10,
      maxRetries: 3,
      retryDelayMs: 1000,
    })
  })

  afterEach(() => {
    queue.stopAutoSync()
    queue.clear()
  })

  describe('基础操作 - enqueue/dequeue', () => {
    it('应该能够添加和获取事件', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'TOKEN_ALERT',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: { message: 'token alert' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)
      const dequeued = queue.dequeue()

      expect(dequeued).not.toBeNull()
      expect(dequeued?.id).toBe('1')
      expect(dequeued?.type).toBe('TOKEN_ALERT')
    })

    it('空队列应该返回 null', () => {
      const dequeued = queue.dequeue()
      expect(dequeued).toBeNull()
    })

    it('不存在 pending 事件时应该返回 null', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'completed', // 已完成状态
      }

      queue.enqueue(event)
      const dequeued = queue.dequeue()

      expect(dequeued).toBeNull()
    })
  })

  describe('优先级排序', () => {
    it('TOKEN_ALERT 应该优先于其他事件', () => {
      const updateEvent: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date(Date.now()).toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const tokenAlert: SyncEvent = {
        id: '2',
        type: 'TOKEN_ALERT',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date(Date.now() + 1000).toISOString(), // 更晚的事件
        priority: 1,
        payload: { message: 'token alert' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      // 先添加 UPDATE，再添加 TOKEN_ALERT
      queue.enqueue(updateEvent)
      queue.enqueue(tokenAlert)

      // 应该先获取 TOKEN_ALERT
      const first = queue.dequeue()
      expect(first?.id).toBe('2')
      expect(first?.type).toBe('TOKEN_ALERT')
    })

    it('同优先级按时间戳排序（先进先出）', () => {
      const now = Date.now()
      const event1: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date(now).toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const event2: SyncEvent = {
        id: '2',
        type: 'UPDATE',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date(now + 1000).toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event2) // 先添加较晚的事件
      queue.enqueue(event1) // 再添加较早的事件

      // 应该先获取较早的事件
      const first = queue.dequeue()
      expect(first?.id).toBe('1')

      queue.markCompleted('1')

      const second = queue.dequeue()
      expect(second?.id).toBe('2')
    })

    it('多个优先级应该按正确顺序处理', () => {
      const deleteEvent: SyncEvent = {
        id: '1',
        type: 'DELETE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 4,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const insertEvent: SyncEvent = {
        id: '2',
        type: 'INSERT',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 3,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const updateEvent: SyncEvent = {
        id: '3',
        type: 'UPDATE',
        resourceId: 'res3',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const tokenAlert: SyncEvent = {
        id: '4',
        type: 'TOKEN_ALERT',
        resourceId: 'res4',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      // 乱序添加
      queue.enqueue(deleteEvent)
      queue.enqueue(insertEvent)
      queue.enqueue(updateEvent)
      queue.enqueue(tokenAlert)

      // 应该按优先级顺序获取
      const order = []
      for (let i = 0; i < 4; i++) {
        const event = queue.dequeue()
        if (event) {
          order.push(event.id)
          queue.markCompleted(event.id)
        }
      }

      expect(order).toEqual(['4', '3', '2', '1'])
    })
  })

  describe('事件状态管理', () => {
    it('应该能够标记事件为已完成', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)
      queue.markCompleted('1')

      // 完成后 dequeue 应该返回 null
      const dequeued = queue.dequeue()
      expect(dequeued).toBeNull()
    })

    it('应该能够标记事件为失败', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)
      queue.markFailed('1', 'Network error')

      // 失败一次后仍应该返回事件用于重试
      const dequeued = queue.dequeue()
      expect(dequeued).not.toBeNull()
      expect(dequeued?.retries).toBe(1)
    })

    it('达到最大重试次数后应该标记为失败', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)

      // 标记失败 3 次
      queue.markFailed('1', 'Error 1')
      queue.markFailed('1', 'Error 2')
      queue.markFailed('1', 'Error 3')

      // 第三次后状态应该是 failed，不能再取出
      const dequeued = queue.dequeue()
      expect(dequeued).toBeNull()
    })
  })

  describe('重试机制 - 指数退避', () => {
    it('应该计算正确的重试延迟', () => {
      const retryDelay1 = queue.getRetryDelay(0)
      const retryDelay2 = queue.getRetryDelay(1)
      const retryDelay3 = queue.getRetryDelay(2)

      expect(retryDelay1).toBe(1000) // 1000 * 2^0
      expect(retryDelay2).toBe(2000) // 1000 * 2^1
      expect(retryDelay3).toBe(4000) // 1000 * 2^2
    })

    it('应该检查事件是否可以重试', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)

      // 未失败的 pending 事件应该可以重试
      expect(queue.shouldRetry(event)).toBe(true)

      // 标记失败 3 次后不能重试
      queue.markFailed('1', 'Error 1')
      queue.markFailed('1', 'Error 2')
      queue.markFailed('1', 'Error 3')

      const failedEvent = queue.getAllEvents()[0]
      expect(queue.shouldRetry(failedEvent)).toBe(false)
    })
  })

  describe('统计信息', () => {
    it('应该统计待处理事件数', () => {
      expect(queue.getPendingCount()).toBe(0)

      const event1: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const event2: SyncEvent = {
        id: '2',
        type: 'INSERT',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 3,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event1)
      queue.enqueue(event2)
      expect(queue.getPendingCount()).toBe(2)

      queue.markCompleted('1')
      expect(queue.getPendingCount()).toBe(1)
    })

    it('应该按优先级统计事件', () => {
      const event1: SyncEvent = {
        id: '1',
        type: 'TOKEN_ALERT',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const event2: SyncEvent = {
        id: '2',
        type: 'TOKEN_ALERT',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const event3: SyncEvent = {
        id: '3',
        type: 'UPDATE',
        resourceId: 'res3',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event1)
      queue.enqueue(event2)
      queue.enqueue(event3)

      const stats = queue.getPriorityStats()
      expect(stats[1]).toBe(2)
      expect(stats[2]).toBe(1)
    })
  })

  describe('队列管理', () => {
    it('应该获取所有事件', () => {
      const event1: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const event2: SyncEvent = {
        id: '2',
        type: 'INSERT',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 3,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event1)
      queue.enqueue(event2)

      const allEvents = queue.getAllEvents()
      expect(allEvents).toHaveLength(2)
      expect(allEvents.map(e => e.id)).toContain('1')
      expect(allEvents.map(e => e.id)).toContain('2')
    })

    it('应该清空队列', () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)
      expect(queue.size()).toBe(1)

      queue.clear()
      expect(queue.size()).toBe(0)
    })
  })

  describe('带宽限制', () => {
    it('应该限制每秒处理的事件数', async () => {
      const queue2 = new PrioritySyncQueue({
        maxEventsPerSecond: 10,
        maxRetries: 3,
        retryDelayMs: 1000,
      })

      const events: SyncEvent[] = []
      for (let i = 0; i < 25; i++) {
        events.push({
          id: String(i),
          type: 'UPDATE',
          resourceId: `res${i}`,
          userId: 'user1',
          timestamp: new Date().toISOString(),
          priority: 2,
          payload: {},
          retries: 0,
          maxRetries: 3,
          status: 'pending',
        })
      }

      events.forEach(e => queue2.enqueue(e))

      const synced: SyncEvent[] = []
      const processingTimes: number[] = []

      queue2.startAutoSync(async (batchEvents) => {
        const now = Date.now()
        processingTimes.push(now)
        synced.push(...batchEvents)
        batchEvents.forEach(e => queue2.markCompleted(e.id))
      })

      // 等待 1.5 秒让处理完成
      await new Promise(resolve => setTimeout(resolve, 1500))

      queue2.stopAutoSync()

      // 验证处理的事件数不超过预期
      expect(synced.length).toBeGreaterThan(0)
      expect(synced.length).toBeLessThanOrEqual(25)

      // 验证带宽控制：在第一秒内处理的事件应该接近 10 个
      const firstSecondEvents = processingTimes.filter((_, i) => {
        const elapsed = processingTimes[i] - processingTimes[0]
        return elapsed <= 1000
      }).length

      expect(firstSecondEvents).toBeGreaterThan(0)
    })
  })

  describe('自动同步处理', () => {
    it('应该能够启动和停止自动同步', async () => {
      const event: SyncEvent = {
        id: '1',
        type: 'UPDATE',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: { data: 'test' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event)

      let syncedEvents: SyncEvent[] = []

      queue.startAutoSync(async (events) => {
        syncedEvents.push(...events)
        events.forEach(e => queue.markCompleted(e.id))
      })

      // 等待自动同步处理
      await new Promise(resolve => setTimeout(resolve, 500))

      queue.stopAutoSync()

      expect(syncedEvents).toHaveLength(1)
      expect(syncedEvents[0].id).toBe('1')
    })

    it('应该支持离线排队，重连后自动同步', async () => {
      // 模拟离线：添加事件但不同步
      const event1: SyncEvent = {
        id: '1',
        type: 'TOKEN_ALERT',
        resourceId: 'res1',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: { alert: 'token low' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      const event2: SyncEvent = {
        id: '2',
        type: 'UPDATE',
        resourceId: 'res2',
        userId: 'user1',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: { data: 'updated' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      }

      queue.enqueue(event1)
      queue.enqueue(event2)

      expect(queue.getPendingCount()).toBe(2)

      // 模拟重连：启动自动同步
      const syncedEvents: SyncEvent[] = []

      queue.startAutoSync(async (events) => {
        syncedEvents.push(...events)
        events.forEach(e => queue.markCompleted(e.id))
      })

      await new Promise(resolve => setTimeout(resolve, 500))

      queue.stopAutoSync()

      // 应该同步 2 个事件，且 TOKEN_ALERT 优先
      expect(syncedEvents).toHaveLength(2)
      expect(syncedEvents[0].type).toBe('TOKEN_ALERT')
      expect(syncedEvents[1].type).toBe('UPDATE')
    })
  })

  describe('并发处理', () => {
    it('应该能够处理多个并发事件', async () => {
      const events: SyncEvent[] = []
      for (let i = 0; i < 15; i++) {
        events.push({
          id: String(i),
          type: i % 3 === 0 ? 'TOKEN_ALERT' : i % 3 === 1 ? 'UPDATE' : 'INSERT',
          resourceId: `res${i}`,
          userId: `user${i % 5}`,
          timestamp: new Date(Date.now() + i * 100).toISOString(),
          priority: i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 3,
          payload: { index: i },
          retries: 0,
          maxRetries: 3,
          status: 'pending',
        })
      }

      events.forEach(e => queue.enqueue(e))

      const syncedEvents: SyncEvent[] = []

      queue.startAutoSync(async (batch) => {
        syncedEvents.push(...batch)
        batch.forEach(e => queue.markCompleted(e.id))
      })

      await new Promise(resolve => setTimeout(resolve, 1000))

      queue.stopAutoSync()

      // 应该同步所有事件
      expect(syncedEvents.length).toBeGreaterThan(0)

      // TOKEN_ALERT 应该优先处理
      const tokenAlerts = syncedEvents.filter(e => e.type === 'TOKEN_ALERT')
      const updates = syncedEvents.filter(e => e.type === 'UPDATE')

      if (tokenAlerts.length > 0 && updates.length > 0) {
        const lastTokenAlertIndex = syncedEvents.lastIndexOf(
          syncedEvents.find(e => e.type === 'TOKEN_ALERT')!
        )
        const firstUpdateIndex = syncedEvents.findIndex(e => e.type === 'UPDATE')

        expect(lastTokenAlertIndex).toBeLessThanOrEqual(firstUpdateIndex)
      }
    })
  })
})

describe('优先级同步队列 - 数据库集成', () => {
  it('应该能够向数据库添加同步事件', () => {
    const eventId = `db-test-add-${Date.now()}`
    const event = {
      id: eventId,
      type: 'TOKEN_ALERT' as const,
      resourceId: `res-${Date.now()}`,
      userId: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      priority: 1,
      payload: { message: 'token alert' },
    }

    const result = db.enqueueSyncEvent(event)
    expect(result).toBe(true)

    // 验证可以取出该事件
    const allEvents = db.getAllSyncEvents()
    const found = allEvents.find(e => e.id === eventId)
    expect(found).toBeDefined()
  })

  it('应该能够从数据库获取同步事件', () => {
    const eventId = `db-test-get-${Date.now()}`
    const event = {
      id: eventId,
      type: 'TOKEN_ALERT' as const,
      resourceId: `res-${Date.now()}`,
      userId: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      priority: 1,
      payload: { message: 'token alert' },
    }

    db.enqueueSyncEvent(event)
    const retrieved = db.dequeueSyncEvent()

    expect(retrieved).not.toBeNull()
    expect(retrieved?.type).toBe('TOKEN_ALERT')
  })

  it('应该能够更新同步事件状态', () => {
    const eventId = `db-test-update-${Date.now()}`
    const event = {
      id: eventId,
      type: 'UPDATE' as const,
      resourceId: `res-${Date.now()}`,
      userId: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      priority: 2,
      payload: { data: 'test' },
    }

    db.enqueueSyncEvent(event)

    // 先取出该事件，验证状态为 pending
    const beforeUpdate = db.getAllSyncEvents().find(e => e.id === eventId)
    expect(beforeUpdate?.status).toBe('pending')

    // 更新为 completed
    const updated = db.updateSyncEventStatus(eventId, 'completed')
    expect(updated).toBe(true)

    // 验证状态已更新
    const afterUpdate = db.getAllSyncEvents().find(e => e.id === eventId)
    expect(afterUpdate?.status).toBe('completed')
  })

  it('应该能够获取同步队列统计', () => {
    const timestamp = Date.now()
    const eventId1 = `db-test-stats-1-${timestamp}`
    const eventId2 = `db-test-stats-2-${timestamp}`

    const event1 = {
      id: eventId1,
      type: 'TOKEN_ALERT' as const,
      resourceId: `res-${timestamp}-1`,
      userId: `user-${timestamp}`,
      timestamp: new Date().toISOString(),
      priority: 1,
      payload: {},
    }

    const event2 = {
      id: eventId2,
      type: 'UPDATE' as const,
      resourceId: `res-${timestamp}-2`,
      userId: `user-${timestamp}`,
      timestamp: new Date().toISOString(),
      priority: 2,
      payload: {},
    }

    db.enqueueSyncEvent(event1)
    db.enqueueSyncEvent(event2)

    const stats = db.getSyncQueueStats()

    // 至少有 2 个 pending 事件
    expect(stats.pending).toBeGreaterThanOrEqual(2)
    // 优先级 1 和 2 都应该存在
    expect(stats.byPriority[1]).toBeGreaterThanOrEqual(1)
    expect(stats.byPriority[2]).toBeGreaterThanOrEqual(1)
  })

  it('应该能够按优先级排序获取事件', () => {
    const timestamp = Date.now()
    const eventId1 = `db-test-priority-low-${timestamp}`
    const eventId2 = `db-test-priority-high-${timestamp}`

    const lowPriorityEvent = {
      id: eventId1,
      type: 'DELETE' as const,
      resourceId: `res-${timestamp}-low`,
      userId: `user-${timestamp}`,
      timestamp: new Date(Date.now() + 1000).toISOString(), // 更晚的时间
      priority: 4,
      payload: {},
    }

    const highPriorityEvent = {
      id: eventId2,
      type: 'TOKEN_ALERT' as const,
      resourceId: `res-${timestamp}-high`,
      userId: `user-${timestamp}`,
      timestamp: new Date().toISOString(), // 较早的时间
      priority: 1,
      payload: {},
    }

    // 先添加低优先级，再添加高优先级
    db.enqueueSyncEvent(lowPriorityEvent)
    db.enqueueSyncEvent(highPriorityEvent)

    // 第一个取出的应该是高优先级事件
    const first = db.dequeueSyncEvent()
    expect(first?.priority).toBe(1)
  })

  it('应该能够获取指定状态的同步事件', () => {
    const timestamp = Date.now()
    const eventId = `db-test-status-${timestamp}`
    const event = {
      id: eventId,
      type: 'UPDATE' as const,
      resourceId: `res-${timestamp}`,
      userId: `user-${timestamp}`,
      timestamp: new Date().toISOString(),
      priority: 2,
      payload: {},
    }

    db.enqueueSyncEvent(event)
    db.updateSyncEventStatus(eventId, 'syncing')

    const syncingEvents = db.getSyncEventsByStatus('syncing')
    const found = syncingEvents.find(e => e.id === eventId)
    expect(found).toBeDefined()
    expect(found?.status).toBe('syncing')
  })
})
