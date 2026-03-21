import { apiClient } from './client'

// 用户类型定义
export interface User {
  id: string
  email: string
  name: string
  role: string
  enterpriseId: string
}

// 创建用户请求类型
export interface CreateUserRequest {
  email: string
  name: string
  password: string
  role: string
  enterpriseId: string
}

// 更新用户请求类型
export interface UpdateUserRequest {
  email?: string
  name?: string
  role?: string
}

export const usersAPI = {
  getByEnterprise: (enterpriseId: string) =>
    apiClient.get<User[]>('/users', { params: { enterpriseId } }),
  getById: (id: string) => apiClient.get<User>(`/users/${id}`),
  create: (data: CreateUserRequest) =>
    apiClient.post<User>('/users', data),
  update: (id: string, data: UpdateUserRequest) =>
    apiClient.put<User>(`/users/${id}`, data),
  delete: (id: string) => apiClient.delete(`/users/${id}`),
}
