/**
 * 记忆管理页
 *
 * 展示 Agent 记忆体 + 对话/消息统计，支持导出快照、清理、搜索
 * 后端 API: export_memory_snapshot, run_memory_hygiene, get_agent_detail
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface Memory {
  id: string
  memory_type: string
  content: string
  priority: number
  created_at: number
  updated_at: number
}

interface AgentStats {
  sessionCount: number
  conversationCount: number
  messageCount: number
  vectorCount: number
  embeddingCacheCount: number
}

export default function MemoryPage() {
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [memories, setMemories] = useState<Memory[]>([])
  const [stats, setStats] = useState<AgentStats>({ sessionCount: 0, conversationCount: 0, messageCount: 0, vectorCount: 0, embeddingCacheCount: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { loadAgents() }, [])
  useEffect(() => { if (selectedAgent) loadData() }, [selectedAgent])

  const loadAgents = async () => {
    try {
      const list = (await invoke('list_agents')) as any[]
      setAgents(list.map((a: any) => ({ id: a.id, name: a.name })))
      if (list.length > 0) setSelectedAgent(list[0].id)
    } catch (e) {
      showMsg('error', '加载 Agent 失败')
    }
    setLoading(false)
  }

  const loadData = async () => {
    try {
      const detail = (await invoke('get_agent_detail', { agentId: selectedAgent })) as any
      setMemories(detail?.memories || [])
      setStats({
        sessionCount: detail?.sessionCount || 0,
        conversationCount: detail?.conversationCount || 0,
        messageCount: detail?.messageCount || 0,
        vectorCount: detail?.vectorCount || 0,
        embeddingCacheCount: detail?.embeddingCacheCount || 0,
      })
    } catch (e) {
      setMemories([])
      setStats({ sessionCount: 0, conversationCount: 0, messageCount: 0, vectorCount: 0, embeddingCacheCount: 0 })
    }
  }

  const handleExtract = async () => {
    if (!confirm('从历史对话中提取记忆？将调用 LLM 分析对话内容。')) return
    setActionLoading(true)
    try {
      const result = (await invoke('extract_memories_from_history', { agentId: selectedAgent })) as any
      showMsg('success', result?.message || `提取了 ${result?.extracted} 条记忆`)
      await loadData()
    } catch (e) {
      showMsg('error', '提取失败: ' + String(e))
    }
    setActionLoading(false)
  }

  const handleExport = async () => {
    setActionLoading(true)
    try {
      const result = (await invoke('export_memory_snapshot', { agentId: selectedAgent })) as string
      showMsg('success', result)
    } catch (e) {
      showMsg('error', '导出失败: ' + String(e))
    }
    setActionLoading(false)
  }

  const handleHygiene = async () => {
    if (!confirm('确定执行记忆清理？将移除低优先级的重复/过期记忆。')) return
    setActionLoading(true)
    try {
      const result = (await invoke('run_memory_hygiene', { agentId: selectedAgent })) as string
      showMsg('success', result)
      await loadData()
    } catch (e) {
      showMsg('error', '清理失败: ' + String(e))
    }
    setActionLoading(false)
  }

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 4000)
  }

  const filteredMemories = memories.filter((m) =>
    m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.memory_type.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 按类型分组
  const grouped = filteredMemories.reduce<Record<string, Memory[]>>((acc, m) => {
    const type = m.memory_type || '未分类'
    ;(acc[type] = acc[type] || []).push(m)
    return acc
  }, {})

  const typeColors: Record<string, { bg: string; text: string }> = {
    core: { bg: '#dbeafe', text: '#1e40af' },
    episodic: { bg: '#fef3c7', text: '#92400e' },
    semantic: { bg: '#d1fae5', text: '#065f46' },
    procedural: { bg: '#ede9fe', text: '#5b21b6' },
  }

  if (loading) return <div style={{ padding: '24px', color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>记忆管理</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleExtract}
            disabled={actionLoading}
            style={{
              padding: '8px 16px', fontSize: '13px', backgroundColor: '#7C3AED',
              color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer',
              opacity: actionLoading ? 0.6 : 1,
            }}
          >
            {actionLoading ? '处理中...' : '从对话提取'}
          </button>
          <button
            onClick={handleExport}
            disabled={actionLoading}
            style={{
              padding: '8px 16px', fontSize: '13px', backgroundColor: 'var(--accent)',
              color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer',
              opacity: actionLoading ? 0.6 : 1,
            }}
          >
            导出快照
          </button>
          <button
            onClick={handleHygiene}
            disabled={actionLoading}
            style={{
              padding: '8px 16px', fontSize: '13px', backgroundColor: '#D97706',
              color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer',
              opacity: actionLoading ? 0.6 : 1,
            }}
          >
            清理记忆
          </button>
        </div>
      </div>

      {/* Agent 选择器 + 搜索 */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <select
          value={selectedAgent}
          onChange={(e) => setSelectedAgent(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)', fontSize: '13px' }}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="搜索记忆内容..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: '6px', fontSize: '13px' }}
        />
      </div>

      {message && (
        <div style={{
          padding: '10px 14px', borderRadius: '6px', marginBottom: '12px', fontSize: '13px',
          backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
          color: message.type === 'success' ? '#22c55e' : '#ef4444',
        }}>
          {message.text}
        </div>
      )}

      {/* 数据统计卡片 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px', marginBottom: '20px',
      }}>
        <MiniCard label="记忆条数" value={memories.length} color="#8b5cf6" />
        <MiniCard label="向量数" value={stats.vectorCount} color="#f59e0b" />
        <MiniCard label="会话数" value={stats.sessionCount} color="#3b82f6" />
        <MiniCard label="消息总数" value={stats.messageCount} color="#10b981" />
        <MiniCard label="嵌入缓存" value={stats.embeddingCacheCount} color="#06b6d4" />
      </div>

      {/* 记忆类型分布 */}
      {Object.keys(grouped).length > 0 && (
        <div style={{
          display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap',
        }}>
          {Object.keys(grouped).map((type) => {
            const colors = typeColors[type] || { bg: '#f3f4f6', text: '#374151' }
            return (
              <span key={type} style={{
                fontSize: '12px', padding: '3px 10px', borderRadius: '6px',
                backgroundColor: colors.bg, color: colors.text, fontWeight: 500,
              }}>
                {type}: {grouped[type].length}
              </span>
            )
          })}
        </div>
      )}

      {/* 记忆列表 */}
      {filteredMemories.length === 0 ? (
        <div style={{
          padding: '40px', textAlign: 'center', borderRadius: '8px',
          backgroundColor: 'var(--bg-glass)', border: '1px solid var(--border-subtle)',
        }}>
          <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}>{'\u{1F9E0}'}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '8px' }}>
            {memories.length === 0 ? '该 Agent 暂无记忆' : '没有匹配的记忆'}
          </div>
          {memories.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '1.6' }}>
              记忆会在对话过程中自动积累。Agent 通过 memory_store 工具<br />
              将重要信息保存为长期记忆（core/episodic/semantic/procedural）。
              {stats.messageCount > 0 && (
                <div style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>
                  当前已有 {stats.messageCount} 条消息、{stats.sessionCount} 个会话
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {filteredMemories.map((m) => {
            const colors = typeColors[m.memory_type] || { bg: '#f3f4f6', text: '#374151' }
            return (
              <div
                key={m.id}
                style={{
                  padding: '12px 16px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{
                    fontSize: '11px', padding: '1px 8px', borderRadius: '4px',
                    backgroundColor: colors.bg, color: colors.text, fontWeight: 500,
                  }}>
                    {m.memory_type}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    P{m.priority}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>|</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {formatTime(m.updated_at || m.created_at)}
                  </span>
                </div>
                <div style={{
                  fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: '120px', overflow: 'auto',
                }}>
                  {m.content}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MiniCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      padding: '12px 14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
    }}>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function formatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
