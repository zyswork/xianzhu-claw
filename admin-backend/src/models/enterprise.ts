// 企业模型定义

export interface Enterprise {
  id: string
  name: string
  description: string
  logo?: string
  website?: string
  industry?: string
  size?: string
  createdAt: Date
  updatedAt: Date
  status: 'active' | 'inactive' | 'suspended'
}

export interface CreateEnterpriseRequest {
  name: string
  description: string
  logo?: string
  website?: string
  industry?: string
  size?: string
}

export interface UpdateEnterpriseRequest {
  name?: string
  description?: string
  logo?: string
  website?: string
  industry?: string
  size?: string
  status?: 'active' | 'inactive' | 'suspended'
}

export interface EnterpriseResponse {
  id: string
  name: string
  description: string
  logo?: string
  website?: string
  industry?: string
  size?: string
  status: string
  createdAt: string
  updatedAt: string
}
