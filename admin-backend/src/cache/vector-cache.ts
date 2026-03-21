/**
 * 向量缓存管理器
 *
 * 实现向量搜索结果的缓存，支持：
 * - 精确搜索缓存（通过 embedding 向量）
 * - 相似向量匹配（基于余弦相似度）
 * - 自动 TTL 过期
 * - 缓存统计和命中率计算
 */

export interface VectorCacheConfig {
  /** 缓存最大条目数，默认 100 个搜索结果 */
  maxSize: number
  /** 相似度阈值，范围 0-1，默认 0.95 */
  similarityThreshold: number
  /** 缓存生存时间（毫秒），默认 3600000 (1小时) */
  ttlMs: number
}

export interface CachedSearchResult<T = any> {
  /** 查询向量 (embedding) */
  query: number[]
  /** 搜索结果 */
  results: T[]
  /** 创建时间戳（毫秒） */
  timestamp: number
  /** 过期时间戳（毫秒） */
  expiresAt: number
  /** 命中次数 */
  hits: number
}

/**
 * 向量缓存管理器
 *
 * 提供向量搜索结果缓存功能，支持基于余弦相似度的缓存命中判断。
 * 使用 LRU + TTL 管理缓存生命周期。
 */
export class VectorCache<T = any> {
  private cache: Map<string, CachedSearchResult<T>>
  private accessOrder: string[] // 用于 LRU 淘汰
  private config: Required<VectorCacheConfig>
  private stats: {
    hits: number
    misses: number
    evictions: number
  }

  constructor(config?: Partial<VectorCacheConfig>) {
    this.cache = new Map()
    this.accessOrder = []
    this.config = {
      maxSize: config?.maxSize ?? 100,
      similarityThreshold: config?.similarityThreshold ?? 0.95,
      ttlMs: config?.ttlMs ?? 3600000, // 1小时
    }
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    }
  }

  /**
   * 根据向量查询缓存（精确匹配）
   *
   * @param query - 查询向量
   * @returns 缓存的搜索结果，若不存在或已过期则返回 null
   */
  get(query: number[]): T[] | null {
    const key = this.vectorToKey(query)
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      return null
    }

    // 检查 TTL
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
      this.stats.misses++
      return null
    }

    // 命中
    entry.hits++
    entry.timestamp = Date.now()
    this.updateAccessOrder(key)
    this.stats.hits++

    return entry.results
  }

  /**
   * 存储搜索结果到缓存
   *
   * @param query - 查询向量
   * @param results - 搜索结果
   */
  set(query: number[], results: T[]): void {
    const key = this.vectorToKey(query)
    const now = Date.now()

    // 如果键已存在，更新值
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!
      entry.results = results
      entry.timestamp = now
      entry.expiresAt = now + this.config.ttlMs
      entry.hits = 0
      this.updateAccessOrder(key)
      return
    }

    // 如果缓存已满，执行 LRU 淘汰
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU()
    }

    // 添加新条目
    const entry: CachedSearchResult<T> = {
      query,
      results,
      timestamp: now,
      expiresAt: now + this.config.ttlMs,
      hits: 0,
    }
    this.cache.set(key, entry)
    this.accessOrder.push(key)
  }

  /**
   * 查找相似的向量缓存
   *
   * 使用余弦相似度计算，如果找到相似度 > 阈值的缓存，返回其结果。
   *
   * @param query - 查询向量
   * @returns 相似的缓存结果，若不存在则返回 null
   */
  findSimilar(query: number[]): T[] | null {
    let bestMatch: CachedSearchResult<T> | null = null
    let bestSimilarity = 0

    // 遍历所有缓存项，找相似度最高的
    for (const [, entry] of this.cache) {
      // 检查 TTL
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(this.vectorToKey(entry.query))
        continue
      }

      const similarity = this.cosineSimilarity(query, entry.query)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestMatch = entry
      }
    }

    // 如果找到相似度足够高的缓存
    if (bestMatch && bestSimilarity >= this.config.similarityThreshold) {
      bestMatch.hits++
      bestMatch.timestamp = Date.now()
      const key = this.vectorToKey(bestMatch.query)
      this.updateAccessOrder(key)
      this.stats.hits++
      return bestMatch.results
    }

    this.stats.misses++
    return null
  }

  /**
   * 清空所有缓存
   *
   * @param pattern - 可选的键模式（用于清理特定前缀的缓存）
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      // 清空所有缓存
      this.cache.clear()
      this.accessOrder = []
    } else {
      // 清空特定模式的缓存
      const keysToDelete: string[] = []
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach((key) => {
        this.cache.delete(key)
        this.removeFromAccessOrder(key)
      })
    }
  }

  /**
   * 获取缓存统计信息
   *
   * @returns 统计对象，包含大小、命中率等信息
   */
  getStats(): {
    size: number
    maxSize: number
    hitRate: number
    hits: number
    misses: number
    evictions: number
  } {
    const totalRequests = this.stats.hits + this.stats.misses
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0

    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      hitRate,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
    }
  }

  /**
   * 获取缓存配置
   *
   * @returns 当前的缓存配置
   */
  getConfig(): Required<VectorCacheConfig> {
    return { ...this.config }
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    }
  }

  /**
   * 计算两个向量的余弦相似度
   *
   * @param v1 - 向量 1
   * @param v2 - 向量 2
   * @returns 相似度值，范围 0-1
   */
  private cosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) {
      return 0
    }

    // 计算点积
    let dotProduct = 0
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i]
    }

    // 计算范数
    let norm1 = 0
    let norm2 = 0
    for (let i = 0; i < v1.length; i++) {
      norm1 += v1[i] * v1[i]
      norm2 += v2[i] * v2[i]
    }

    norm1 = Math.sqrt(norm1)
    norm2 = Math.sqrt(norm2)

    // 避免除以零
    if (norm1 === 0 || norm2 === 0) {
      return 0
    }

    return dotProduct / (norm1 * norm2)
  }

  /**
   * 将向量转换为缓存键
   *
   * @private
   */
  private vectorToKey(vector: number[]): string {
    return JSON.stringify(vector)
  }

  /**
   * 执行 LRU 淘汰
   *
   * @private
   */
  private evictLRU(): void {
    const keyToEvict = this.accessOrder[0]
    if (keyToEvict) {
      this.cache.delete(keyToEvict)
      this.removeFromAccessOrder(keyToEvict)
      this.stats.evictions++
    }
  }

  /**
   * 更新访问顺序
   *
   * @private
   */
  private updateAccessOrder(key: string): void {
    this.removeFromAccessOrder(key)
    this.accessOrder.push(key)
  }

  /**
   * 从访问顺序中移除键
   *
   * @private
   */
  private removeFromAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
  }
}
