// WebSocket 服务器集成模块
// 创建和管理 WebSocket 服务器实例

import { WebSocketServer, WebSocket } from 'ws'
import { Server as HttpServer, IncomingMessage } from 'http'
import { wsManager, WebSocketMessage } from './ws-manager.js'
import { authenticateWebSocket, parseWebSocketMessage, WebSocketAuthData } from './auth.js'

/**
 * 创建并配置 WebSocket 服务器
 * @param httpServer HTTP 服务器实例
 * @returns 配置完成的 WebSocket 服务器
 */
export function createWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
  })

  // WebSocket 连接处理
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log(`📡 WebSocket 连接请求: ${req.socket.remoteAddress}`)

    // 认证连接
    const authData = authenticateWebSocket(ws, req)
    if (!authData) {
      return // 连接已被拒绝
    }

    const userId = authData.userId

    // 从 URL 中提取 token 用于重连
    const url = req.url || ''
    const urlObj = new URL(url, 'http://localhost')
    const token = urlObj.searchParams.get('token') || ''

    // 注册客户端（传递 token 用于重连）
    wsManager.registerClient(userId, ws, token)

    // 启动健康检查
    wsManager.startHealthCheck(userId, ws)

    // 处理客户端消息
    ws.on('message', (data: Buffer) => {
      handleWebSocketMessage(userId, data)
    })

    // 处理 pong 应答
    ws.on('pong', () => {
      const clientInfo = wsManager.getUserStatus(userId)
      if (clientInfo) {
        clientInfo.lastHeartbeat = new Date()
      }
      // 处理健康检查 pong
      wsManager.handlePong(userId)
    })

    // 处理连接错误
    ws.on('error', (error: Error) => {
      console.error(`❌ WebSocket 错误 (${userId}):`, error.message)
      wsManager.unregisterClient(userId)
    })

    // 处理连接关闭
    ws.on('close', () => {
      console.log(`📴 WebSocket 连接关闭: ${userId}`)
      // 停止健康检查
      wsManager.stopHealthCheck(userId)
      wsManager.unregisterClient(userId)

      // 触发重连逻辑
      if (token) {
        // 注意：这里需要获取 WebSocket 服务器的地址
        // 通过从请求中提取信息或使用环境变量
        const wsUrl = process.env.WS_URL || `ws://localhost:${(httpServer.address() as any).port || 3000}/ws`
        console.log(`🔄 开始重连流程 (${userId})`)
        // 异步执行重连，不阻塞关闭流程
        wsManager.initiateReconnect(userId, token, wsUrl).catch((error) => {
          console.error(`❌ 重连初始化失败 (${userId}):`, error)
        })
      }
    })

    // 发送欢迎消息
    const welcomeMessage: WebSocketMessage = {
      type: 'connected',
      data: {
        message: '连接成功',
        userId,
        timestamp: Date.now(),
      },
    }
    wsManager.sendToUser(userId, welcomeMessage)
  })

  // WebSocket 服务器错误处理
  wss.on('error', (error: Error) => {
    console.error('❌ WebSocket 服务器错误:', error)
  })

  // 启动全局定期健康检查扫描（60 秒）
  wsManager.startGlobalHealthCheckInterval(60000)

  // 监听 HTTP 服务器关闭事件，清理资源
  httpServer.on('close', () => {
    wsManager.stopGlobalHealthCheckInterval()
    wsManager.cleanupHealthCheck()
  })

  console.log('✓ WebSocket 服务器已创建')
  return wss
}

/**
 * 处理 WebSocket 消息
 * @param userId 用户 ID
 * @param data 消息数据
 */
function handleWebSocketMessage(userId: string, data: Buffer): void {
  const message = parseWebSocketMessage(data.toString())
  if (!message) {
    console.warn(`⚠️  无效的消息格式 (${userId})`)
    return
  }

  const { type, data: payload } = message

  switch (type) {
    case 'ping':
      // 响应 ping
      const pongMessage: WebSocketMessage = {
        type: 'pong',
        data: { timestamp: Date.now() },
      }
      wsManager.sendToUser(userId, pongMessage)
      break

    case 'pong':
      // 更新最后心跳时间
      const clientInfo = wsManager.getUserStatus(userId)
      if (clientInfo) {
        clientInfo.lastHeartbeat = new Date()
      }
      break

    case 'message':
      // 处理自定义消息
      console.log(`💬 消息来自 ${userId}:`, payload)
      // 这里可以添加自定义消息处理逻辑
      // 例如：转发消息、保存到数据库等
      break

    default:
      console.log(`⚠️  未知消息类型: ${type} (${userId})`)
  }
}

/**
 * 启动 WebSocket 服务器
 * @param httpServer HTTP 服务器实例
 * @returns WebSocket 服务器实例
 */
export function initializeWebSocket(httpServer: HttpServer): WebSocketServer {
  return createWebSocketServer(httpServer)
}

// 导出管理器和相关函数
export { wsManager, WebSocketMessage } from './ws-manager.js'
export { WebSocketAuthData } from './auth.js'
