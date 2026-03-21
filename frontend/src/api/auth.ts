import { apiClient } from './client'

// 登录请求类型
export interface LoginRequest {
  enterpriseId: string
  email: string
  password: string
}

// 注册请求类型
export interface RegisterRequest {
  enterpriseId: string
  email: string
  name: string
  password: string
}

// 认证响应类型
export interface AuthResponse {
  token: string
  userId: string
  email: string
  name: string
  role: string
  enterpriseId: string
}

export const authAPI = {
  login: (enterpriseId: string, email: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/login', { enterpriseId, email, password }),
  register: (enterpriseId: string, email: string, name: string, password: string) =>
    apiClient.post<AuthResponse>('/auth/register', { enterpriseId, email, name, password }),
}
