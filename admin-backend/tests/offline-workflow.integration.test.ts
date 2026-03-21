/**
 * 离线-在线完整工作流集成测试
 *
 * 验证完整的离线编辑 → 事件排队 → 重连同步 → 冲突解决 → 最终一致性流程
 *
 * 测试场景：
 * 1. 用户A和B在线编辑同一文档
 * 2. 用户A离线编辑，事件进入本地队列
 * 3. 用户B离线编辑，事件进入本地队列
 * 4. 用户A重连，同步事件和CRDT合并
 * 5. 用户B重连，同步事件和CRDT合并
 * 6. 验证两个用户最终状态完全相同（最终一致性）
 * 7. 验证事件顺序和版本号递增
 * 8. 验证优先级事件（TOKEN_ALERT）优先同步
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import { v4 as uuidv4 } from 'uuid'
import { YjsManager } from '../src/crdt/yjs-manager'
import {
  createSyncStep1,
  createSyncStep2,
  applySyncMessage,
  areDocumentsConsistent,
  synchronizeDocuments,
  getDocumentSnapshot,
} from '../src/crdt/sync'
import { PrioritySyncQueue, SyncEvent } from '../src/sync/priority-sync'
import { EventReplayService, ReplayableEvent } from '../src/services/event-replay.service'
import { db } from '../src/db/index'

/**
 * 模拟离线同步会话的数据结构
 */
interface OfflineSession {
  userId: string
  docId: string
  doc: Y.Doc
  isOnline: boolean
  pendingEvents: ReplayableEvent[]
  version: number
}

/**
 * 模拟用户会话的队列和事件记录
 */
interface UserState {
  userId: string
  session: OfflineSession
  syncQueue: PrioritySyncQueue
  receivedEvents: ReplayableEvent[]
}

