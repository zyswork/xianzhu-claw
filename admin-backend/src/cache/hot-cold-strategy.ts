/**
 * 热冷数据分层策略
 *
 * 实现热数据（频繁访问）缓存在内存，冷数据（不常用）存储在磁盘的分层策略。
 * 根据访问频率自动晋升/降级数据层级。
 */

import { CacheManager, CacheEntry } from './cache-manager.js'

export interface HotColdConfig {
  /** 热数据访问阈值，默认 5：每小时访问 > 5 次 = 热数据 */
  hotAccessThreshold: number
  /** 冷数据超时，默认 1800000ms（30 分钟）：未访问则自动降级 */
  coldAccessTimeout: number
  /** 定期检查间隔，默认 60000ms（1 分钟） */
  checkIntervalMs: number
}

interface LayeredData {
  /** 数据键 */
  key: string
  /** 实际数据 */
  value: any
  /** 数据分层状态：hot 或 cold */
  layer: 'hot' | 'cold'
  /** 访问计数 */
  accessCount: number
  /** 最后访问时间戳（毫秒） */
  lastAccessTime: number
  /** 晋升到热缓存的时间戳（毫秒），如果在冷存储则为 0 */
  promotedAt: number
  /** 降级到冷存储的时间戳（毫秒），如果在热缓存则为 0 */
  demotedAt: number
}

/**
 * 热冷数据分层策略管理器
 *
 * 基于访问频率和时间自动管理数据在热（内存）和冷（磁盘/其他）层之间的迁移。
 */
export class HotColdStrategy {
  private cacheManager: CacheManager<any>
  private config: Required<HotColdConfig>
  private coldStorage: Map<string, LayeredData>
  private hotStorage: Map<string, LayeredData>
  private checkInterval: NodeJS.Timeout | null = null
  private accessCounts: Map<string, number[]> // 跟踪每小时的访问计数

  constructor(cacheManager: CacheManager<any>, config?: Partial<HotColdConfig>) {
    this.cacheManager = cacheManager
    this.config = {
      hotAccessThreshold: config?.hotAccessThreshold ?? 5,
      coldAccessTimeout: config?.coldAccessTimeout ?? 30 * 60 * 1000, // 30 分钟
      checkIntervalMs: config?.checkIntervalMs ?? 60 * 1000, // 1 分钟
    }
    this.coldStorage = new Map()
    this.hotStorage = new Map()
    this.accessCounts = new Map()

    // 启动定期检查
    this.startAutoCheck()
  }

  /**
   * 访问数据（获取或设置）
   *
   * @param key - 数据键
   * @param value - 可选的数据值（如果提供则设置，否则获取）
   * @returns 数据值，如果不存在则返回 undefined
   */
  access(key: string, value?: any): any {
    const now = Date.now()

    // 记录访问计数
    this.recordAccess(key)

    // 如果提供了值，设置数据
    if (value !== undefined) {
      this.setLayeredData(key, value)
      return value
    }

    // 否则获取数据
    // 先从热缓存查找
    let data = this.cacheManager.get(key)
    if (data !== null) {
      const layered = this.hotStorage.get(key)
      if (layered) {
        layered.accessCount++
        layered.lastAccessTime = now
        this.hotStorage.set(key, layered)
      }
      return data
    }

    // 再从冷存储查找
    const coldData = this.coldStorage.get(key)
    if (coldData) {
      coldData.accessCount++
      coldData.lastAccessTime = now
      this.coldStorage.set(key, coldData)
      return coldData.value
    }

    return undefined
  }

  /**
   * 设置分层数据
   *
   * @private
   */
  private setLayeredData(key: string, value: any): void {
    const now = Date.now()

    // 根据当前访问频率判断应该存放在哪一层
    const hourlyAccessCount = this.getHourlyAccessCount(key)
    const shouldBeHot = hourlyAccessCount > this.config.hotAccessThreshold

    const layeredData: LayeredData = {
      key,
      value,
      layer: shouldBeHot ? 'hot' : 'cold',
      accessCount: 1,
      lastAccessTime: now,
      promotedAt: shouldBeHot ? now : 0,
      demotedAt: shouldBeHot ? 0 : now,
    }

    if (shouldBeHot) {
      this.cacheManager.set(key, value)
      this.hotStorage.set(key, layeredData)
      this.coldStorage.delete(key)
    } else {
      this.coldStorage.set(key, layeredData)
      this.cacheManager.delete(key)
      this.hotStorage.delete(key)
    }
  }

  /**
   * 促进热数据 - 满足条件的冷数据晋升到热缓存
   */
  promoteHotData(): void {
    const now = Date.now()
    const keysToPromote: string[] = []

    // 遍历冷存储，找出满足晋升条件的数据
    for (const [key, data] of this.coldStorage.entries()) {
      const hourlyAccessCount = this.getHourlyAccessCount(key)

      if (hourlyAccessCount > this.config.hotAccessThreshold) {
        keysToPromote.push(key)
      }
    }

    // 晋升满足条件的数据到热缓存
    for (const key of keysToPromote) {
      const coldData = this.coldStorage.get(key)!
      const hotData: LayeredData = {
        ...coldData,
        layer: 'hot',
        promotedAt: now,
        demotedAt: 0,
      }

      this.cacheManager.set(key, coldData.value)
      this.hotStorage.set(key, hotData)
      this.coldStorage.delete(key)
    }
  }

