/**
 * LRU 缓存管理器
 *
 * 实现一个 LRU (Least Recently Used) 缓存，用于在内存中存储热数据。
 * 当缓存容量达到上限时，自动淘汰最久未使用的项。
 */

export interface CacheConfig {
  /** 缓存最大容量，默认为 1000 条记录 */
  maxSize: number
  /** 缓存生存时间（毫秒），为 0 表示无过期限制 */
  ttlMs: number
}

export interface CacheEntry<T> {
  /** 缓存键 */
  key: string
  /** 缓存值 */
  value: T
  /** 访问计数 */
  accessCount: number
  /** 最后访问时间戳（毫秒） */
  lastAccessTime: number
  /** 创建时间戳（毫秒） */
  createdTime: number
  /** 过期时间戳（毫秒），为 0 表示永不过期 */
  expiresAt: number
}

/**
 * LRU 缓存管理器
 *
 * 使用 Map + 访问顺序跟踪实现 LRU 算法。
 * 支持 TTL、访问计数统计等功能。
 */
export class CacheManager<T = any> {
  private cache: Map<string, CacheEntry<T>>
  private accessOrder: string[] // 跟踪访问顺序用于 LRU
  private config: Required<CacheConfig>
  private stats: {
    hits: number
    misses: number
    evictions: number
  }

  constructor(config?: Partial<CacheConfig>) {
    this.cache = new Map()
    this.accessOrder = []
    this.config = {
      maxSize: config?.maxSize ?? 1000,
      ttlMs: config?.ttlMs ?? 0,
    }
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    }
  }

  /**
   * 从缓存获取值
   *
   * @param key - 缓存键
   * @returns 缓存值，如果不存在或已过期则返回 null
   */
  get(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      this.stats.misses++
      return null
    }

    // 检查 TTL
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
      this.stats.misses++
      return null
    }

    // 更新访问信息
    entry.accessCount++
    entry.lastAccessTime = Date.now()
    this.updateAccessOrder(key)
    this.stats.hits++

    return entry.value
  }

  /**
   * 设置缓存值
   *
   * @param key - 缓存键
   * @param value - 缓存值
   */
  set(key: string, value: T): void {
    const now = Date.now()

    // 如果键已存在，更新值和时间
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!
      entry.value = value
      entry.lastAccessTime = now
      entry.accessCount++
      entry.expiresAt = this.config.ttlMs > 0 ? now + this.config.ttlMs : 0
      this.updateAccessOrder(key)
      return
    }

    // 如果缓存已满，执行 LRU 淘汰
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU()
    }

    // 添加新条目
    const entry: CacheEntry<T> = {
      key,
      value,
      accessCount: 1,
      lastAccessTime: now,
      createdTime: now,
      expiresAt: this.config.ttlMs > 0 ? now + this.config.ttlMs : 0,
    }
    this.cache.set(key, entry)
    this.accessOrder.push(key)
  }

  /**
   * 检查缓存中是否存在键
   *
   * @param key - 缓存键
   * @returns true 如果存在且未过期，否则 false
   */
  has(key: string): boolean {
    if (!this.cache.has(key)) return false

    const entry = this.cache.get(key)!
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      this.removeFromAccessOrder(key)
      return false
    }

    return true
  }

  /**
   * 删除缓存项
   *
   * @param key - 缓存键
   * @returns true 如果删除成功，false 如果键不存在
   */
  delete(key: string): boolean {
    if (!this.cache.has(key)) return false

    this.cache.delete(key)
    this.removeFromAccessOrder(key)
    return true
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
    this.accessOrder = []
  }

  /**
   * 获取缓存统计信息
   *
   * @returns 缓存统计对象
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
   * 获取缓存条目的详细信息
   *
   * @param key - 缓存键
   * @returns 缓存条目，如果不存在则返回 undefined
   */
  getEntry(key: string): CacheEntry<T> | undefined {
    return this.cache.get(key)
  }

  /**
   * 获取所有缓存键
   *
   * @returns 缓存键数组
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * 执行 LRU 淘汰 - 删除最久未使用的项
   *
   * @private
   */
  private evictLRU(): void {
    // 找到最久未使用的键（访问顺序中最前面的）
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
