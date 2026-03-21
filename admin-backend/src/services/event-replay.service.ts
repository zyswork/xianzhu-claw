/**
 * 事件回放服务 - 实现事件溯源和时间旅行
 *
 * 核心功能：
 * - 从事件日志重建资源状态
 * - 支持指定时间戳回放（时间旅行）
 * - 支持指定版本回放
 * - 事件因果关系验证
 * - 编辑历史追踪
 * - 版本间差异计算
 */

/**
 * 可回放的事件接口
 */
export interface ReplayableEvent {
  id: string
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'EXECUTE'
  resourceId: string
  resourceType: string
  userId: string
  timestamp: string // ISO 8601 时间戳
  version: number // 全局递增版本号
  payload: any
}

/**
 * 事件应用结果接口
 */
interface ApplyResult {
  success: boolean
  state: any
  error?: string
}

/**
 * 事件回放服务
 */
export class EventReplayService {
  private db: any

  constructor(db: any) {
    this.db = db
  }

  /**
   * 重建资源当前状态
   * 将所有事件按版本号顺序应用到初始状态
   *
   * @param resourceId - 资源 ID
   * @param resourceType - 资源类型
   * @returns 当前资源状态，如果资源被删除则返回 null
   */
  public replayToPresent(resourceId: string, resourceType: string): any {
    const events = this.db.getEventsByResourceId(resourceId, resourceType)

    if (events.length === 0) {
      return null
    }

    let state: any = null

    for (const event of events) {
      state = this.applyEvent(state, event)
    }

    return state
  }

  /**
   * 重建指定时间点的资源状态（时间旅行）
   * 回放所有时间戳 <= 目标时间的事件
   *
   * @param resourceId - 资源 ID
   * @param resourceType - 资源类型
   * @param timestamp - 目标时间戳（ISO 8601 格式）
   * @returns 指定时间点的资源状态
   */
  public replayToTimestamp(resourceId: string, resourceType: string, timestamp: string): any {
    const events = this.db.getEventsByResourceId(resourceId, resourceType)

    if (events.length === 0) {
      return null
    }

    // 过滤出时间戳 <= 目标时间的事件
    const filteredEvents = events.filter((event: ReplayableEvent) => {
      return event.timestamp <= timestamp
    })

    if (filteredEvents.length === 0) {
      return null
    }

    let state: any = null

    for (const event of filteredEvents) {
      state = this.applyEvent(state, event)
    }

    return state
  }

  /**
   * 重建指定版本号的资源状态
   * 回放所有版本号 <= 目标版本的事件
   *
   * @param resourceId - 资源 ID
   * @param resourceType - 资源类型
   * @param version - 目标版本号
   * @returns 指定版本的资源状态
   */
  public replayToVersion(resourceId: string, resourceType: string, version: number): any {
    const events = this.db.getEventsByResourceId(resourceId, resourceType)

    if (events.length === 0) {
      return null
    }

    // 过滤出版本号 <= 目标版本的事件
    const filteredEvents = events.filter((event: ReplayableEvent) => {
      return event.version <= version
    })

    if (filteredEvents.length === 0) {
      return null
    }

    let state: any = null

    for (const event of filteredEvents) {
      state = this.applyEvent(state, event)
    }

    return state
  }

  /**
   * 获取资源的完整编辑历史
   * 返回所有相关事件的有序列表
   *
   * @param resourceId - 资源 ID
   * @param resourceType - 资源类型
   * @returns 事件列表，按版本号排序
   */
  public getEditHistory(resourceId: string, resourceType: string): ReplayableEvent[] {
    return this.db.getEventsByResourceId(resourceId, resourceType)
  }

  /**
   * 验证事件因果关系
   * 检查版本号递增和时间戳顺序
   *
   * @param events - 事件列表
   * @returns 验证是否通过
   */
  public validateCausality(events: ReplayableEvent[]): boolean {
    if (events.length === 0) {
      return true
    }

    // 检查版本号递增（严格递增）
    for (let i = 1; i < events.length; i++) {
      if (events[i].version <= events[i - 1].version) {
        return false
      }
    }

    // 检查时间戳顺序（时间戳应该严格递增）
    for (let i = 1; i < events.length; i++) {
      if (events[i].timestamp <= events[i - 1].timestamp) {
        return false
      }
    }

    return true
  }

