// WebSocket 认证中间件
// 从 URL 查询参数中提取并验证 JWT token

import { WebSocket } from 'ws'
import { IncomingMessage } from 'http'
import { verifyToken } from '../middleware/auth.js'

export interface WebSocketAuthData {
  userId: string
  email: string
  enterpriseId: string
  role: string
}

/**
 * 解析 URL 查询参数
 * @param url URL 字符串
 * @returns 查询参数对象
 */
function parseQueryParams(url: string): Record<string, string> {
  const urlObj = new URL(url, 'http://localhost')
  const params: Record<string, string> = {}
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value
  })
  return params
}

/**
 * WebSocket 认证函数
 * 从 URL 查询参数中提取 token，验证其有效性
 *
 * 使用方式:
 * client: ws://localhost:3000/ws?token=<jwt_token>
 *
 * @param ws WebSocket 连接
 * @param req 原始 HTTP 请求
 * @returns 解析成功返回 true，否则返回 false（连接会被关闭）
 */
export function authenticateWebSocket(ws: WebSocket, req: IncomingMessage): WebSocketAuthData | null {
  try {
    // 从 URL 中提取 token
    const url = req.url || ''
    const params = parseQueryParams(url)
    const token = params.token

    if (!token) {
      console.warn('❌ WebSocket 连接被拒绝: 缺少 token')
      ws.close(1008, '缺少认证令牌')
      return null
    }

    // 验证 token
    const decoded = verifyToken(token)
    if (!decoded) {
      console.warn('❌ WebSocket 连接被拒绝: token 无效或已过期')
      ws.close(1008, '无效的认证令牌')
      return null
    }

    // 提取用户信息
    const authData: WebSocketAuthData = {
      userId: decoded.id,
      email: decoded.email,
      enterpriseId: decoded.enterpriseId,
      role: decoded.role,
    }

    console.log(`✓ WebSocket 认证成功: ${authData.userId} (${authData.email})`)
    return authData
  } catch (error) {
    console.error('❌ WebSocket 认证异常:', error)
    ws.close(1011, '认证异常')
    return null
  }
}

/**
 * 从 WebSocket 消息提取 JSON 数据
 * @param data WebSocket 消息数据
 * @returns 解析的 JSON 对象
 */
export function parseWebSocketMessage(data: string): Record<string, any> | null {
  try {
    return JSON.parse(data)
  } catch (error) {
    console.error('❌ WebSocket 消息解析失败:', error)
    return null
  }
}
