// Token 监控路由

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import {
  TokenUsage,
  TokenQuota,
  TokenAlert,
  SetQuotaRequest,
  SetAlertRequest,
  TokenUsageResponse,
  TokenQuotaResponse,
  CostAnalysisResponse,
} from '../models/token-usage.js'

const router = Router()

// 获取 Token 使用统计
router.get('/usage', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.headers

    if (!enterpriseId || typeof enterpriseId !== 'string') {
      res.status(400).json({ error: '缺少企业 ID' })
      return
    }

    const usages = db.getTokenUsageByEnterpriseId(enterpriseId)
    const response: TokenUsageResponse[] = usages.map(u => ({
      id: u.id,
      enterpriseId: u.enterpriseId,
      userId: u.userId,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens,
      cost: u.cost,
      timestamp: u.timestamp.toISOString(),
      requestId: u.requestId,
    }))

    const totalTokens = usages.reduce((sum, u) => sum + u.totalTokens, 0)
    const totalCost = usages.reduce((sum, u) => sum + u.cost, 0)

    res.json({
      usages: response,
      summary: {
        totalTokens,
        totalCost,
        count: response.length,
      },
    })
  } catch (error) {
    console.error('获取 Token 使用统计失败:', error)
    res.status(500).json({ error: '获取 Token 使用统计失败' })
  }
})

// 获取企业 Token 使用统计
router.get('/usage/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const usages = db.getTokenUsageByEnterpriseId(enterpriseId)
    const response: TokenUsageResponse[] = usages.map(u => ({
      id: u.id,
      enterpriseId: u.enterpriseId,
      userId: u.userId,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      totalTokens: u.totalTokens,
      cost: u.cost,
      timestamp: u.timestamp.toISOString(),
      requestId: u.requestId,
    }))

    const totalTokens = usages.reduce((sum, u) => sum + u.totalTokens, 0)
    const totalCost = usages.reduce((sum, u) => sum + u.cost, 0)

    res.json({
      usages: response,
      summary: {
        totalTokens,
        totalCost,
        count: response.length,
      },
    })
  } catch (error) {
    console.error('获取企业 Token 使用统计失败:', error)
    res.status(500).json({ error: '获取企业 Token 使用统计失败' })
  }
})

// 记录 Token 使用
router.post('/usage', (req: Request, res: Response) => {
  try {
    const { enterpriseId, userId, model, inputTokens, outputTokens, cost } = req.body

    if (!enterpriseId || !userId || !model) {
      res.status(400).json({ error: '缺少必要参数' })
      return
    }

    const usage: TokenUsage = {
      id: `usage_${uuidv4()}`,
      enterpriseId,
      userId,
      model,
      inputTokens: inputTokens || 0,
      outputTokens: outputTokens || 0,
      totalTokens: (inputTokens || 0) + (outputTokens || 0),
      cost: cost || 0,
      timestamp: new Date(),
      requestId: `req_${uuidv4()}`,
    }

    const recorded = db.recordTokenUsage(usage)
    const response: TokenUsageResponse = {
      id: recorded.id,
      enterpriseId: recorded.enterpriseId,
      userId: recorded.userId,
      model: recorded.model,
      inputTokens: recorded.inputTokens,
      outputTokens: recorded.outputTokens,
      totalTokens: recorded.totalTokens,
      cost: recorded.cost,
      timestamp: recorded.timestamp.toISOString(),
      requestId: recorded.requestId,
    }

    res.status(201).json(response)
  } catch (error) {
    console.error('记录 Token 使用失败:', error)
    res.status(500).json({ error: '记录 Token 使用失败' })
  }
})

