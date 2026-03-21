// Token 使用监控模型定义

export interface TokenUsage {
  id: string
  enterpriseId: string
  userId: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  timestamp: Date
  requestId: string
}

export interface TokenQuota {
  id: string
  enterpriseId: string
  monthlyLimit: number
  dailyLimit: number
  currentMonthUsage: number
  currentDayUsage: number
  resetDate: Date
  status: 'active' | 'exceeded' | 'suspended'
  createdAt: Date
  updatedAt: Date
}

export interface TokenAlert {
  id: string
  enterpriseId: string
  type: 'usage_threshold' | 'quota_exceeded' | 'cost_limit'
  threshold: number
  enabled: boolean
  notificationChannels: string[]
  createdAt: Date
  updatedAt: Date
}

export interface CostAnalysis {
  enterpriseId: string
  period: 'daily' | 'weekly' | 'monthly'
  startDate: Date
  endDate: Date
  totalTokens: number
  totalCost: number
  byModel: Record<string, { tokens: number; cost: number }>
  byUser: Record<string, { tokens: number; cost: number }>
}

export interface SetQuotaRequest {
  monthlyLimit: number
  dailyLimit: number
}

export interface SetAlertRequest {
  type: 'usage_threshold' | 'quota_exceeded' | 'cost_limit'
  threshold: number
  notificationChannels: string[]
}

export interface TokenUsageResponse {
  id: string
  enterpriseId: string
  userId: string
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  timestamp: string
  requestId: string
}

export interface TokenQuotaResponse {
  id: string
  enterpriseId: string
  monthlyLimit: number
  dailyLimit: number
  currentMonthUsage: number
  currentDayUsage: number
  resetDate: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface CostAnalysisResponse {
  enterpriseId: string
  period: string
  startDate: string
  endDate: string
  totalTokens: number
  totalCost: number
  byModel: Record<string, { tokens: number; cost: number }>
  byUser: Record<string, { tokens: number; cost: number }>
}
