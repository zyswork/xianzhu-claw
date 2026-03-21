import { apiClient } from './client'

// 企业类型定义
export interface Enterprise {
  id: string
  name: string
  description: string
  industry: string
  size: string
}

// 创建企业请求类型
export interface CreateEnterpriseRequest {
  name: string
  description: string
  industry: string
  size: string
}

// 更新企业请求类型
export interface UpdateEnterpriseRequest {
  name?: string
  description?: string
  industry?: string
  size?: string
}

export const enterprisesAPI = {
  getAll: () => apiClient.get<Enterprise[]>('/enterprises'),
  getById: (id: string) => apiClient.get<Enterprise>(`/enterprises/${id}`),
  create: (data: CreateEnterpriseRequest) =>
    apiClient.post<Enterprise>('/enterprises', data),
  update: (id: string, data: UpdateEnterpriseRequest) =>
    apiClient.put<Enterprise>(`/enterprises/${id}`, data),
  delete: (id: string) => apiClient.delete(`/enterprises/${id}`),
}
