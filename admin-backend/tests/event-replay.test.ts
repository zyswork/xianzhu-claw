/**
 * 事件回放引擎测试
 *
 * 测试场景：
 * - 基本事件回放：CREATE → UPDATE → UPDATE
 * - 时间旅行：重建中间时间点的状态
 * - DELETE 处理：CREATE → UPDATE → DELETE
 * - EXECUTE 操作：验证操作被正确执行
 * - 因果关系验证：版本号和时间戳顺序
 * - 编辑历史：完整事件链
 * - 版本间差异：两个版本之间的变更
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../src/db/index'
import { EventReplayService } from '../src/services/event-replay.service'
import { v4 as uuidv4 } from 'uuid'

describe('事件回放引擎 (Event Replay Service)', () => {
  let eventReplayService: EventReplayService
  let documentId: string
  let userId: string
  let enterpriseId: string

  beforeEach(() => {
    eventReplayService = new EventReplayService(db)

    // 创建测试数据
    enterpriseId = `enterprise_${uuidv4()}`
    userId = `user_${uuidv4()}`
    documentId = `doc_${uuidv4()}`

    // 创建企业和用户
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

    db.createUser({
      id: userId,
      enterpriseId,
      email: `test_${uuidv4()}@example.com`,
      name: '测试用户',
      role: 'user',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  afterEach(() => {
    // 清理测试数据
    db.clearCache('all')
  })

  describe('基本事件回放', () => {
    it('应该能够回放 CREATE 事件并重建资源状态', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()

      // 记录 CREATE 事件
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '测试文档',
          content: '初始内容',
          status: 'draft',
        },
      })

      // 回放到当前状态
      const state = eventReplayService.replayToPresent(documentId, 'document')

      expect(state).toBeDefined()
      expect(state.id).toBe(documentId)
      expect(state.title).toBe('测试文档')
      expect(state.content).toBe('初始内容')
      expect(state.status).toBe('draft')
      expect(state._version).toBe(1)
      expect(state._lastModified).toBe(createTime)
      expect(state._lastModifiedBy).toBe(userId)
    })

    it('应该能够处理 CREATE → UPDATE 事件序列', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime = new Date('2024-01-01T11:00:00Z').toISOString()

      // 记录 CREATE 事件
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '测试文档',
          content: '初始内容',
          status: 'draft',
        },
      })

      // 记录 UPDATE 事件
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime,
        version: 2,
        payload: {
          title: '更新的文档标题',
          content: '更新的内容',
        },
      })

      // 回放到当前状态
      const state = eventReplayService.replayToPresent(documentId, 'document')

      expect(state.title).toBe('更新的文档标题')
      expect(state.content).toBe('更新的内容')
      expect(state.status).toBe('draft') // 未改变的字段应该保留
      expect(state._version).toBe(2)
      expect(state._lastModified).toBe(updateTime)
    })

    it('应该能够处理多次 UPDATE 事件', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime1 = new Date('2024-01-01T11:00:00Z').toISOString()
      const updateTime2 = new Date('2024-01-01T12:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '初始标题',
          content: '初始内容',
          status: 'draft',
          viewCount: 0,
        },
      })

      // UPDATE 1
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime1,
        version: 2,
        payload: {
          title: '修改后的标题',
          viewCount: 10,
        },
      })

      // UPDATE 2
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime2,
        version: 3,
        payload: {
          status: 'published',
          viewCount: 25,
        },
      })

      const state = eventReplayService.replayToPresent(documentId, 'document')

      expect(state.title).toBe('修改后的标题')
      expect(state.content).toBe('初始内容')
      expect(state.status).toBe('published')
      expect(state.viewCount).toBe(25)
      expect(state._version).toBe(3)
    })
  })

  describe('时间旅行 (Time Travel)', () => {
    it('应该能够回放到中间时间点', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime1 = new Date('2024-01-01T11:00:00Z').toISOString()
      const updateTime2 = new Date('2024-01-01T12:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '初始标题',
          content: '初始内容',
          viewCount: 0,
        },
      })

      // UPDATE 1
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime1,
        version: 2,
        payload: {
          title: '修改后的标题',
          viewCount: 10,
        },
      })

      // UPDATE 2
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime2,
        version: 3,
        payload: {
          viewCount: 25,
        },
      })

      // 回放到 updateTime1（应该包含 CREATE 和第一次 UPDATE）
      const stateAt11 = eventReplayService.replayToTimestamp(
        documentId,
        'document',
        new Date('2024-01-01T11:30:00Z').toISOString()
      )

      expect(stateAt11.title).toBe('修改后的标题')
      expect(stateAt11.viewCount).toBe(10)
      expect(stateAt11._version).toBe(2)

      // 回放到 createTime 之后（只包含 CREATE）
      const stateAt10 = eventReplayService.replayToTimestamp(
        documentId,
        'document',
        new Date('2024-01-01T10:30:00Z').toISOString()
      )

      expect(stateAt10.title).toBe('初始标题')
      expect(stateAt10.viewCount).toBe(0)
      expect(stateAt10._version).toBe(1)

      // 回放到 createTime 之前（应该返回 null）
      const stateBeforeCreate = eventReplayService.replayToTimestamp(
        documentId,
        'document',
        new Date('2024-01-01T09:00:00Z').toISOString()
      )

      expect(stateBeforeCreate).toBeNull()
    })

    it('应该能够按版本号回放', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime1 = new Date('2024-01-01T11:00:00Z').toISOString()
      const updateTime2 = new Date('2024-01-01T12:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '初始标题',
          viewCount: 0,
        },
      })

      // UPDATE 1
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime1,
        version: 2,
        payload: {
          title: '修改后的标题',
          viewCount: 10,
        },
      })

      // UPDATE 2
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime2,
        version: 3,
        payload: {
          viewCount: 25,
        },
      })

      // 回放到版本 2
      const stateV2 = eventReplayService.replayToVersion(documentId, 'document', 2)
      expect(stateV2._version).toBe(2)
      expect(stateV2.title).toBe('修改后的标题')
      expect(stateV2.viewCount).toBe(10)

      // 回放到版本 1
      const stateV1 = eventReplayService.replayToVersion(documentId, 'document', 1)
      expect(stateV1._version).toBe(1)
      expect(stateV1.title).toBe('初始标题')
      expect(stateV1.viewCount).toBe(0)

      // 回放到版本 3
      const stateV3 = eventReplayService.replayToVersion(documentId, 'document', 3)
      expect(stateV3._version).toBe(3)
      expect(stateV3.viewCount).toBe(25)
    })
  })

  describe('DELETE 处理', () => {
    it('应该能够处理 CREATE → DELETE 事件', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const deleteTime = new Date('2024-01-01T11:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '测试文档',
        },
      })

      // DELETE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'DELETE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: deleteTime,
        version: 2,
        payload: {},
      })

      // 回放到当前状态（应该是 null）
      const state = eventReplayService.replayToPresent(documentId, 'document')
      expect(state).toBeNull()

      // 时间旅行到删除前（应该有状态）
      const stateBeforeDelete = eventReplayService.replayToTimestamp(
        documentId,
        'document',
        new Date('2024-01-01T10:30:00Z').toISOString()
      )
      expect(stateBeforeDelete).toBeDefined()
      expect(stateBeforeDelete.title).toBe('测试文档')
      expect(stateBeforeDelete._version).toBe(1)
    })

    it('应该能够处理 CREATE → UPDATE → DELETE 事件序列', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime = new Date('2024-01-01T11:00:00Z').toISOString()
      const deleteTime = new Date('2024-01-01T12:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '初始标题',
          content: '初始内容',
        },
      })

      // UPDATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime,
        version: 2,
        payload: {
          title: '更新的标题',
        },
      })

      // DELETE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'DELETE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: deleteTime,
        version: 3,
        payload: {},
      })

      // 当前状态：已删除
      expect(eventReplayService.replayToPresent(documentId, 'document')).toBeNull()

      // 版本 2：应该显示更新后的标题
      const stateV2 = eventReplayService.replayToVersion(documentId, 'document', 2)
      expect(stateV2.title).toBe('更新的标题')

      // 版本 1：应该显示初始标题
      const stateV1 = eventReplayService.replayToVersion(documentId, 'document', 1)
      expect(stateV1.title).toBe('初始标题')
    })
  })

  describe('EXECUTE 操作', () => {
    it('应该能够处理 EXECUTE 事件', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const executeTime = new Date('2024-01-01T11:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '测试文档',
          status: 'draft',
        },
      })

      // EXECUTE：发布操作
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'EXECUTE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: executeTime,
        version: 2,
        payload: {
          operation: 'publish',
          params: {
            status: 'published',
            publishedAt: executeTime,
          },
        },
      })

      const state = eventReplayService.replayToPresent(documentId, 'document')

      expect(state.status).toBe('published')
      expect(state.publishedAt).toBe(executeTime)
      expect(state._lastOperation).toBe('publish')
      expect(state._version).toBe(2)
    })
  })

  describe('因果关系验证', () => {
    it('应该验证事件因果关系 - 版本号递增', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime = new Date('2024-01-01T11:00:00Z').toISOString()

      const events = [
        {
          id: `event_${uuidv4()}`,
          type: 'CREATE' as const,
          resourceId: documentId,
          resourceType: 'document',
          userId,
          timestamp: createTime,
          version: 1,
          payload: { title: '标题 1' },
        },
        {
          id: `event_${uuidv4()}`,
          type: 'UPDATE' as const,
          resourceId: documentId,
          resourceType: 'document',
          userId,
          timestamp: updateTime,
          version: 2,
          payload: { title: '标题 2' },
        },
      ]

      // 正确的因果关系应该验证通过
      expect(eventReplayService.validateCausality(events)).toBe(true)

      // 版本号不递增应该失败
      const invalidEvents = [
        events[0],
        {
          ...events[1],
          version: 1, // 版本号不递增
        },
      ]

      expect(eventReplayService.validateCausality(invalidEvents)).toBe(false)
    })

    it('应该验证事件因果关系 - 时间戳顺序', () => {
      const time1 = new Date('2024-01-01T10:00:00Z').toISOString()
      const time2 = new Date('2024-01-01T11:00:00Z').toISOString()

      const events = [
        {
          id: `event_${uuidv4()}`,
          type: 'CREATE' as const,
          resourceId: documentId,
          resourceType: 'document',
          userId,
          timestamp: time1,
          version: 1,
          payload: { title: '标题 1' },
        },
        {
          id: `event_${uuidv4()}`,
          type: 'UPDATE' as const,
          resourceId: documentId,
          resourceType: 'document',
          userId,
          timestamp: time2,
          version: 2,
          payload: { title: '标题 2' },
        },
      ]

      // 正确的时间戳顺序应该验证通过
      expect(eventReplayService.validateCausality(events)).toBe(true)

      // 时间戳逆序应该失败
      const invalidEvents = [
        events[0],
        {
          ...events[1],
          timestamp: time1, // 时间戳不递增
        },
      ]

      expect(eventReplayService.validateCausality(invalidEvents)).toBe(false)
    })

    it('应该允许空事件列表', () => {
      expect(eventReplayService.validateCausality([])).toBe(true)
    })
  })

  describe('编辑历史', () => {
    it('应该返回完整的编辑历史', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime1 = new Date('2024-01-01T11:00:00Z').toISOString()
      const updateTime2 = new Date('2024-01-01T12:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: { title: '初始标题' },
      })

      // UPDATE 1
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime1,
        version: 2,
        payload: { title: '标题 2' },
      })

      // UPDATE 2
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime2,
        version: 3,
        payload: { title: '标题 3' },
      })

      const history = eventReplayService.getEditHistory(documentId, 'document')

      expect(history).toHaveLength(3)
      expect(history[0].type).toBe('CREATE')
      expect(history[0].version).toBe(1)
      expect(history[1].type).toBe('UPDATE')
      expect(history[1].version).toBe(2)
      expect(history[2].type).toBe('UPDATE')
      expect(history[2].version).toBe(3)

      // 验证事件顺序（应该按版本号排序）
      for (let i = 1; i < history.length; i++) {
        expect(history[i].version).toBeGreaterThan(history[i - 1].version)
      }
    })
  })

  describe('版本间差异', () => {
    it('应该计算两个版本之间的变更', () => {
      const createTime = new Date('2024-01-01T10:00:00Z').toISOString()
      const updateTime1 = new Date('2024-01-01T11:00:00Z').toISOString()
      const updateTime2 = new Date('2024-01-01T12:00:00Z').toISOString()

      // CREATE
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: createTime,
        version: 1,
        payload: {
          id: documentId,
          title: '初始标题',
          content: '初始内容',
          viewCount: 0,
        },
      })

      // UPDATE 1
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime1,
        version: 2,
        payload: {
          title: '修改后的标题',
          viewCount: 10,
        },
      })

      // UPDATE 2
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'UPDATE',
        resourceId: documentId,
        resourceType: 'document',
        userId,
        timestamp: updateTime2,
        version: 3,
        payload: {
          viewCount: 25,
        },
      })

      // 获取版本 1 到版本 3 的变更
      const changes = eventReplayService.getChangesBetweenVersions(documentId, 1, 3)

      expect(changes.v1).toBe(1)
      expect(changes.v2).toBe(3)

      // 检查状态变化
      expect(changes.stateBefore.title).toBe('初始标题')
      expect(changes.stateBefore.viewCount).toBe(0)

      expect(changes.stateAfter.title).toBe('修改后的标题')
      expect(changes.stateAfter.viewCount).toBe(25)

      // 检查事件列表（应该包含 v2 和 v3）
      expect(changes.events).toHaveLength(2)
      expect(changes.events[0].version).toBe(2)
      expect(changes.events[1].version).toBe(3)

      // 检查差异
      expect(changes.diff.modified.title).toBeDefined()
      expect(changes.diff.modified.title.from).toBe('初始标题')
      expect(changes.diff.modified.title.to).toBe('修改后的标题')
      expect(changes.diff.modified.viewCount.from).toBe(0)
      expect(changes.diff.modified.viewCount.to).toBe(25)
    })

    it('应该拒绝无效的版本范围', () => {
      expect(() => {
        eventReplayService.getChangesBetweenVersions(documentId, 2, 1)
      }).toThrow('v1 版本号必须小于 v2 版本号')

      expect(() => {
        eventReplayService.getChangesBetweenVersions(documentId, 1, 1)
      }).toThrow('v1 版本号必须小于 v2 版本号')
    })
  })

  describe('边界情况', () => {
    it('应该处理不存在的资源', () => {
      const nonexistentId = `doc_${uuidv4()}`
      const state = eventReplayService.replayToPresent(nonexistentId, 'document')
      expect(state).toBeNull()
    })

    it('应该处理多个资源的独立事件', () => {
      const doc1Id = `doc_${uuidv4()}`
      const doc2Id = `doc_${uuidv4()}`
      const time = new Date('2024-01-01T10:00:00Z').toISOString()

      // 创建文档 1
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: doc1Id,
        resourceType: 'document',
        userId,
        timestamp: time,
        version: 1,
        payload: { title: '文档 1' },
      })

      // 创建文档 2
      db.createEventLog({
        id: `event_${uuidv4()}`,
        type: 'CREATE',
        resourceId: doc2Id,
        resourceType: 'document',
        userId,
        timestamp: time,
        version: 1,
        payload: { title: '文档 2' },
      })

      // 验证两个资源的状态独立
      const state1 = eventReplayService.replayToPresent(doc1Id, 'document')
      const state2 = eventReplayService.replayToPresent(doc2Id, 'document')

      expect(state1.title).toBe('文档 1')
      expect(state2.title).toBe('文档 2')
    })
  })
})
