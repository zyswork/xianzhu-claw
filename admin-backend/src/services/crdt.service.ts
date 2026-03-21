import * as Y from 'yjs'
import { YjsManager, YjsDocument } from '../crdt/yjs-manager'
import { synchronizeDocuments, areDocumentsConsistent, getDocumentSnapshot } from '../crdt/sync'

/**
 * 并发编辑的结果接口
 */
export interface ConcurrentEditResult {
  /** 客户端 1 的最终状态 */
  doc1State: string
  /** 客户端 2 的最终状态 */
  doc2State: string
  /** 合并后的状态 */
  mergedState: string
  /** 两个客户端是否一致 */
  isConsistent: boolean
}

/**
 * 编辑历史项
 */
export interface EditHistoryItem {
  /** 编辑的时间戳 */
  timestamp: number
  /** 编辑的内容 */
  content: string
  /** 编辑的版本号 */
  version: number
}

/**
 * CRDT 服务
 * 提供高级的 CRDT 文档管理功能
 */
export class CrdtService {
  private manager: YjsManager = new YjsManager()
  private editHistory: Map<string, EditHistoryItem[]> = new Map()

  /**
   * 初始化文档
   * @param id 文档 ID
   * @param content 初始内容（可选）
   */
  initializeDocument(id: string, content?: string): YjsDocument {
    const doc = this.manager.createDocument(id)

    if (content) {
      const text = doc.doc.getText('text')
      text.insert(0, content)
    }

    // 初始化编辑历史
    if (!this.editHistory.has(id)) {
      this.editHistory.set(id, [])
    }

    // 记录初始状态
    const initialHistory = this.editHistory.get(id)!
    initialHistory.push({
      timestamp: Date.now(),
      content: content || '',
      version: 0,
    })

    return doc
  }

  /**
   * 两个客户端并发编辑的模拟
   * 验证 CRDT 是否能正确处理并发编辑
   * @param docId 文档 ID
   * @param client1Edit 客户端 1 的编辑操作函数
   * @param client2Edit 客户端 2 的编辑操作函数
   * @returns 并发编辑的结果
   */
  concurrentEdit(
    docId: string,
    client1Edit: (text: Y.Text) => void,
    client2Edit: (text: Y.Text) => void
  ): ConcurrentEditResult {
    // 获取原始文档
    const originalDoc = this.manager.getDocument(docId)
    if (!originalDoc) {
      throw new Error(`Document ${docId} not found`)
    }

    // 创建两个独立的文档副本（模拟两个客户端）
    const doc1 = new Y.Doc()
    const doc2 = new Y.Doc()

    // 将原始文档的状态复制到两个副本
    const initialState = Y.encodeStateAsUpdate(originalDoc.doc)
    Y.applyUpdate(doc1, initialState)
    Y.applyUpdate(doc2, initialState)

    // 客户端 1 执行编辑
    const text1 = doc1.getText('text')
    client1Edit(text1)

    // 客户端 2 执行编辑
    const text2 = doc2.getText('text')
    client2Edit(text2)

    // 获取两个客户端编辑后的状态
    const doc1State = text1.toString()
    const doc2State = text2.toString()

    // 同步两个文档
    synchronizeDocuments(doc1, doc2)

    // 同步后的状态
    const mergedState = text1.toString()

    // 验证一致性
    const isConsistent = areDocumentsConsistent(doc1, doc2)

    // 记录编辑历史
    const history = this.editHistory.get(docId)
    if (history) {
      history.push({
        timestamp: Date.now(),
        content: mergedState,
        version: originalDoc.version + 2,
      })
    }

    // 清理文档
    doc1.destroy()
    doc2.destroy()

    return {
      doc1State,
      doc2State,
      mergedState,
      isConsistent,
    }
  }

  /**
   * 验证两个文档的一致性
   * @param doc1 文档 1
   * @param doc2 文档 2
   * @returns 如果两个文档一致返回 true
   */
  verifyConsistency(doc1: Y.Doc, doc2: Y.Doc): boolean {
    return areDocumentsConsistent(doc1, doc2)
  }

  /**
   * 获取文档的编辑历史
   * @param docId 文档 ID
   * @returns 编辑历史数组
   */
  getEditHistory(docId: string): EditHistoryItem[] {
    return this.editHistory.get(docId) || []
  }

  /**
   * 获取特定文档
   * @param docId 文档 ID
   * @returns Yjs 文档或 null
   */
  getDocument(docId: string): YjsDocument | null {
    return this.manager.getDocument(docId)
  }

  /**
   * 删除文档
   * @param docId 文档 ID
   */
  deleteDocument(docId: string): void {
    this.manager.deleteDocument(docId)
    this.editHistory.delete(docId)
  }

  /**
   * 获取文档的文本内容
   * @param docId 文档 ID
   * @returns 文本内容
   */
  getDocumentText(docId: string): string {
    return this.manager.getText(docId)
  }

  /**
   * 向文档添加文本
   * @param docId 文档 ID
   * @param text 要添加的文本
   * @param position 插入位置（默认在末尾）
   */
  addText(docId: string, text: string, position?: number): void {
    const doc = this.manager.getDocument(docId)
    if (!doc) {
      throw new Error(`Document ${docId} not found`)
    }

    const ytext = doc.text
    const insertPos = position !== undefined ? position : ytext.length

    ytext.insert(insertPos, text)

    // 记录编辑历史
    const history = this.editHistory.get(docId)
    if (history) {
      history.push({
        timestamp: Date.now(),
        content: ytext.toString(),
        version: doc.version,
      })
    }
  }

  /**
   * 删除文档中的文本
   * @param docId 文档 ID
   * @param position 删除的起始位置
   * @param length 删除的长度
   */
  deleteText(docId: string, position: number, length: number): void {
    const doc = this.manager.getDocument(docId)
    if (!doc) {
      throw new Error(`Document ${docId} not found`)
    }

    const ytext = doc.text
    ytext.delete(position, length)

    // 记录编辑历史
    const history = this.editHistory.get(docId)
    if (history) {
      history.push({
        timestamp: Date.now(),
        content: ytext.toString(),
        version: doc.version,
      })
    }
  }

  /**
   * 获取文档的快照
   * @param docId 文档 ID
   * @returns 文档快照（包含文本和版本号）
   */
  getSnapshot(docId: string): { text: string; version: number } {
    const doc = this.manager.getDocument(docId)
    if (!doc) {
      throw new Error(`Document ${docId} not found`)
    }

    return getDocumentSnapshot(doc.doc)
  }

  /**
   * 清空所有文档和历史
   */
  clear(): void {
    this.manager.clear()
    this.editHistory.clear()
  }
}
