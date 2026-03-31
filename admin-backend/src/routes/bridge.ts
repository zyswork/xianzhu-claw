/**
 * Desktop Bridge — WebSocket 端点
 * 桌面端通过 /ws/bridge 连接，注册能力、接收转发消息、同步数据
 */

import http from 'http'
import crypto from 'crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { db } from '../db/sqlite.js'

// 在线设备连接池
const connections = new Map<string, WebSocket>()

export function setupBridgeWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`)
    if (url.pathname === '/ws/bridge') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  wss.on('connection', (ws, request) => {
    let deviceId = 'desktop-' + Date.now()
    const ip = request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || request.socket.remoteAddress || ''
    console.log(`✓ Bridge 连接: ${deviceId} from ${ip}`)

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        handleMessage(ws, msg, deviceId, ip)
        // 更新 deviceId（register 消息可能带新 ID）
        if (msg.type === 'register' && msg.deviceId) {
          connections.delete(deviceId)
          deviceId = msg.deviceId
          connections.set(deviceId, ws)
        }
      } catch (e) {
        console.warn('Bridge 消息解析失败:', e)
      }
    })

    ws.on('close', () => {
      connections.delete(deviceId)
      console.log(`Bridge 断开: ${deviceId}`)
    })

    ws.on('error', (err) => {
      console.warn(`Bridge 错误 ${deviceId}:`, err.message)
    })

    connections.set(deviceId, ws)
  })

  console.log('✓ Bridge WebSocket 已挂载: /ws/bridge')
}

function handleMessage(ws: WebSocket, msg: any, deviceId: string, ip: string) {
  switch (msg.type) {
    case 'register': {
      // 桌面端注册设备信息
      const now = new Date().toISOString()
      try {
        db.prepare(`
          INSERT INTO device_heartbeats (id, userId, deviceId, platform, appVersion, ip, agentCount, lastSeen)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(deviceId) DO UPDATE SET
            platform = excluded.platform,
            appVersion = excluded.appVersion,
            ip = excluded.ip,
            agentCount = excluded.agentCount,
            lastSeen = excluded.lastSeen
        `).run(
          crypto.randomUUID(),
          msg.userId || null,
          msg.deviceId || deviceId,
          msg.platform || 'unknown',
          msg.version || '0.0.0',
          ip,
          Array.isArray(msg.agents) ? msg.agents.length : 0,
          now
        )
      } catch (e: any) {
        console.warn('Bridge register DB 写入失败:', e.message)
      }

      // 回复确认
      ws.send(JSON.stringify({ type: 'registered', deviceId: msg.deviceId || deviceId }))

      // 发送离线消息（如有）
      sendPendingSyncData(ws, msg.since)
      break
    }

    case 'sync': {
      sendPendingSyncData(ws, msg.since)
      break
    }

    case 'heartbeat': {
      ws.send(JSON.stringify({ type: 'heartbeat_ack', ts: Date.now() }))
      break
    }

    case 'new_message': {
      // 桌面端发来新消息（频道转发等）
      try {
        db.prepare(`
          INSERT OR IGNORE INTO chat_messages (id, session_id, agent_id, role, content, seq, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          msg.id || crypto.randomUUID(),
          msg.sessionId,
          msg.agentId,
          msg.role || 'user',
          msg.content,
          msg.seq || 0,
          msg.createdAt || new Date().toISOString()
        )
      } catch (e: any) {
        console.warn('Bridge message 写入失败:', e.message)
      }
      break
    }

    default:
      console.debug('Bridge 未知消息类型:', msg.type)
  }
}

function sendPendingSyncData(ws: WebSocket, since?: number) {
  try {
    // chat_messages 表可能不存在（仅 SQLite 模式下）
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'"
    ).get()
    if (!tableExists) {
      ws.send(JSON.stringify({ type: 'sync_data', messages: [], ts: Date.now() }))
      return
    }
    const sinceTs = since || 0
    const sinceDate = new Date(sinceTs).toISOString()
    const messages = db.prepare(
      'SELECT * FROM chat_messages WHERE created_at > ? ORDER BY created_at ASC LIMIT 100'
    ).all(sinceDate)
    ws.send(JSON.stringify({ type: 'sync_data', messages, ts: Date.now() }))
  } catch (e: any) {
    ws.send(JSON.stringify({ type: 'sync_data', messages: [], ts: Date.now() }))
  }
}

// 导出连接池（供其他模块推送消息）
export function getConnections() { return connections }
export function broadcastToDevices(msg: object) {
  const payload = JSON.stringify(msg)
  for (const [, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  }
}
