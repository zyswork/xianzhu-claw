import * as Y from 'yjs'
import * as lib0 from 'lib0'

/**
 * Yjs 文档接口
 * 表示一个共享的 CRDT 文档实例
 */
export interface YjsDocument {
  /** 文档的唯一标识符 */
  id: string
  /** Yjs Doc 实例 */
  doc: Y.Doc
  /** 文本类型（用于编辑文本内容） */
  text: Y.Text
  /** 映射类型（用于存储结构化数据） */
  map: Y.Map<unknown>
  /** 文档版本号 */
  version: number
}

/**
 * YjsManager 类
 * 管理 CRDT 文档的生命周期和状态编码/解码
 */
export class YjsManager {
  private documents: Map<string, YjsDocument> = new Map()

  /**
   * 创建新的 Yjs 文档
   * @param id 文档的唯一标识符
   * @returns 创建的文档对象
   */
  createDocument(id: string): YjsDocument {
    if (this.documents.has(id)) {
      return this.documents.get(id)!
    }

    const doc = new Y.Doc()
    const text = doc.getText('text')
    const map = doc.getMap('map')

    const yDoc: YjsDocument = {
      id,
      doc,
      text,
      map,
      version: 0,
    }

    this.documents.set(id, yDoc)

    // 监听文档更新事件
    doc.on('update', (update: Uint8Array) => {
      const docRef = this.documents.get(id)
      if (docRef) {
        docRef.version += 1
      }
    })

    return yDoc
  }

  /**
   * 获取已存在的文档
   * @param id 文档的唯一标识符
   * @returns 文档对象或 null
   */
  getDocument(id: string): YjsDocument | null {
    return this.documents.get(id) || null
  }

  /**
   * 删除文档
   * @param id 文档的唯一标识符
   */
  deleteDocument(id: string): void {
    const doc = this.documents.get(id)
    if (doc) {
      doc.doc.destroy()
      this.documents.delete(id)
    }
  }

  /**
   * 获取文档的完整状态向量编码
   * 用于同步时表示文档的当前版本状态
   * @param id 文档的唯一标识符
   * @returns 编码后的状态向量（Uint8Array）
   */
  getDocumentState(id: string): Uint8Array {
    const doc = this.documents.get(id)
    if (!doc) {
      throw new Error(`Document with id ${id} not found`)
    }

    // 使用 Y.encodeStateAsUpdate 获取文档的完整状态
    return Y.encodeStateAsUpdate(doc.doc)
  }

  /**
   * 获取相对于特定状态向量的增量更新
   * 用于同步：只发送目标客户端还没有的部分
   * @param id 文档的唯一标识符
   * @param stateVector 其他客户端的状态向量
   * @returns 增量更新（Uint8Array）
   */
  getStateVectorDiff(id: string, stateVector: Uint8Array): Uint8Array {
    const doc = this.documents.get(id)
    if (!doc) {
      throw new Error(`Document with id ${id} not found`)
    }

    // 使用 Y.encodeStateAsUpdate 和 stateVector 生成差异更新
    return Y.encodeStateAsUpdate(doc.doc, stateVector)
  }

  /**
   * 获取文档的状态向量
   * 表示文档已应用的所有变更的版本信息
   * @param id 文档的唯一标识符
   * @returns 编码后的状态向量（Uint8Array）
   */
  getStateVector(id: string): Uint8Array {
    const doc = this.documents.get(id)
    if (!doc) {
      throw new Error(`Document with id ${id} not found`)
    }

    // 使用 Y.encodeStateVector 获取文档的状态向量
    return Y.encodeStateVector(doc.doc)
  }

  /**
   * 应用更新到文档
   * @param id 文档的唯一标识符
   * @param update 编码后的更新数据（Uint8Array）
   */
  applyUpdate(id: string, update: Uint8Array): void {
    const doc = this.documents.get(id)
    if (!doc) {
      throw new Error(`Document with id ${id} not found`)
    }

    Y.applyUpdate(doc.doc, update)
  }

  /**
   * 获取文档中文本内容
   * @param id 文档的唯一标识符
   * @returns 文本内容
   */
  getText(id: string): string {
    const doc = this.documents.get(id)
    if (!doc) {
      throw new Error(`Document with id ${id} not found`)
    }

    return doc.text.toString()
  }

  /**
   * 获取文档的映射数据
   * @param id 文档的唯一标识符
   * @returns 映射对象
   */
  getMapData(id: string): Record<string, unknown> {
    const doc = this.documents.get(id)
    if (!doc) {
      throw new Error(`Document with id ${id} not found`)
    }

    const result: Record<string, unknown> = {}
    doc.map.forEach((value, key) => {
      result[key] = value
    })

    return result
  }

  /**
   * 获取所有文档的 ID
   * @returns 文档 ID 的数组
   */
  getAllDocumentIds(): string[] {
    return Array.from(this.documents.keys())
  }

  /**
   * 清空所有文档
   */
  clear(): void {
    for (const [, doc] of this.documents) {
      doc.doc.destroy()
    }
    this.documents.clear()
  }
}