// 获取成本分析
router.get('/cost-analysis/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { period } = req.query

    const usages = db.getTokenUsageByEnterpriseId(enterpriseId)

    const byModel: Record<string, { tokens: number; cost: number }> = {}
    const byUser: Record<string, { tokens: number; cost: number }> = {}

    usages.forEach(u => {
      if (!byModel[u.model]) {
        byModel[u.model] = { tokens: 0, cost: 0 }
      }
      byModel[u.model].tokens += u.totalTokens
      byModel[u.model].cost += u.cost

      if (!byUser[u.userId]) {
        byUser[u.userId] = { tokens: 0, cost: 0 }
      }
      byUser[u.userId].tokens += u.totalTokens
      byUser[u.userId].cost += u.cost
    })

    const now = new Date()
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1)
    const endDate = now

    const response: CostAnalysisResponse = {
      enterpriseId,
      period: (period as string) || 'monthly',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalTokens: usages.reduce((sum, u) => sum + u.totalTokens, 0),
      totalCost: usages.reduce((sum, u) => sum + u.cost, 0),
      byModel,
      byUser,
    }

    res.json(response)
  } catch (error) {
    console.error('获取成本分析失败:', error)
    res.status(500).json({ error: '获取成本分析失败' })
  }
})

// 设置配额
router.post('/quotas/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { monthlyLimit, dailyLimit } = req.body as SetQuotaRequest

    if (!monthlyLimit || !dailyLimit) {
      res.status(400).json({ error: '月度和日度限额不能为空' })
      return
    }

    const existing = db.getTokenQuotaByEnterpriseId(enterpriseId)

    let quota: TokenQuota
    if (existing) {
      const updated = db.updateTokenQuota(existing.id, {
        monthlyLimit,
        dailyLimit,
        updatedAt: new Date(),
      })
      quota = updated!
    } else {
      quota = {
        id: `quota_${uuidv4()}`,
        enterpriseId,
        monthlyLimit,
        dailyLimit,
        currentMonthUsage: 0,
        currentDayUsage: 0,
        resetDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      quota = db.createTokenQuota(quota)
    }

    const response: TokenQuotaResponse = {
      id: quota.id,
      enterpriseId: quota.enterpriseId,
      monthlyLimit: quota.monthlyLimit,
      dailyLimit: quota.dailyLimit,
      currentMonthUsage: quota.currentMonthUsage,
      currentDayUsage: quota.currentDayUsage,
      resetDate: quota.resetDate.toISOString(),
      status: quota.status,
      createdAt: quota.createdAt.toISOString(),
      updatedAt: quota.updatedAt.toISOString(),
    }

    res.status(201).json(response)
  } catch (error) {
    console.error('设置配额失败:', error)
    res.status(500).json({ error: '设置配额失败' })
  }
})

// 获取企业配额
router.get('/quotas/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const quota = db.getTokenQuotaByEnterpriseId(enterpriseId)

    if (!quota) {
      res.status(404).json({ error: '配额不存在' })
      return
    }

    const response: TokenQuotaResponse = {
      id: quota.id,
      enterpriseId: quota.enterpriseId,
      monthlyLimit: quota.monthlyLimit,
      dailyLimit: quota.dailyLimit,
      currentMonthUsage: quota.currentMonthUsage,
      currentDayUsage: quota.currentDayUsage,
      resetDate: quota.resetDate.toISOString(),
      status: quota.status,
      createdAt: quota.createdAt.toISOString(),
      updatedAt: quota.updatedAt.toISOString(),
    }

    res.json(response)
  } catch (error) {
    console.error('获取企业配额失败:', error)
    res.status(500).json({ error: '获取企业配额失败' })
  }
})

// 设置告警
router.post('/alerts/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { type, threshold, notificationChannels } = req.body as SetAlertRequest

    if (!type || !threshold || !notificationChannels) {
      res.status(400).json({ error: '告警类型、阈值和通知渠道不能为空' })
      return
    }

    const alert: TokenAlert = {
      id: `alert_${uuidv4()}`,
      enterpriseId,
      type,
      threshold,
      enabled: true,
      notificationChannels,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const created = db.createTokenAlert(alert)
    res.status(201).json(created)
  } catch (error) {
    console.error('设置告警失败:', error)
    res.status(500).json({ error: '设置告警失败' })
  }
})

// 获取企业告警
router.get('/alerts/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const alerts = db.getTokenAlertsByEnterpriseId(enterpriseId)
    res.json({ alerts, total: alerts.length })
  } catch (error) {
    console.error('获取企业告警失败:', error)
    res.status(500).json({ error: '获取企业告警失败' })
  }
})

export default router
