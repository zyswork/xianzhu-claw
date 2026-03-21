import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { YjsManager } from '../src/crdt/yjs-manager'
import {
  createSyncStep1,
  createSyncStep2,
  applySyncMessage,
  synchronizeDocuments,
  areDocumentsConsistent,
  getDocumentSnapshot,
} from '../src/crdt/sync'
import { CrdtService } from '../src/services/crdt.service'

describe('CRDT Yjs 集成与同步测试', () => {
  let manager: YjsManager
  let service: CrdtService

  beforeEach(() => {
    manager = new YjsManager()
    service = new CrdtService()
  })

  afterEach(() => {
    manager.clear()
    service.clear()
  })

  describe('YjsManager 基础功能', () => {
    it('应该创建新的 Yjs 文档', () => {
      const doc = manager.createDocument('test-doc-1')

      expect(doc.id).toBe('test-doc-1')
      expect(doc.doc).toBeDefined()
      expect(doc.text).toBeDefined()
      expect(doc.map).toBeDefined()
      expect(doc.version).toBe(0)
    })

    it('应该获取已存在的文档', () => {
      manager.createDocument('test-doc-2')
      const retrieved = manager.getDocument('test-doc-2')

      expect(retrieved).toBeDefined()
      expect(retrieved?.id).toBe('test-doc-2')
    })

    it('应该删除文档', () => {
      manager.createDocument('test-doc-3')
      manager.deleteDocument('test-doc-3')
      const retrieved = manager.getDocument('test-doc-3')

      expect(retrieved).toBeNull()
    })

    it('应该获取文档的状态向量', () => {
      const doc = manager.createDocument('test-doc-4')
      doc.text.insert(0, 'hello')

      const stateVector = manager.getStateVector('test-doc-4')
      expect(stateVector).toBeInstanceOf(Uint8Array)
      expect(stateVector.length).toBeGreaterThan(0)
    })

    it('应该获取文档的完整状态', () => {
      const doc = manager.createDocument('test-doc-5')
      doc.text.insert(0, 'world')

      const state = manager.getDocumentState('test-doc-5')
      expect(state).toBeInstanceOf(Uint8Array)
      expect(state.length).toBeGreaterThan(0)
    })
  })

  describe('基础编辑测试', () => {
    it('应该能够在文档中插入文本', () => {
      const doc = manager.createDocument('edit-test-1')
      doc.text.insert(0, 'hello')

      expect(doc.text.toString()).toBe('hello')
    })

    it('应该能够删除文本', () => {
      const doc = manager.createDocument('edit-test-2')
      doc.text.insert(0, 'hello world')
      doc.text.delete(6, 5)

      expect(doc.text.toString()).toBe('hello ')
    })

    it('应该能够在中间插入文本', () => {
      const doc = manager.createDocument('edit-test-3')
      doc.text.insert(0, 'hello world')
      doc.text.insert(5, ' beautiful')

      expect(doc.text.toString()).toBe('hello beautiful world')
    })

    it('应该能够多次编辑文档', () => {
      const doc = manager.createDocument('edit-test-4')
      doc.text.insert(0, 'a')
      doc.text.insert(1, 'b')
      doc.text.insert(2, 'c')
      doc.text.insert(3, 'd')

      expect(doc.text.toString()).toBe('abcd')
    })
  })

  describe('同步步骤 1 & 2 测试', () => {
    it('应该创建 sync-step-1 消息', () => {
      const doc = manager.createDocument('sync-test-1')
      doc.text.insert(0, 'test')

      const message = createSyncStep1('client-1', doc.doc)

      expect(message.type).toBe('sync-step-1')
      expect(message.step).toBe(1)
      expect(message.clientID).toBe('client-1')
      expect(message.stateVector).toBeInstanceOf(Uint8Array)
      expect(message.update).toBeUndefined()
    })

    it('应该创建 sync-step-2 消息', () => {
      const doc = manager.createDocument('sync-test-2')
      doc.text.insert(0, 'hello')

      const stateVector = Y.encodeStateVector(doc.doc)
      const message = createSyncStep2('client-2', stateVector, doc.doc)

      expect(message.type).toBe('sync-step-2')
      expect(message.step).toBe(2)
      expect(message.clientID).toBe('client-2')
      expect(message.stateVector).toBeDefined()
      expect(message.update).toBeDefined()
    })

    it('应该应用同步消息到文档', () => {
      const doc1 = manager.createDocument('sync-test-3')
      const doc2 = new Y.Doc()

      // Doc1 编辑
      doc1.text.insert(0, 'initial')

      // 获取 doc1 的状态向量和更新
      const stateVector1 = Y.encodeStateVector(doc2)
      const update = Y.encodeStateAsUpdate(doc1.doc, stateVector1)

      // 应用到 doc2
      const syncMessage = {
        type: 'sync-step-2' as const,
        clientID: 'client-1',
        stateVector: stateVector1,
        update,
      }

      applySyncMessage(syncMessage, doc2)

      // 验证 doc2 收到了更新
      expect(doc2.getText('text').toString()).toBe('initial')

      doc2.destroy()
    })
  })

  describe('并发编辑 - 不同位置', () => {
    it('应该正确合并两个客户端在不同位置的编辑', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      // 初始化
      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')
      text1.insert(0, 'ab')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // Client 1 在开头插入
      text1.insert(0, 'x')

      // Client 2 在结尾插入
      text2.insert(2, 'y')

      // 同步
      synchronizeDocuments(doc1, doc2)

      // 验证最终一致性
      const result1 = text1.toString()
      const result2 = text2.toString()

      expect(result1).toBe(result2)
      expect(['xaby', 'xaby']).toContain(result1)

      doc1.destroy()
      doc2.destroy()
    })

    it('并发编辑不同位置后两个副本应该一致', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      text1.insert(0, '12345')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // Client 1 在位置 0 插入 'A'
      text1.insert(0, 'A')

      // Client 2 在位置 5 插入 'B'
      text2.insert(5, 'B')

      // 同步
      synchronizeDocuments(doc1, doc2)

      // 验证一致性
      expect(areDocumentsConsistent(doc1, doc2)).toBe(true)
      expect(text1.toString()).toBe(text2.toString())

      doc1.destroy()
      doc2.destroy()
    })
  })

  describe('并发编辑 - 同一位置', () => {
    it('应该根据因果顺序解决同一位置的并发编辑冲突', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      // 初始化
      text1.insert(0, 'ab')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // 两个客户端都在位置 0 插入（但时间顺序不同）
      // Client 1 (client ID 会小于 Client 2)
      text1.insert(0, 'x')

      // Client 2
      text2.insert(0, 'y')

      // 同步两个文档
      synchronizeDocuments(doc1, doc2)

      // 验证最终一致
      expect(text1.toString()).toBe(text2.toString())
      // Yjs 使用因果顺序保证确定性结果
      expect(text1.toString().length).toBe(4) // 'ab' + 'x' + 'y'

      doc1.destroy()
      doc2.destroy()
    })

    it('同位置并发编辑多次应该保证最终一致', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      text1.insert(0, 'hello')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // 多次并发编辑
      for (let i = 0; i < 3; i++) {
        text1.insert(0, 'a')
        text2.insert(0, 'b')
      }

      synchronizeDocuments(doc1, doc2)

      // 验证一致性
      expect(areDocumentsConsistent(doc1, doc2)).toBe(true)
      expect(text1.toString()).toBe(text2.toString())
      expect(text1.toString().length).toBe(11) // 5 + 3 + 3

      doc1.destroy()
      doc2.destroy()
    })
  })

  describe('状态同步与一致性', () => {
    it('应该验证两个文档的一致性', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      text1.insert(0, 'test')

      // 应用 doc1 的状态到 doc2
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      expect(areDocumentsConsistent(doc1, doc2)).toBe(true)

      doc1.destroy()
      doc2.destroy()
    })

    it('不同步的文档应该不一致', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      text1.insert(0, 'doc1')
      text2.insert(0, 'doc2')

      expect(areDocumentsConsistent(doc1, doc2)).toBe(false)

      doc1.destroy()
      doc2.destroy()
    })

    it('应该获取文档的快照', () => {
      const doc = new Y.Doc()
      const text = doc.getText('text')
      text.insert(0, 'snapshot')

      const snapshot = getDocumentSnapshot(doc)

      expect(snapshot.text).toBe('snapshot')
      expect(snapshot.version).toBeGreaterThanOrEqual(0)

      doc.destroy()
    })
  })

  describe('CrdtService 集成测试', () => {
    it('应该初始化文档', () => {
      const doc = service.initializeDocument('service-test-1', 'initial content')

      expect(doc.id).toBe('service-test-1')
      expect(doc.text.toString()).toBe('initial content')
    })

    it('应该获取文档文本', () => {
      service.initializeDocument('service-test-2', 'hello')
      const text = service.getDocumentText('service-test-2')

      expect(text).toBe('hello')
    })

    it('应该添加文本到文档', () => {
      service.initializeDocument('service-test-3', 'hello')
      service.addText('service-test-3', ' world')

      expect(service.getDocumentText('service-test-3')).toBe('hello world')
    })

    it('应该删除文档中的文本', () => {
      service.initializeDocument('service-test-4', 'hello world')
      service.deleteText('service-test-4', 5, 6)

      expect(service.getDocumentText('service-test-4')).toBe('hello')
    })

    it('应该获取编辑历史', () => {
      service.initializeDocument('service-test-5', '')
      service.addText('service-test-5', 'a')
      service.addText('service-test-5', 'b')

      const history = service.getEditHistory('service-test-5')

      expect(history.length).toBeGreaterThan(0)
      expect(history[history.length - 1].content).toBe('ab')
    })

    it('应该删除文档', () => {
      service.initializeDocument('service-test-6')
      service.deleteDocument('service-test-6')

      const doc = service.getDocument('service-test-6')
      expect(doc).toBeNull()
    })

    it('应该获取文档快照', () => {
      service.initializeDocument('service-test-7', 'snapshot')
      const snapshot = service.getSnapshot('service-test-7')

      expect(snapshot.text).toBe('snapshot')
      expect(snapshot.version).toBeGreaterThanOrEqual(0)
    })
  })

  describe('CrdtService 并发编辑测试', () => {
    it('应该处理两个客户端的并发编辑', () => {
      service.initializeDocument('concurrent-test-1', 'ab')

      const result = service.concurrentEdit(
        'concurrent-test-1',
        (text: Y.Text) => {
          // Client 1 在开头插入
          text.insert(0, 'x')
        },
        (text: Y.Text) => {
          // Client 2 在结尾插入
          text.insert(2, 'y')
        }
      )

      // 同步后，doc1 和 doc2 应该一致
      expect(result.isConsistent).toBe(true)
      // mergedState 应该包含两个编辑的内容
      expect(result.mergedState.includes('x')).toBe(true)
      expect(result.mergedState.includes('y')).toBe(true)
      expect(result.mergedState.includes('ab')).toBe(true)
    })

    it('并发编辑相同位置应该保证最终一致', () => {
      service.initializeDocument('concurrent-test-2', 'hello')

      const result = service.concurrentEdit(
        'concurrent-test-2',
        (text: Y.Text) => {
          text.insert(0, 'A')
        },
        (text: Y.Text) => {
          text.insert(0, 'B')
        }
      )

      expect(result.isConsistent).toBe(true)
      expect(result.mergedState.includes('A')).toBe(true)
      expect(result.mergedState.includes('B')).toBe(true)
    })

    it('应该验证一致性', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      text1.insert(0, 'test')

      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      expect(service.verifyConsistency(doc1, doc2)).toBe(true)

      doc1.destroy()
      doc2.destroy()
    })

    it('多次并发编辑应该保证一致性', () => {
      service.initializeDocument('concurrent-test-3', '')

      const result = service.concurrentEdit(
        'concurrent-test-3',
        (text: Y.Text) => {
          for (let i = 0; i < 3; i++) {
            text.insert(i, 'a')
          }
        },
        (text: Y.Text) => {
          for (let i = 0; i < 3; i++) {
            text.insert(i, 'b')
          }
        }
      )

      expect(result.isConsistent).toBe(true)
      expect(result.mergedState.length).toBe(6)
    })
  })

  describe('复杂场景测试', () => {
    it('应该处理复杂的混合编辑场景', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      // 初始化
      text1.insert(0, 'hello')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // 阶段 1: 并发编辑
      text1.insert(5, ' world')
      text2.insert(0, 'say ')

      synchronizeDocuments(doc1, doc2)

      // 验证一致
      expect(areDocumentsConsistent(doc1, doc2)).toBe(true)

      // 阶段 2: 继续编辑
      text1.delete(0, 4)
      synchronizeDocuments(doc1, doc2)

      // 最终验证
      expect(text1.toString()).toBe(text2.toString())

      doc1.destroy()
      doc2.destroy()
    })

    it('应该处理大量并发更新', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      text1.insert(0, 'start')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // 大量并发更新
      for (let i = 0; i < 10; i++) {
        text1.insert(i, `a${i}`)
        text2.insert(i, `b${i}`)
      }

      synchronizeDocuments(doc1, doc2)

      // 验证一致性
      expect(areDocumentsConsistent(doc1, doc2)).toBe(true)

      doc1.destroy()
      doc2.destroy()
    })

    it('应该处理删除和插入的混合操作', () => {
      const doc1 = new Y.Doc()
      const doc2 = new Y.Doc()

      const text1 = doc1.getText('text')
      const text2 = doc2.getText('text')

      text1.insert(0, 'abcdef')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1))

      // Client 1 删除
      text1.delete(1, 2)

      // Client 2 插入
      text2.insert(3, 'xyz')

      synchronizeDocuments(doc1, doc2)

      // 验证一致
      expect(areDocumentsConsistent(doc1, doc2)).toBe(true)
      expect(text1.toString()).toBe(text2.toString())

      doc1.destroy()
      doc2.destroy()
    })
  })

  describe('应用更新测试', () => {
    it('应该应用编码的更新', () => {
      const doc1 = manager.createDocument('update-test-1')
      const doc2 = new Y.Doc()

      doc1.text.insert(0, 'hello')

      const update = manager.getDocumentState('update-test-1')

      Y.applyUpdate(doc2, update)

      expect(doc2.getText('text').toString()).toBe('hello')

      doc2.destroy()
    })

    it('应该处理增量更新', () => {
      const doc1 = manager.createDocument('update-test-2')
      const doc2 = new Y.Doc()

      doc1.text.insert(0, 'initial')
      Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1.doc))

      // 应用增量更新
      doc1.text.insert(7, ' update')
      const increment = manager.getStateVectorDiff('update-test-2', Y.encodeStateVector(doc2))
      Y.applyUpdate(doc2, increment)

      expect(doc2.getText('text').toString()).toBe('initial update')

      doc2.destroy()
    })
  })
})