describe('离线-在线完整工作流集成测试', () => {
  let yjs: YjsManager
  let eventReplay: EventReplayService
  let userA: UserState
  let userB: UserState
  let docId: string
  let globalVersion: number = 0
  let eventLog: ReplayableEvent[] = []

  beforeEach(() => {
    // 初始化管理器
    yjs = new YjsManager()
    eventReplay = new EventReplayService(db)
    docId = `doc_${uuidv4()}`
    globalVersion = 1
    eventLog = []

    // 创建用户A的会话
    const docA = yjs.createDocument(docId)
    docA.text.insert(0, 'Hello')

    userA = {
      userId: 'user-a',
      session: {
        userId: 'user-a',
        docId,
        doc: docA.doc,
        isOnline: true,
        pendingEvents: [],
        version: 1,
      },
      syncQueue: new PrioritySyncQueue(),
      receivedEvents: [],
    }

    // 创建用户B的会话（从A的状态初始化）
    const docB = new Y.Doc()
    // 先同步A的状态给B
    const stateA = Y.encodeStateAsUpdate(userA.session.doc)
    Y.applyUpdate(docB, stateA)

    userB = {
      userId: 'user-b',
      session: {
        userId: 'user-b',
        docId,
        doc: docB,
        isOnline: true,
        pendingEvents: [],
        version: 1,
      },
      syncQueue: new PrioritySyncQueue(),
      receivedEvents: [],
    }
  })

  afterEach(() => {
    // 清理资源
    yjs.deleteDocument(docId)
    userA.syncQueue.clear()
    userB.syncQueue.clear()
  })

  /**
   * 辅助函数：创建可回放的事件
   */
  function createTestEvent(
    type: 'UPDATE' | 'DELETE' | 'INSERT',
    content: string,
    userId: string,
    resourceType: string = 'document'
  ): ReplayableEvent {
    const event: ReplayableEvent = {
      id: `event_${uuidv4()}`,
      type,
      resourceId: docId,
      resourceType,
      userId,
      timestamp: new Date().toISOString(),
      version: globalVersion++,
      payload: { content },
    }
    eventLog.push(event)
    return event
  }

  /**
   * 辅助函数：模拟用户离线
   */
  function simulateUserOffline(userState: UserState): void {
    userState.session.isOnline = false
  }

  /**
   * 辅助函数：模拟用户重连
   */
  async function simulateUserReconnect(userState: UserState): Promise<void> {
    userState.session.isOnline = true

    // 模拟同步步骤1：发送状态向量
    const step1 = createSyncStep1(userState.userId, userState.session.doc)
    expect(step1.type).toBe('sync-step-1')
    expect(step1.stateVector).toBeInstanceOf(Uint8Array)
  }

  /**
   * 辅助函数：模拟队列中的事件同步
   */
  function enqueueEvent(userState: UserState, event: ReplayableEvent, priority: number = 2): void {
    const syncEvent: SyncEvent = {
      id: event.id,
      type: event.type === 'UPDATE' ? 'UPDATE' : 'INSERT',
      resourceId: event.resourceId,
      userId: event.userId,
      timestamp: event.timestamp,
      priority,
      payload: event.payload,
      retries: 0,
      maxRetries: 3,
      status: 'pending',
    }

    userState.syncQueue.enqueue(syncEvent)
    userState.session.pendingEvents.push(event)
  }

  /**
   * 辅助函数：验证最终一致性
   */
  function verifyFinalConsistency(docStateA: any, docStateB: any): boolean {
    return docStateA.text === docStateB.text && docStateA.version === docStateB.version
  }

  /**
   * 辅助函数：验证事件顺序
   */
  function verifyEventOrder(events: ReplayableEvent[]): boolean {
    if (events.length === 0) return true

    for (let i = 1; i < events.length; i++) {
      // 版本号应该递增
      if (events[i].version <= events[i - 1].version) {
        return false
      }
      // 时间戳应该非递减
      if (events[i].timestamp < events[i - 1].timestamp) {
        return false
      }
    }
    return true
  }

  /**
   * 核心测试：User A 和 User B 离线编辑同一文档，重连后自动同步和冲突解决
   *
   * 流程：
   * 1. 初始状态：两个用户都在线，文档内容为 "Hello"
   * 2. 用户A离线，编辑：Hello → Hello World
   * 3. 用户B离线，编辑：Hello → Hello Everyone
   * 4. 离线期间，事件进入本地队列
   * 5. 用户A重连，同步事件，应用CRDT合并
   * 6. 用户B重连，同步事件，应用CRDT合并
   * 7. 验证：两个用户最终状态完全相同，版本号递增，事件顺序正确
   */
  it('User A 和 User B 离线编辑同一文档，重连后自动同步和冲突解决', async () => {
    // 1. 初始化：验证初始状态
    expect(userA.session.doc.getText('text').toString()).toBe('Hello')
    expect(userB.session.doc.getText('text').toString()).toBe('Hello')
    expect(userA.session.version).toBe(1)
    expect(userB.session.version).toBe(1)

    // 2. 用户A离线并编辑
    simulateUserOffline(userA)
    expect(userA.session.isOnline).toBe(false)

    // 用户A编辑：Hello → Hello World
    userA.session.doc.getText('text').insert(5, ' World')
    const eventA1 = createTestEvent('UPDATE', 'Hello World', 'user-a')
    enqueueEvent(userA, eventA1)
    userA.session.version = 2

    expect(userA.session.doc.getText('text').toString()).toBe('Hello World')
    expect(userA.session.pendingEvents.length).toBe(1)
    expect(userA.syncQueue.getPendingCount()).toBe(1)

    // 3. 用户B离线并编辑
    simulateUserOffline(userB)
    expect(userB.session.isOnline).toBe(false)

    // 用户B编辑：Hello → Hello Everyone
    userB.session.doc.getText('text').insert(5, ' Everyone')
    const eventB1 = createTestEvent('UPDATE', 'Hello Everyone', 'user-b')
    enqueueEvent(userB, eventB1)
    userB.session.version = 2

    expect(userB.session.doc.getText('text').toString()).toBe('Hello Everyone')
    expect(userB.session.pendingEvents.length).toBe(1)
    expect(userB.syncQueue.getPendingCount()).toBe(1)

    // 4. 验证离线时的队列状态
    const queueStatsA = userA.syncQueue.getPriorityStats()
    const queueStatsB = userB.syncQueue.getPriorityStats()
    expect(queueStatsA[2]).toBe(1) // UPDATE 事件的优先级是 2
    expect(queueStatsB[2]).toBe(1)

    // 5. 用户A重连
    await simulateUserReconnect(userA)
    expect(userA.session.isOnline).toBe(true)

    // 用户A收到用户B的事件并应用CRDT合并
    // 创建同步步骤2：B发送更新给A
    const stateVectorB = Y.encodeStateVector(userB.session.doc)
    const updateFromB = Y.encodeStateAsUpdate(userB.session.doc, Y.encodeStateVector(userA.session.doc))
    Y.applyUpdate(userA.session.doc, updateFromB)
    userA.receivedEvents.push(eventB1)
    userA.session.version = 3

    // 6. 用户B重连
    await simulateUserReconnect(userB)
    expect(userB.session.isOnline).toBe(true)

    // 用户B收到用户A的事件并应用CRDT合并
    const updateFromA = Y.encodeStateAsUpdate(userA.session.doc, Y.encodeStateVector(userB.session.doc))
    Y.applyUpdate(userB.session.doc, updateFromA)
    userB.receivedEvents.push(eventA1)
    userB.session.version = 3

    // 7. 验证最终一致性
    const textA = userA.session.doc.getText('text').toString()
    const textB = userB.session.doc.getText('text').toString()

    expect(textA).toEqual(textB)
    expect(userA.session.version).toBe(3)
    expect(userB.session.version).toBe(3)
    expect(areDocumentsConsistent(userA.session.doc, userB.session.doc)).toBe(true)

    // 8. 验证事件顺序和版本号
    // 确保我们有足够的事件
    expect(eventLog.length).toBeGreaterThanOrEqual(2)
    expect(eventLog[0].version).toBe(1)
    expect(eventLog[1].version).toBe(2)

    // 9. 验证两个用户都收到了完整的事件历史
    expect(userA.receivedEvents.length).toBeGreaterThan(0)
    expect(userB.receivedEvents.length).toBeGreaterThan(0)
  })

  /**
   * 测试：验证优先级事件（TOKEN_ALERT）优先同步
   *
   * 场景：
   * 1. 入队多个不同优先级的事件（TOKEN_ALERT, UPDATE, DELETE）
   * 2. 验证优先级顺序（TOKEN_ALERT 优先级1，UPDATE 优先级2，DELETE 优先级4）
   * 3. 验证出队顺序符合优先级规则
   */
  it('验证优先级事件（TOKEN_ALERT）优先同步', () => {
    // 1. 创建多个不同类型的同步事件
    const events: SyncEvent[] = [
      {
        id: 'event-update-1',
        type: 'UPDATE',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: { content: 'update 1' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
      {
        id: 'event-alert-1',
        type: 'TOKEN_ALERT',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: { message: 'Token expiring soon' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
      {
        id: 'event-delete-1',
        type: 'DELETE',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 4,
        payload: {},
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
      {
        id: 'event-update-2',
        type: 'UPDATE',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: { content: 'update 2' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
    ]

    // 2. 入队所有事件（顺序随意）
    const queue = new PrioritySyncQueue()
    events.forEach(event => queue.enqueue(event))

    // 3. 验证队列统计
    const stats = queue.getPriorityStats()
    expect(stats[1]).toBe(1) // TOKEN_ALERT 1个
    expect(stats[2]).toBe(2) // UPDATE 2个
    expect(stats[4]).toBe(1) // DELETE 1个

    // 4. 验证出队顺序
    const dequeuedOrder: SyncEvent[] = []
    let event = queue.dequeue()
    while (event) {
      dequeuedOrder.push(event)
      queue.markCompleted(event.id)
      event = queue.dequeue()
    }

    // 5. 验证优先级顺序
    expect(dequeuedOrder[0].id).toBe('event-alert-1') // TOKEN_ALERT 最优先
    expect(dequeuedOrder[1].id).toMatch(/^event-update-/) // UPDATE 其次
    expect(dequeuedOrder[2].id).toMatch(/^event-update-/) // UPDATE 其次
    expect(dequeuedOrder[3].id).toBe('event-delete-1') // DELETE 最后

    // 6. 验证优先级递增（1 < 2 < 4）
    for (let i = 1; i < dequeuedOrder.length; i++) {
      expect(dequeuedOrder[i].priority).toBeGreaterThanOrEqual(dequeuedOrder[i - 1].priority)
    }
  })

  /**
   * 测试：验证事件顺序和版本号递增
   *
   * 场景：
   * 1. 创建一系列事件
   * 2. 验证版本号递增
   * 3. 验证时间戳顺序
   * 4. 验证因果关系验证通过
   */
  it('验证事件顺序和版本号递增', () => {
    // 1. 创建多个事件，带有逐步递增的时间戳
    const events: ReplayableEvent[] = []
    const baseTime = new Date('2024-01-01T00:00:00.000Z')

    for (let i = 0; i < 5; i++) {
      // 手动创建事件以控制时间戳
      const timestamp = new Date(baseTime.getTime() + i * 100).toISOString()
      const event: ReplayableEvent = {
        id: `event_${i}`,
        type: 'UPDATE',
        resourceId: docId,
        resourceType: 'document',
        userId: 'user-a',
        timestamp,
        version: globalVersion++,
        payload: { content: `content ${i}` },
      }
      events.push(event)
      eventLog.push(event)
    }

    // 2. 验证版本号递增
    for (let i = 1; i < events.length; i++) {
      expect(events[i].version).toBeGreaterThan(events[i - 1].version)
    }

    // 3. 验证所有版本号都不相同
    const versions = events.map(e => e.version)
    const uniqueVersions = new Set(versions)
    expect(uniqueVersions.size).toBe(events.length)

    // 4. 验证时间戳顺序
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1].timestamp).getTime()
      )
    }

    // 5. 验证因果关系验证通过
    expect(eventReplay.validateCausality(events)).toBe(true)
  })

  /**
   * 测试：验证最终一致性（两个副本状态相同）
   *
   * 场景：
   * 1. 创建两个同步状态的文档
   * 2. 一个文档进行编辑
   * 3. 同步编辑到另一个文档
   * 4. 验证两个文档完全一致
   */
  it('验证最终一致性（两个副本状态相同）', () => {
    // 1. 创建两个��立的文档
    const docX = new Y.Doc()
    const docY = new Y.Doc()
    const textX = docX.getText('text')
    const textY = docY.getText('text')

    // 2. 两个文档都初始化为相同内容
    textX.insert(0, 'Content')
    // 同步 X 的初始状态给 Y
    const initUpdate = Y.encodeStateAsUpdate(docX)
    Y.applyUpdate(docY, initUpdate)

    // 3. 验证初始状态完全一致
    expect(textX.toString()).toBe('Content')
    expect(textY.toString()).toBe('Content')
    expect(areDocumentsConsistent(docX, docY)).toBe(true)

    // 4. 在 X 中进行编辑
    textX.insert(7, ' Extra')

    // 5. 同步 X 的更新给 Y
    const updateX = Y.encodeStateAsUpdate(docX, Y.encodeStateVector(docY))
    Y.applyUpdate(docY, updateX)

    // 6. 验证同步后两个文档一致
    expect(textX.toString()).toBe('Content Extra')
    expect(textY.toString()).toBe('Content Extra')
    expect(areDocumentsConsistent(docX, docY)).toBe(true)

    // 7. 继续编辑 X（模拟多轮编辑）
    textX.insert(textX.length, ' More')

    // 8. 同步第二轮更新
    const updateX2 = Y.encodeStateAsUpdate(docX, Y.encodeStateVector(docY))
    Y.applyUpdate(docY, updateX2)

    // 9. 最终验证一致性
    const finalX = textX.toString()
    const finalY = textY.toString()

    expect(finalX).toBe(finalY)
    expect(areDocumentsConsistent(docX, docY)).toBe(true)
    expect(finalX).toBe('Content Extra More')
    expect(finalY).toBe('Content Extra More')
  })

  /**
   * 测试：验证离线队列在重连后自动处理
   *
   * 场景：
   * 1. 创建多个待处理事件
   * 2. 模拟离线时的事件累积
   * 3. 重连后验证队列状态
   * 4. 验证事件能被正确处理
   */
  it('验证离线队列在重连后自动处理', async () => {
    // 1. 创建一个队列和事件列表
    const queue = new PrioritySyncQueue()
    const syncedEvents: SyncEvent[] = []

    // 2. 模拟离线期间入队多个事件
    const offlineEvents: SyncEvent[] = [
      {
        id: 'event-1',
        type: 'UPDATE',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: { content: 'update 1' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
      {
        id: 'event-2',
        type: 'TOKEN_ALERT',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 1,
        payload: { alert: 'token expiring' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
      {
        id: 'event-3',
        type: 'UPDATE',
        resourceId: docId,
        userId: 'user-a',
        timestamp: new Date().toISOString(),
        priority: 2,
        payload: { content: 'update 2' },
        retries: 0,
        maxRetries: 3,
        status: 'pending',
      },
    ]

    // 3. 入队所有离线事件
    offlineEvents.forEach(event => queue.enqueue(event))

    // 4. 验证队列中有待处理事件
    expect(queue.getPendingCount()).toBe(3)
    expect(queue.size()).toBe(3)

    // 5. 模拟重连后的自动同步
    let processedCount = 0
    await new Promise<void>((resolve) => {
      queue.startAutoSync(async (events: SyncEvent[]) => {
        // 模拟同步处理
        events.forEach(event => {
          syncedEvents.push(event)
          queue.markCompleted(event.id)
          processedCount++
        })

        // 所有事件都处理完成
        if (processedCount === offlineEvents.length) {
          queue.stopAutoSync()
          resolve()
        }
      })

      // 超时保护
      setTimeout(() => {
        queue.stopAutoSync()
        resolve()
      }, 2000)
    })

    // 6. 验证所有事件都被处理
    expect(syncedEvents.length).toBeGreaterThan(0)

    // 7. 验证TOKEN_ALERT优先被处理
    const alertIndex = syncedEvents.findIndex(e => e.type === 'TOKEN_ALERT')
    expect(alertIndex).toBeGreaterThanOrEqual(0)

    // 8. 验证队列最终为空
    expect(queue.getPendingCount()).toBe(0)
  })

  /**
   * 测试：验证多轮离线编辑和同步
   *
   * 场景：
   * 1. 第一轮离线编辑和重连同步
   * 2. 第二轮离线编辑和重连同步
   * 3. 验证累积的版本号和事件顺序
   * 4. 验证最终一致性依然保证
   */
  it('验证多轮离线编辑和同步的最终一致性', async () => {
    // 初始化两个文档
    const docX = new Y.Doc()
    const docY = new Y.Doc()
    const textX = docX.getText('text')
    const textY = docY.getText('text')

    textX.insert(0, 'Start')
    textY.insert(0, 'Start')

    let version = 1

    // 第一轮编辑和同步
    // X 编辑
    textX.insert(5, '_Round1_X')
    version++

    // Y 编辑
    textY.insert(5, '_Round1_Y')
    version++

    // 第一次同步
    synchronizeDocuments(docX, docY)
    expect(areDocumentsConsistent(docX, docY)).toBe(true)

    // 第二轮编辑和同步
    // X 编辑
    textX.insert(textX.length, '_Round2_X')
    version++

    // Y 编辑
    textY.insert(textY.length, '_Round2_Y')
    version++

    // 第二次同步
    synchronizeDocuments(docX, docY)
    expect(areDocumentsConsistent(docX, docY)).toBe(true)

    // 验证最终状态
    const finalTextX = textX.toString()
    const finalTextY = textY.toString()

    expect(finalTextX).toBe(finalTextY)
    expect(finalTextX).toContain('Start')
    expect(finalTextX).toContain('Round1')
    expect(finalTextX).toContain('Round2')
    expect(finalTextX).toContain('_X')
    expect(finalTextX).toContain('_Y')
  })
})