  /**
   * 降级冷数据 - 长时间未访问的热数据自动降级
   */
  demoteColdData(): void {
    const now = Date.now()
    const keysToDemote: string[] = []

    // 遍历热存储，找出满足降级条件的数据
    for (const [key, data] of this.hotStorage.entries()) {
      const timeSinceLastAccess = now - data.lastAccessTime

      if (timeSinceLastAccess > this.config.coldAccessTimeout) {
        keysToDemote.push(key)
      }
    }

    // 降级满足条件的数据到冷存储
    for (const key of keysToDemote) {
      const hotData = this.hotStorage.get(key)!
      const coldData: LayeredData = {
        ...hotData,
        layer: 'cold',
        promotedAt: 0,
        demotedAt: now,
      }

      this.coldStorage.set(key, coldData)
      this.cacheManager.delete(key)
      this.hotStorage.delete(key)
    }
  }

  /**
   * 手动晋升数据到热缓存
   *
   * @param key - 数据键
   */
  manualPromote(key: string): void {
    const now = Date.now()
    const coldData = this.coldStorage.get(key)

    if (coldData) {
      const hotData: LayeredData = {
        ...coldData,
        layer: 'hot',
        promotedAt: now,
        demotedAt: 0,
      }

      this.cacheManager.set(key, coldData.value)
      this.hotStorage.set(key, hotData)
      this.coldStorage.delete(key)
    } else {
      // 如果数据已在热存储，更新促进时间
      const hotData = this.hotStorage.get(key)
      if (hotData) {
        hotData.promotedAt = now
        this.hotStorage.set(key, hotData)
      }
    }
  }

  /**
   * 手动降级数据到冷存储
   *
   * @param key - 数据键
   */
  manualDemote(key: string): void {
    const now = Date.now()
    const hotData = this.hotStorage.get(key)

    if (hotData) {
      const coldData: LayeredData = {
        ...hotData,
        layer: 'cold',
        promotedAt: 0,
        demotedAt: now,
      }

      this.coldStorage.set(key, coldData)
      this.cacheManager.delete(key)
      this.hotStorage.delete(key)
    } else {
      // 如果数据已在冷存储，更新降级时间
      const coldData = this.coldStorage.get(key)
      if (coldData) {
        coldData.demotedAt = now
        this.coldStorage.set(key, coldData)
      }
    }
  }

  /**
   * 获取数据分层信息
   *
   * @returns 分层统计信息
   */
  getLayeringInfo(): {
    hotCount: number
    coldCount: number
    totalCount: number
    promotionRate: number
    hotKeys: string[]
    coldKeys: string[]
  } {
    const totalCount = this.hotStorage.size + this.coldStorage.size
    const promotionRate =
      totalCount > 0 ? this.hotStorage.size / totalCount : 0

    return {
      hotCount: this.hotStorage.size,
      coldCount: this.coldStorage.size,
      totalCount,
      promotionRate,
      hotKeys: Array.from(this.hotStorage.keys()),
      coldKeys: Array.from(this.coldStorage.keys()),
    }
  }

  /**
   * 获取数据的分层状态
   *
   * @param key - 数据键
   * @returns 分层数据，如果不存在则返回 undefined
   */
  getLayeredData(key: string): LayeredData | undefined {
    return this.hotStorage.get(key) || this.coldStorage.get(key)
  }

  /**
   * 启动自动检查定时器
   *
   * @private
   */
  private startAutoCheck(): void {
    this.checkInterval = setInterval(() => {
      this.promoteHotData()
      this.demoteColdData()
    }, this.config.checkIntervalMs)
  }

  /**
   * 停止自动检查定时器
   */
  stopAutoCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  /**
   * 获取某个键在过去一小时的访问次数
   *
   * @private
   */
  private getHourlyAccessCount(key: string): number {
    const now = Date.now()
    const oneHourAgo = now - 60 * 60 * 1000

    const counts = this.accessCounts.get(key) || []
    // 只保留过去一小时内的访问记录
    const recentCounts = counts.filter(timestamp => timestamp > oneHourAgo)
    this.accessCounts.set(key, recentCounts)

    return recentCounts.length
  }

  /**
   * 记录访问时间
   *
   * @private
   */
  private recordAccess(key: string): void {
    const counts = this.accessCounts.get(key) || []
    counts.push(Date.now())
    // 限制存储的时间戳数量，避免内存溢出
    if (counts.length > 1000) {
      counts.shift()
    }
    this.accessCounts.set(key, counts)
  }
}