  /**
   * 获取两个版本之间的变更
   * 计算从 v1 到 v2 之间发生的具体变更
   *
   * @param resourceId - 资源 ID
   * @param v1 - 起始版本号
   * @param v2 - 结束版本号
   * @returns 变更信息（包含前状态、后状态和差异）
   */
  public getChangesBetweenVersions(resourceId: string, v1: number, v2: number): any {
    if (v1 >= v2) {
      throw new Error('v1 版本号必须小于 v2 版本号')
    }

    const resourceType = this.getResourceTypeByResourceId(resourceId)

    // 获取 v1 时刻的状态
    const stateBefore = this.replayToVersion(resourceId, resourceType, v1)

    // 获取 v2 时刻的状态
    const stateAfter = this.replayToVersion(resourceId, resourceType, v2)

    // 获取这个范围内的事件
    const events = this.db.getEventsByVersionRange(resourceId, v1 + 1, v2)

    return {
      v1,
      v2,
      stateBefore,
      stateAfter,
      events,
      diff: this.computeDiff(stateBefore, stateAfter),
    }
  }

  /**
   * 应用单个事件到当前状态
   * 处理 CREATE、UPDATE、DELETE、EXECUTE 四种事件类型
   *
   * @param state - 当前状态
   * @param event - 要应用的事件
   * @returns 应用后的状态
   */
  private applyEvent(state: any, event: ReplayableEvent): any {
    switch (event.type) {
      case 'CREATE':
        // CREATE 事件：创建新资源，使用 payload 作为初始状态
        return this.applyCreate(event)

      case 'UPDATE':
        // UPDATE 事件：更新现有资源
        return this.applyUpdate(state, event)

      case 'DELETE':
        // DELETE 事件：删除资源
        return null

      case 'EXECUTE':
        // EXECUTE 事件：执行操作并更新状态
        return this.applyExecute(state, event)

      default:
        return state
    }
  }

  /**
   * 应用 CREATE 事件
   * @param event - CREATE 事件
   * @returns 新创建的资源状态
   */
  private applyCreate(event: ReplayableEvent): any {
    return {
      ...event.payload,
      _version: event.version,
      _lastModified: event.timestamp,
      _lastModifiedBy: event.userId,
    }
  }

  /**
   * 应用 UPDATE 事件
   * @param state - 当前状态
   * @param event - UPDATE 事件
   * @returns 更新后的状态
   */
  private applyUpdate(state: any, event: ReplayableEvent): any {
    if (!state) {
      throw new Error('无法更新不存在的资源')
    }

    return {
      ...state,
      ...event.payload,
      _version: event.version,
      _lastModified: event.timestamp,
      _lastModifiedBy: event.userId,
    }
  }

  /**
   * 应用 EXECUTE 事件
   * @param state - 当前状态
   * @param event - EXECUTE 事件
   * @returns 执行后的状态
   */
  private applyExecute(state: any, event: ReplayableEvent): any {
    if (!state) {
      return null
    }

    // EXECUTE 事件的 payload 应该包含操作类型和参数
    const { operation, params } = event.payload

    return {
      ...state,
      ...params,
      _version: event.version,
      _lastModified: event.timestamp,
      _lastModifiedBy: event.userId,
      _lastOperation: operation,
    }
  }

  /**
   * 计算两个状态之间的差异
   * @param before - 变更前的状态
   * @param after - 变更后的状态
   * @returns 差异对象
   */
  private computeDiff(before: any, after: any): any {
    if (!before || !after) {
      return { before, after }
    }

    const diff: any = {
      added: {},
      modified: {},
      removed: {},
    }

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])

    for (const key of allKeys) {
      if (!(key in before) && key in after) {
        // 新增字段
        diff.added[key] = after[key]
      } else if (key in before && !(key in after)) {
        // 删除字段
        diff.removed[key] = before[key]
      } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        // 修改字段
        diff.modified[key] = {
          from: before[key],
          to: after[key],
        }
      }
    }

    return diff
  }

  /**
   * 根据资源 ID 获取资源类型
   * 这是一个辅助方法，实际实现可能需要从数据库查询
   * @param resourceId - 资源 ID
   * @returns 资源类型
   */
  private getResourceTypeByResourceId(resourceId: string): string {
    // 简单的启发式方法：根据 ID 前缀判断
    if (resourceId.startsWith('doc_')) return 'document'
    if (resourceId.startsWith('user_')) return 'user'
    if (resourceId.startsWith('template_')) return 'template'
    if (resourceId.startsWith('enterprise_')) return 'enterprise'

    // 从数据库查询第一个事件来获取资源类型
    const allEvents = this.db.getEventsByResourceId(resourceId)
    if (allEvents.length > 0) {
      return allEvents[0].resourceType
    }

    return 'unknown'
  }
}

/**
 * 创建事件回放服务实例
 * @param db - 数据库实例
 * @returns EventReplayService 实例
 */
export function createEventReplayService(db: any): EventReplayService {
  return new EventReplayService(db)
}
