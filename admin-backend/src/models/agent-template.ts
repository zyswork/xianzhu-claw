// Agent 模板模型定义

export interface AgentTemplate {
  id: string
  enterpriseId: string
  name: string
  description: string
  category: string
  config: Record<string, unknown>
  version: string
  status: 'draft' | 'published' | 'deprecated'
  permissions: {
    read: string[]
    write: string[]
  }
  createdBy: string
  createdAt: Date
  updatedAt: Date
  publishedAt?: Date
  tags: string[]
}

export interface CreateAgentTemplateRequest {
  name: string
  description: string
  category: string
  config: Record<string, unknown>
  tags?: string[]
  permissions?: {
    read: string[]
    write: string[]
  }
}

export interface UpdateAgentTemplateRequest {
  name?: string
  description?: string
  category?: string
  config?: Record<string, unknown>
  tags?: string[]
  permissions?: {
    read: string[]
    write: string[]
  }
}

export interface PublishTemplateRequest {
  version: string
  changelog?: string
}

export interface AgentTemplateResponse {
  id: string
  enterpriseId: string
  name: string
  description: string
  category: string
  config: Record<string, unknown>
  version: string
  status: string
  permissions: {
    read: string[]
    write: string[]
  }
  createdBy: string
  createdAt: string
  updatedAt: string
  publishedAt?: string
  tags: string[]
}

export interface TemplateVersion {
  version: string
  config: Record<string, unknown>
  changelog?: string
  createdAt: Date
  createdBy: string
  status: string
}
