// Tauri 兼容的 HTTP 请求工具
// 在 Tauri 环境下使用 Rust HTTP 客户端（绕过 webview 安全限制）
// 在浏览器环境下使用原生 fetch

import { API_BASE_URL } from '../config/api'

// 检测是否在 Tauri 环境中
const isTauri = Boolean(typeof window !== 'undefined' && (window as any).__TAURI__)

// Tauri HTTP 客户端（延迟导入）
let tauriFetch: any = null
async function getTauriFetch() {
  if (!tauriFetch) {
    const { fetch, Body, ResponseType } = await import('@tauri-apps/api/http')
    tauriFetch = { fetch, Body, ResponseType }
  }
  return tauriFetch
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: any
}

interface ApiResponse {
  ok: boolean
  status: number
  data: any
}

// 统一的请求函数
export async function apiRequest(path: string, options: RequestOptions = {}): Promise<ApiResponse> {
  const url = `${API_BASE_URL}${path}`
  const token = localStorage.getItem('token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (isTauri) {
    // Tauri 环境：使用 Rust HTTP 客户端
    const { fetch, Body, ResponseType } = await getTauriFetch()
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? Body.json(options.body) : undefined,
      responseType: ResponseType.JSON,
    })
    return {
      ok: response.ok,
      status: response.status,
      data: response.data,
    }
  } else {
    // 浏览器环境：使用原生 fetch
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    const data = await response.json().catch(() => null)
    return {
      ok: response.ok,
      status: response.status,
      data,
    }
  }
}

// 便捷方法
export const api = {
  get: (path: string, headers?: Record<string, string>) =>
    apiRequest(path, { method: 'GET', headers }),

  post: (path: string, body?: any, headers?: Record<string, string>) =>
    apiRequest(path, { method: 'POST', body, headers }),

  put: (path: string, body?: any, headers?: Record<string, string>) =>
    apiRequest(path, { method: 'PUT', body, headers }),

  delete: (path: string, headers?: Record<string, string>) =>
    apiRequest(path, { method: 'DELETE', headers }),
}
