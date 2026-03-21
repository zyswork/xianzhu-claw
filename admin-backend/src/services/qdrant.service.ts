/**
 * Qdrant 向量数据库服务
 *
 * 提供与 Qdrant 向量数据库交互的功能，包括：
 * - 向量搜索
 * - 文档上传/更新/删除
 * - 缓存集成
 */

import { VectorCache } from '../cache/vector-cache'

export interface SearchResult {
  id: string
  score: number
  payload?: Record<string, any>
}

export interface UpsertPayload {
  id: string
  vector: number[]
  payload?: Record<string, any>
}

export interface QdrantConfig {
  /** Qdrant 服务地址 */
  host: string
  /** Qdrant 服务端口 */
  port: number
  /** API 密钥（可选） */
  apiKey?: string
}

/**
 * Qdrant 服务类
 *
 * 提供向量搜索和管理功能，内置向量缓存。
 */
export class QdrantService {
  private config: Required<Omit<QdrantConfig, 'apiKey'>> & { apiKey?: string }
  private vectorCache: VectorCache<SearchResult>

  constructor(config: QdrantConfig) {
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 6333,
      apiKey: config.apiKey,
    }

    // 初始化向量缓存
    this.vectorCache = new VectorCache<SearchResult>({
      maxSize: 100,
      similarityThreshold: 0.95,
      ttlMs: 3600000, // 1小时
    })
  }

  /**
   * 搜索向量（带缓存）
   *
   * @param collection - 集合名称
   * @param query - 查询向量
   * @param limit - 返回结果数量
   * @returns 搜索结果
   */
  async searchWithCache(
    collection: string,
    query: number[],
    limit: number = 10
  ): Promise<SearchResult[]> {
    // 1. 检查相似缓存
    const cached = this.vectorCache.findSimilar(query)
    if (cached) {
      // 截取前 limit 个结果
      return cached.slice(0, limit)
    }

    // 2. 执行向量搜索
    const results = await this.search(collection, query, limit)

    // 3. 缓存结果
    this.vectorCache.set(query, results)

    return results
  }

  /**
   * 向量搜索（不使用缓存）
   *
   * @param collection - 集合名称
   * @param query - 查询向量
   * @param limit - 返回结果数量
   * @returns 搜索结果
   */
  async search(
    collection: string,
    query: number[],
    limit: number = 10
  ): Promise<SearchResult[]> {
    // 这是一个模拟实现，实际使用时需要连接真实的 Qdrant 服务
    // 返回示例数据用于测试
    const results: SearchResult[] = []
    for (let i = 0; i < limit; i++) {
      results.push({
        id: `doc-${i}`,
        score: 1 - i * 0.05, // 模拟分数递减
        payload: { content: `Document ${i}` },
      })
    }
    return results
  }

  /**
   * 上传/更新向量
   *
   * @param collection - 集合名称
   * @param payloads - 向量载荷数组
   */
  async upsert(collection: string, payloads: UpsertPayload[]): Promise<void> {
    // 实际实现中，这里会将数据发送到 Qdrant
    // 这是一个模拟实现
    console.log(`Upserting ${payloads.length} vectors to collection ${collection}`)

    // 清空所有缓存，因为数据已更新
    this.vectorCache.invalidate()
  }

  /**
   * 删除向量
   *
   * @param collection - 集合名称
   * @param ids - 要删除的向量 ID
   */
  async delete(collection: string, ids: string[]): Promise<void> {
    // 实际实现中，这里会从 Qdrant 删除数据
    console.log(`Deleting ${ids.length} vectors from collection ${collection}`)

    // 清空所有缓存，因为数据已更新
    this.vectorCache.invalidate()
  }

  /**
   * 获取向量缓存
   *
   * @returns VectorCache 实例
   */
  getVectorCache(): VectorCache<SearchResult> {
    return this.vectorCache
  }

  /**
   * 获取缓存统计信息
   *
   * @returns 缓存统计
   */
  getCacheStats() {
    return this.vectorCache.getStats()
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.vectorCache.invalidate()
  }
}

// 导出全局单例
let qdrantServiceInstance: QdrantService | null = null

/**
 * 获取 Qdrant 服务单例
 *
 * @param config - 配置（仅在首次初始化时使用）
 * @returns QdrantService 实例
 */
export function getQdrantService(config?: QdrantConfig): QdrantService {
  if (!qdrantServiceInstance) {
    if (!config) {
      throw new Error('Qdrant service not initialized. Please provide config.')
    }
    qdrantServiceInstance = new QdrantService(config)
  }
  return qdrantServiceInstance
}

/**
 * 重置 Qdrant 服务（用于测试）
 */
export function resetQdrantService(): void {
  qdrantServiceInstance = null
}
