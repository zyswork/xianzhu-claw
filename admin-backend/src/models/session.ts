// WebSocket 会话模型定义

export interface WebSocketSession {
  id: string
  userId: string
  connectedAt: string // ISO 时间戳
  lastHeartbeat: string // ISO 时间戳
  status: 'connected' | 'disconnected' | 'reconnecting'
}

export interface CreateWebSocketSessionRequest {
  userId: string
}

export interface UpdateWebSocketSessionStatusRequest {
  status: 'connected' | 'disconnected' | 'reconnecting'
}
