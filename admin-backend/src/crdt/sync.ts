import * as Y from 'yjs'

/**
 * 同步步骤接口
 * 表示 CRDT 同步过程中的一个消息
 */
export interface SyncStep {
  /** 同步步骤号 (1 或 2) */
  step: number
  /** 发送者的客户端 ID */
  clientID: string
  /** 状态向量 (表示已应用的版本) */
  stateVector: Uint8Array
  /** 增量更新 (仅在 step 2 中使用) */
  update?: Uint8Array
}

/**
 * 同步消息接口
 * 用于在客户端间传输同步信息
 */
export interface SyncMessage {
  /** 消息类型 */
  type: 'sync-step-1' | 'sync-step-2' | 'update'
  /** 同步步骤号 (可选) */
  step?: number
  /** 发送者的客户端 ID */
  clientID: string
  /** 状态向量 (可选) */
  stateVector?: Uint8Array
  /** 增量更新 (可选) */
  update?: Uint8Array
}

/**
 * 创建同步步骤 1 消息
 * 客户端 A 发送其状态向量给客户端 B，告诉 B "我已经有这些版本了"
 * @param clientID 发送者的客户端 ID
 * @param doc Yjs 文档实例
 * @returns 同步消息
 */
export function createSyncStep1(clientID: string, doc: Y.Doc): SyncMessage {
  const stateVector = Y.encodeStateVector(doc)

  return {
    type: 'sync-step-1',
    step: 1,
    clientID,
    stateVector,
  }
}

/**
 * 创建同步步骤 2 消息
 * 客户端 B 接收到客户端 A 的状态向量后，计算 A 缺失的更新并发送回去
 * @param clientID 发送者的客户端 ID
 * @param stateVector 另一个客户端的状态向量
 * @param doc Yjs 文档实例
 * @returns 同步消息
 */
export function createSyncStep2(clientID: string, stateVector: Uint8Array, doc: Y.Doc): SyncMessage {
  // 计算相对于 stateVector 的增量更新
  const update = Y.encodeStateAsUpdate(doc, stateVector)

  return {
    type: 'sync-step-2',
    step: 2,
    clientID,
    stateVector,
    update,
  }
}

/**
 * 应用同步消息到文档
 * 根据消息类型应用相应的更新
 * @param message 同步消息
 * @param doc 目标 Yjs 文档实例
 */
export function applySyncMessage(message: SyncMessage, doc: Y.Doc): void {
  // 如果是 sync-step-2 消息，应用其中的增量更新
  if (message.type === 'sync-step-2' && message.update) {
    Y.applyUpdate(doc, message.update)
  }
  // 如果是普通 update 消息，应用更新
  else if (message.type === 'update' && message.update) {
    Y.applyUpdate(doc, message.update)
  }
  // sync-step-1 消息不需要应用，只用于获取其他客户端的状态向量
}

/**
 * 执行两个文档间的同步
 * 模拟 A 和 B 两个客户端的同步过程
 * @param docA 客户端 A 的文档
 * @param docB 客户端 B 的文档
 */
export function synchronizeDocuments(docA: Y.Doc, docB: Y.Doc): void {
  // Step 1: A 发送其状态向量给 B
  const stateVectorA = Y.encodeStateVector(docA)

  // Step 2: B 计算 A 缺失的更新并发送
  const updateForA = Y.encodeStateAsUpdate(docB, stateVectorA)
  Y.applyUpdate(docA, updateForA)

  // Step 3: A 发送其状态向量给 B（A 应用了 B 的更新后）
  const stateVectorA2 = Y.encodeStateVector(docA)

  // Step 4: B 计算 A 缺失的更新
  const updateForB = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB))
  Y.applyUpdate(docB, updateForB)

  // Step 5: A 也获取最新的更新
  const stateVectorB = Y.encodeStateVector(docB)
  const finalUpdateForA = Y.encodeStateAsUpdate(docB, stateVectorA2)
  Y.applyUpdate(docA, finalUpdateForA)
}

/**
 * 验证两个文档是否处于一致状态
 * @param docA 文档 A
 * @param docB 文档 B
 * @returns 如果两个文档内容相同则返回 true
 */
export function areDocumentsConsistent(docA: Y.Doc, docB: Y.Doc): boolean {
  const textA = docA.getText('text').toString()
  const textB = docB.getText('text').toString()

  return textA === textB
}

/**
 * 获取文档的状态快照（用于调试）
 * @param doc Yjs 文档
 * @returns 包含文本内容的状态对象
 */
export function getDocumentSnapshot(doc: Y.Doc): {
  text: string
  version: number
} {
  // 使用状态编码的长度作为版本的代理
  const state = Y.encodeStateAsUpdate(doc)
  return {
    text: doc.getText('text').toString(),
    version: state.length,
  }
}
