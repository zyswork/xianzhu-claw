/**
 * Agent 详情页 - 多 Tab 布局
 *
 * Tabs: 对话 | Soul | 工具 | MCP | Skills | 定时任务 | 设置
 * 复用已有的 SoulFileTab, ToolsTab, McpTab, ParamsTab 组件
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ breaks: true, gfm: true })

/** Markdown 渲染 */
function renderMd(text: string) {
  const html = marked.parse(text, { async: false }) as string
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['a','b','blockquote','br','code','del','div','em','h1','h2','h3','h4','hr','i','li','ol','p','pre','span','strong','table','tbody','td','th','thead','tr','ul','img'],
    ALLOWED_ATTR: ['class','href','rel','target','title','src','alt','start'],
  })
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: clean }} />
}
/** 思考中动画 */
function ThinkingIndicator() {
  const [dots, setDots] = useState('')
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const dotTimer = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500)
    const elapsedTimer = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => { clearInterval(dotTimer); clearInterval(elapsedTimer) }
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        backgroundColor: 'var(--accent)', animation: 'pulse 1.5s ease-in-out infinite',
      }} />
      <span>思考中{dots}</span>
      {elapsed > 3 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{elapsed}s</span>}
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }`}</style>
    </div>
  )
}

import SoulFileTab from '../components/SoulFileTab'
import ToolsTab from '../components/ToolsTab'
import ParamsTab from '../components/ParamsTab'
import McpTab from '../components/McpTab'

// ─── Types ───────────────────────────────────────────────────

interface Agent {
  id: string
  name: string
  model: string
  systemPrompt: string
  temperature: number | null
  maxTokens: number | null
  createdAt: number
  updatedAt: number
}

interface Session {
  id: string
  agentId: string
  title: string
  createdAt: number
  lastMessageAt: number | null
}

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
}

interface Skill {
  name: string
  description: string
  enabled: boolean
  path: string
}

interface CronJob {
  id: string
  name: string
  agentId: string
  schedule: { kind: string; expr?: string; secs?: number; tz?: string } | string
  jobType: string
  enabled: boolean
  failStreak: number
  nextRunAt: number | null
  lastRunAt: number | null
}

function formatSchedule(s: CronJob['schedule']): string {
  if (typeof s === 'string') return s
  if (s.kind === 'cron') return `cron: ${s.expr || ''}`
  if (s.kind === 'every') return `每 ${(s.secs || 0) / 60} 分钟`
  return JSON.stringify(s)
}

type TabId = 'chat' | 'soul' | 'tools' | 'mcp' | 'skills' | 'cron' | 'autonomy' | 'plugins' | 'settings' | 'subagents' | 'audit'

const TABS: { id: TabId; label: string }[] = [
  { id: 'chat', label: '对话' },
  { id: 'soul', label: 'Soul' },
  { id: 'tools', label: '工具' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'cron', label: '定时任务' },
  { id: 'autonomy', label: '自治' },
  { id: 'plugins', label: '插件' },
  { id: 'subagents', label: '子Agent' },
  { id: 'settings', label: '设置' },
  { id: 'audit', label: '审计' },
]

// ─── Main Component ──────────────────────────────────────────

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const navigate = useNavigate()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('chat')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!agentId) return
    ;(async () => {
      try {
        const agents = await invoke<Agent[]>('list_agents')
        const found = agents.find((a) => a.id === agentId)
        if (found) setAgent(found)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    })()
  }, [agentId])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>加载中...</div>
  if (!agent || !agentId) return <div style={{ padding: 40, textAlign: 'center' }}>Agent 不存在</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部：返回 + Agent 信息 */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={() => navigate('/agents')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-secondary)', padding: '4px 8px' }}
        >
          ←
        </button>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{agent.name}</h2>
          <span style={{
            fontSize: 12, padding: '2px 8px', borderRadius: 4,
            backgroundColor: 'var(--bg-glass)', color: 'var(--text-secondary)',
          }}>
            {agent.model}
          </span>
        </div>
      </div>

      {/* Tab 栏 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 24px' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 16px', border: 'none', cursor: 'pointer',
              fontSize: 14, backgroundColor: 'transparent',
              color: activeTab === tab.id ? '#007bff' : '#666',
              borderBottom: activeTab === tab.id ? '2px solid #007bff' : '2px solid transparent',
              fontWeight: activeTab === tab.id ? 600 : 400,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'chat' && <ChatTab agentId={agentId} />}
        {activeTab === 'soul' && <div style={{ padding: 16 }}><SoulFileTab agentId={agentId} /></div>}
        {activeTab === 'tools' && <div style={{ padding: 16 }}><ToolsTab agentId={agentId} /></div>}
        {activeTab === 'mcp' && <div style={{ padding: 16 }}><McpTab agentId={agentId} /></div>}
        {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
        {activeTab === 'cron' && <CronTab agentId={agentId} />}
        {activeTab === 'autonomy' && <AutonomyTab agentId={agentId} />}
        {activeTab === 'plugins' && <PluginsTab />}
        {activeTab === 'subagents' && <SubagentsTab agentId={agentId} />}
        {activeTab === 'audit' && <AuditTab agentId={agentId} />}
        {activeTab === 'settings' && <SettingsTab agentId={agentId} agent={agent} onUpdate={setAgent} onDelete={() => navigate('/agents')} />}
      </div>
    </div>
  )
}

// ─── Chat Tab ────────────────────────────────────────────────

function SessionItem({ s, activeSession, onSelect, onDelete, renamingSession, renameValue, setRenameValue, onStartRename, onFinishRename, onCancelRename, isSystem }: {
  s: Session; activeSession: string; onSelect: () => void; onDelete: () => void
  renamingSession: string; renameValue: string; setRenameValue: (v: string) => void
  onStartRename: () => void; onFinishRename: (v: string) => void; onCancelRename: () => void
  isSystem?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      padding: '8px 12px', cursor: 'pointer', fontSize: isSystem ? 12 : 13,
      backgroundColor: s.id === activeSession ? '#eff6ff' : 'transparent',
      borderBottom: '1px solid #f3f4f6',
      borderLeft: s.id === activeSession ? '3px solid var(--accent)' : '3px solid transparent',
      opacity: isSystem ? 0.7 : 1,
    }}>
      {renamingSession === s.id ? (
        <input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => onFinishRename(renameValue)}
          onKeyDown={(e) => { if (e.key === 'Enter') onFinishRename(renameValue); if (e.key === 'Escape') onCancelRename() }}
          style={{ flex: 1, padding: '2px 4px', border: '1px solid #3b82f6', borderRadius: 3, fontSize: 13, outline: 'none' }}
        />
      ) : (
        <div onClick={onSelect} onDoubleClick={onStartRename}
          style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={isSystem ? s.title : '双击重命名'}
        >
          {isSystem && <span style={{ color: 'var(--text-muted)', marginRight: 4 }}>&#x23F0;</span>}
          {s.title}
        </div>
      )}
      <button onClick={(e) => { e.stopPropagation(); onDelete() }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '0 4px', flexShrink: 0 }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#ef4444' }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#d1d5db' }}
        title="删除"
      >×</button>
    </div>
  )
}

/** 用户消息内容渲染（支持 ![图片](/path) 显示缩略图） */
function UserMessageContent({ content }: { content: string }) {
  // 检测 Markdown 图片引用: ![图片](/path/to/file.jpg)
  const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  const parts: Array<{ type: 'text' | 'image'; value: string }> = []
  let lastIdx = 0
  let match
  while ((match = imgRegex.exec(content)) !== null) {
    if (match.index > lastIdx) {
      const text = content.slice(lastIdx, match.index).trim()
      if (text) parts.push({ type: 'text', value: text })
    }
    parts.push({ type: 'image', value: match[2] })
    lastIdx = match.index + match[0].length
  }
  if (lastIdx < content.length) {
    const text = content.slice(lastIdx).trim()
    if (text) parts.push({ type: 'text', value: text })
  }

  if (parts.length === 0 || !parts.some(p => p.type === 'image')) {
    return <>{content}</>
  }

  return (
    <div>
      {parts.map((p, i) =>
        p.type === 'image' ? (
          <img
            key={i}
            src={convertLocalPath(p.value)}
            alt="图片"
            style={{ maxWidth: '100%', maxHeight: 300, borderRadius: 8, marginTop: 4, display: 'block' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <span key={i}>{p.value}</span>
        )
      )}
    </div>
  )
}

/** 把本地文件路径转为 Tauri asset URL */
function convertLocalPath(path: string): string {
  // Tauri 1.x: 用 tauri://localhost/asset/ 协议访问本地文件
  if (path.startsWith('/') || path.startsWith('~')) {
    const resolved = path.startsWith('~')
      ? path // Tauri 会解析 ~
      : path
    return `https://asset.localhost/${encodeURIComponent(resolved)}`
  }
  return path
}

/** 功能栏：消息计数 + 压缩按钮（带 loading 和结果提示） */
function ToolBar({ messageCount, showCompact, onCompact }: {
  messageCount: number; showCompact: boolean; onCompact: () => Promise<string>
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  const handleCompact = async () => {
    setStatus('loading')
    setMsg('')
    try {
      const r = await onCompact()
      setStatus('done')
      setMsg(r)
      setTimeout(() => { setStatus('idle'); setMsg('') }, 3000)
    } catch (e) {
      setStatus('error')
      setMsg('压缩失败: ' + e)
      setTimeout(() => { setStatus('idle'); setMsg('') }, 4000)
    }
  }

  return (
    <div style={{ padding: '4px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)' }}>
      <span>{messageCount} 条消息</span>
      {msg && (
        <span style={{ color: status === 'error' ? '#ef4444' : '#22c55e', fontSize: 11 }}>{msg}</span>
      )}
      <span style={{ flex: 1 }} />
      {showCompact && (
        <button
          onClick={handleCompact}
          disabled={status === 'loading'}
          style={{
            background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 4,
            padding: '2px 8px', fontSize: 11, cursor: status === 'loading' ? 'wait' : 'pointer',
            color: status === 'loading' ? '#d1d5db' : '#6b7280',
          }}
        >
          {status === 'loading' ? '压缩中...' : '压缩历史'}
        </button>
      )}
    </div>
  )
}

/** 格式化工具调用内容（尝试 JSON 美化） */
function formatToolContent(content: string): string {
  try {
    const parsed = JSON.parse(content)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return content
  }
}

const isSystemSession = (title: string) =>
  title.startsWith('cron-') || title.startsWith('[cron]') ||
  title.startsWith('heartbeat-') || title.startsWith('[heartbeat]')

function ChatTab({ agentId }: { agentId: string }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [renamingSession, setRenamingSession] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([]) // base64 data URLs
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showSystemSessions, setShowSystemSessions] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set())
  const toggleTool = (idx: number) => setExpandedTools(prev => {
    const next = new Set(prev)
    next.has(idx) ? next.delete(idx) : next.add(idx)
    return next
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 图片处理：文件→压缩后 base64（最大 1200px，JPEG 质量 0.7）
  const addImageFiles = (files: FileList | File[]) => {
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          const MAX_DIM = 1200
          let w = img.width, h = img.height
          if (w > MAX_DIM || h > MAX_DIM) {
            const scale = MAX_DIM / Math.max(w, h)
            w = Math.round(w * scale)
            h = Math.round(h * scale)
          }
          const canvas = document.createElement('canvas')
          canvas.width = w; canvas.height = h
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, w, h)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
          setPendingImages(prev => [...prev, dataUrl])
        }
        img.src = reader.result as string
      }
      reader.readAsDataURL(file)
    })
  }

  // 粘贴处理
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addImageFiles(imageFiles)
    }
  }

  // 拖拽处理
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files.length > 0) {
      addImageFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')))
    }
  }
  const streamBuf = useRef('')

  const loadSessions = useCallback(async () => {
    try {
      const result = await invoke<Session[]>('list_sessions', { agentId })
      setSessions(result)
      if (result.length > 0 && !activeSession) {
        setActiveSession(result[0].id)
      }
    } catch (e) { console.error(e) }
  }, [agentId, activeSession])

  useEffect(() => { loadSessions() }, [loadSessions])

  const loadMessages = useCallback(async () => {
    if (!activeSession) return
    try {
      const structured = await invoke<any[]>('load_structured_messages', { sessionId: activeSession, limit: 50 })
      if (structured && structured.length > 0) {
        const parsed: Message[] = []
        for (const m of structured) {
          if (m.role === 'system') continue
          if (m.role === 'tool') {
            parsed.push({ role: 'tool', content: m.content || '', toolName: m.name || '工具' })
          } else if (m.role === 'assistant' && m.tool_calls) {
            if (m.content) parsed.push({ role: 'assistant', content: m.content })
            for (const tc of (Array.isArray(m.tool_calls) ? m.tool_calls : [])) {
              parsed.push({ role: 'tool', content: '', toolName: tc.function?.name || tc.name || '工具' })
            }
          } else {
            parsed.push({ role: m.role, content: m.content || '' })
          }
        }
        setMessages(parsed)
      } else {
        const msgs = await invoke<Message[]>('get_session_messages', { agentId, sessionId: activeSession })
        setMessages(msgs)
      }
    } catch (e) { console.error(e) }
  }, [agentId, activeSession])

  useEffect(() => { loadMessages() }, [loadMessages])

  // 定时检查当前会话是否有新消息（兼容 Telegram/外部消息）
  useEffect(() => {
    if (!activeSession || streaming) return
    const msgCountRef = { current: messages.length }
    const interval = setInterval(async () => {
      try {
        const structured = await invoke<any[]>('load_structured_messages', { sessionId: activeSession, limit: 50 })
        const newCount = structured?.length || 0
        if (newCount !== msgCountRef.current) {
          msgCountRef.current = newCount
          loadMessagesRef.current()
        }
      } catch { /* ignore */ }
    }, 3000) // 每 3 秒检查一次
    return () => clearInterval(interval)
  }, [activeSession, streaming])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 用 ref 跟踪最新的 activeSession（避免闭包陷阱）
  const activeSessionRef = useRef(activeSession)
  useEffect(() => { activeSessionRef.current = activeSession }, [activeSession])
  const loadSessionsRef = useRef(loadSessions)
  useEffect(() => { loadSessionsRef.current = loadSessions }, [loadSessions])

  // 统一事件监听（参考 OpenClaw：事件直接携带消息内容，带 sessionId 过滤）
  useEffect(() => {
    // 桌面对话的流式 token（无 sessionId，来自 main.rs 的 send_message）
    const unlisten1 = listen<string>('llm-token', (e) => {
      streamBuf.current += e.payload
      setMessages((prev) => {
        const copy = [...prev]
        if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: streamBuf.current }
        }
        return copy
      })
    })
    const unlisten2 = listen('llm-done', () => {
      setStreaming(false)
      streamBuf.current = ''
    })
    const unlisten3 = listen<string>('llm-error', (e) => {
      setStreaming(false)
      streamBuf.current = ''
      setMessages((prev) => [...prev, { role: 'system', content: `错误: ${e.payload}` }])
    })

    // 外部消息事件（Telegram/Mobile）— 带 sessionId 和消息内容
    const unlisten4 = listen<any>('chat-event', (e) => {
      const { type, sessionId, role, content, source } = e.payload || {}

      // 始终刷新会话列表（新消息可能创建了新 session）
      if (type === 'message' || type === 'done') {
        loadSessionsRef.current()
      }

      // 只处理当前正在查看的 session
      if (sessionId !== activeSessionRef.current) return

      switch (type) {
        case 'message':
          // 外部用户消息直接追加（不读 DB）
          setMessages((prev) => [...prev, { role: role || 'user', content: content || '' }])
          break

        case 'thinking':
          // 追加空的 assistant 消息（显示思考动画）
          setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
          setStreaming(true)
          break

        case 'token':
          // 流式更新最后一条 assistant 消息
          setMessages((prev) => {
            const copy = [...prev]
            if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: content || '' }
            }
            return copy
          })
          break

        case 'done':
          // 完成：更新最后一条为完整回复
          setStreaming(false)
          setMessages((prev) => {
            const copy = [...prev]
            if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') {
              copy[copy.length - 1] = { ...copy[copy.length - 1], content: content || '' }
            } else {
              copy.push({ role: 'assistant', content: content || '' })
            }
            return copy
          })
          break
      }
    })

    return () => {
      unlisten1.then((f) => f())
      unlisten2.then((f) => f())
      unlisten3.then((f) => f())
      unlisten4.then((f) => f())
    }
  }, [])

  const createSession = async () => {
    try {
      const session = await invoke<Session>('create_session', {
        agentId,
        title: `对话 ${sessions.length + 1}`,
      })
      setSessions((prev) => [session, ...prev])
      setActiveSession(session.id)
      setMessages([])
    } catch (e) { console.error(e) }
  }

  const renameSession = async (sessionId: string, newTitle: string) => {
    if (!newTitle.trim()) { setRenamingSession(''); return }
    try {
      await invoke('rename_session', { sessionId, title: newTitle.trim() })
      setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, title: newTitle.trim() } : s))
    } catch (e) { console.error(e) }
    setRenamingSession('')
  }

  const deleteSession = async (sessionId: string) => {
    if (!confirm('确定要删除这个对话吗？')) return
    try {
      await invoke('delete_session', { sessionId })
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (activeSession === sessionId) {
        setActiveSession('')
        setMessages([])
      }
    } catch (e) { console.error(e) }
  }

  // ─── 斜杠命令处理 ─────────────────────────────
  const handleSlashCommand = async (cmd: string, args: string): Promise<string | null> => {
    switch (cmd) {
      case 'help':
        return `## 可用命令

**会话**
- \`/new\` — 新建会话
- \`/clear\` — 清空当前会话历史
- \`/compact\` — 压缩上下文（减少 Token 消耗）
- \`/rename <名称>\` — 重命名当前会话

**模型**
- \`/model\` — 查看当前模型
- \`/model <名称>\` — 切换模型
- \`/temp <0-2>\` — 调整温度

**信息**
- \`/status\` — 系统状态
- \`/usage\` — Token 用量
- \`/tools\` — 列出可用工具
- \`/skills\` — 列出已安装技能
- \`/providers\` — 列出供应商配置
- \`/memory\` — 查看记忆统计
- \`/sessions\` — 列出所有会话

**Agent**
- \`/agents\` — 列出所有 Agent
- \`/kill <id|all>\` — 终止子 Agent
- \`/skill [名称]\` — 查看/激活技能

**操作**
- \`/stop\` — 停止当前生成
- \`/reset\` — 重置会话
- \`/export\` — 导出对话为 Markdown`

      case 'new':
        await createSession()
        return '已创建新会话'

      case 'clear':
        if (activeSession) {
          await invoke('clear_history', { sessionId: activeSession })
          setMessages([])
          return '历史已清空'
        }
        return '没有活跃的会话'

      case 'compact':
        if (activeSession) {
          try {
            const r = await invoke<string>('compact_session', { agentId, sessionId: activeSession })
            return r
          } catch (e) { return '压缩失败: ' + e }
        }
        return '没有活跃的会话'

      case 'rename': {
        if (!args.trim()) return '用法: /rename <新名称>'
        if (activeSession) {
          await invoke('rename_session', { sessionId: activeSession, title: args.trim() })
          setSessions((prev) => prev.map((s) => s.id === activeSession ? { ...s, title: args.trim() } : s))
          return `会话已重命名为「${args.trim()}」`
        }
        return '没有活跃的会话'
      }

      case 'model': {
        if (!args.trim()) {
          try {
            const detail = await invoke<any>('get_agent_detail', { agentId })
            return `当前模型: **${detail?.model}**\n温度: ${detail?.temperature ?? '默认'}\nMax Tokens: ${detail?.maxTokens ?? '默认'}`
          } catch (e) { return '查询失败: ' + e }
        }
        try {
          await invoke('update_agent', { agentId, model: args.trim() })
          return `模型已切换为 **${args.trim()}**`
        } catch (e) { return '切换失败: ' + e }
      }

      case 'temp': {
        const t = parseFloat(args)
        if (isNaN(t) || t < 0 || t > 2) return '用法: /temp <0-2>，如 /temp 0.7'
        try {
          await invoke('update_agent', { agentId, temperature: t })
          return `温度已调整为 **${t}**`
        } catch (e) { return '调整失败: ' + e }
      }

      case 'status': {
        try {
          const h = await invoke<any>('health_check')
          return `## 系统状态\n- 状态: ${h.status}\n- Agent: ${h.agents} 个\n- 记忆: ${h.memories} 条\n- 今日 Token: ${h.today_tokens?.toLocaleString()}\n- 响应缓存: ${h.response_cache_entries} 条`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'usage': {
        try {
          const stats = await invoke<any>('get_token_stats', { agentId, days: 7 })
          const total = stats?.totalTokens || 0
          const cost = stats?.estimatedCost || 0
          return `## Token 用量（近 7 天）\n- 总计: ${total.toLocaleString()} tokens\n- 输入: ${(stats?.inputTokens || 0).toLocaleString()}\n- 输出: ${(stats?.outputTokens || 0).toLocaleString()}\n- 估计费用: $${cost.toFixed(4)}`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'tools': {
        try {
          const detail = await invoke<any>('get_agent_detail', { agentId })
          return `## 可用工具 (${detail?.toolCount || 0} 个)\n\n工具通过 API tools 参数传递给 LLM，包括内置工具 + MCP 工具 + 技能工具`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'skills': {
        try {
          const list = await invoke<any[]>('list_skills', { agentId })
          if (!list?.length) return '暂无已安装技能'
          return `## 已安装技能 (${list.length} 个)\n\n${list.map((s: any) => `- **${s.name}** ${s.enabled ? '✓' : '✗'} ${s.description || ''}`).join('\n')}`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'providers': {
        try {
          const providers = await invoke<any[]>('get_providers')
          return `## 供应商配置 (${providers?.length || 0} 个)\n\n${(providers || []).map((p: any) => {
            const hasKey = p.apiKey && p.apiKey.length > 0
            const models = (p.models || []).map((m: any) => m.name || m.id).join(', ')
            return `- **${p.name}** (${p.apiType}) ${p.enabled ? '✓' : '✗'} Key:${hasKey ? '有' : '无'}\n  模型: ${models || '无'}\n  URL: ${p.baseUrl || '默认'}`
          }).join('\n')}`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'memory': {
        try {
          const detail = await invoke<any>('get_agent_detail', { agentId })
          return `## 记忆统计\n- 记忆: ${detail?.memories?.length || 0} 条\n- 向量: ${detail?.vectorCount || 0} 条\n- 嵌入缓存: ${detail?.embeddingCacheCount || 0} 条\n- 会话: ${detail?.sessionCount || 0} 个\n- 消息: ${detail?.messageCount || 0} 条`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'sessions': {
        return `## 会话列表 (${sessions.length} 个)\n\n${sessions.map((s) => {
          const active = s.id === activeSession ? ' ← 当前' : ''
          const sys = isSystemSession(s.title) ? ' [系统]' : ''
          return `- ${s.title}${sys}${active}`
        }).join('\n')}`
      }

      case 'reset': {
        if (activeSession) {
          await invoke('clear_history', { sessionId: activeSession })
          setMessages([])
          return '会话已重置（历史已清空，会话保留）'
        }
        return '没有活跃的会话'
      }

      case 'stop': {
        if (streaming) {
          setStreaming(false)
          streamBuf.current = ''
          return '已停止生成'
        }
        return '当前没有正在生成的回复'
      }

      case 'export': {
        if (!activeSession || messages.length === 0) return '没有可导出的消息'
        const md = messages.map((m) => {
          if (m.role === 'user') return `**用户:** ${m.content}`
          if (m.role === 'assistant') return `**助手:** ${m.content}`
          if (m.role === 'tool') return `> 🔧 ${m.toolName}: ${m.content}`
          return `> ${m.content}`
        }).join('\n\n---\n\n')
        const title = sessions.find(s => s.id === activeSession)?.title || '对话'
        const blob = new Blob([`# ${title}\n\n${md}`], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `${title}.md`; a.click()
        URL.revokeObjectURL(url)
        return `已导出为 ${title}.md`
      }

      case 'agents': {
        try {
          const list = await invoke<any[]>('list_agents')
          if (!list?.length) return '暂无 Agent'
          return `## Agent 列表 (${list.length} 个)\n\n${list.map((a: any) =>
            `- **${a.name}** (\`${a.model}\`) ID: \`${a.id?.substring(0, 8)}...\``
          ).join('\n')}`
        } catch (e) { return '查询失败: ' + e }
      }

      case 'kill': {
        if (!args.trim()) return '用法: /kill <id|all>'
        try {
          const subagents = await invoke<any[]>('list_subagents', { agentId })
          const running = subagents?.filter((s: any) => s.status === 'Running') || []
          if (running.length === 0) return '没有运行中的子 Agent'
          if (args.trim().toLowerCase() === 'all') {
            for (const sa of running) { await invoke('cancel_subagent', { subagentId: sa.id }) }
            return `已终止 ${running.length} 个子 Agent`
          }
          const target = running.find((s: any) => s.id.startsWith(args.trim()) || s.name === args.trim())
          if (!target) return `未找到匹配的子 Agent: ${args.trim()}`
          await invoke('cancel_subagent', { subagentId: target.id })
          return `已终止子 Agent: ${target.name}`
        } catch (e) { return '终止失败: ' + e }
      }

      case 'skill': {
        if (!args.trim()) {
          try {
            const list = await invoke<any[]>('list_skills', { agentId })
            if (!list?.length) return '暂无技能。用法: /skill <名称>'
            return `可用技能:\n${list.map((s: any) => `- ${s.name} ${s.enabled ? '✓' : '✗'}`).join('\n')}\n\n用法: /skill <名称> 来激活技能`
          } catch (e) { return '查询失败: ' + e }
        }
        // 激活技能（发送带技能关键词的消息给 LLM）
        return null // 返回 null 让消息走正常 LLM 流程，技能会被 skill_mgr.activate_for_message 匹配
      }

      default:
        return `未知命令: /${cmd}\n输入 /help 查看所有可用命令`
    }
  }

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || streaming || !activeSession) return
    const userMsg = input.trim()
    setInput('')

    // 把待发送图片拼为 attachment 标记
    let fullMessage = userMsg
    if (pendingImages.length > 0) {
      const attachments = pendingImages.map(img => `[attachment:${img}]`).join('\n')
      fullMessage = fullMessage ? `${fullMessage}\n${attachments}` : attachments
      setPendingImages([])
    }

    // 斜杠命令拦截
    if (userMsg.startsWith('/')) {
      const spaceIdx = userMsg.indexOf(' ')
      const cmd = spaceIdx > 0 ? userMsg.substring(1, spaceIdx) : userMsg.substring(1)
      const cmdArgs = spaceIdx > 0 ? userMsg.substring(spaceIdx + 1) : ''
      const result = await handleSlashCommand(cmd.toLowerCase(), cmdArgs)
      if (result !== null) {
        // 命令处理了，显示结果
        setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
        setMessages((prev) => [...prev, { role: 'system', content: result }])
        return
      }
      // result === null: 命令要求走正常 LLM 流程（如 /skill <name>）
    }

    // 前端显示不含 base64（防止渲染卡死），只显示文字 + 图片标记
    const displayMsg = pendingImages.length > 0
      ? (userMsg ? `${userMsg}\n[图片 x ${pendingImages.length}]` : `[图片 x ${pendingImages.length}]`)
      : userMsg
    setMessages((prev) => [...prev, { role: 'user', content: displayMsg }])
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])
    setStreaming(true)
    streamBuf.current = ''

    try {
      await invoke('send_message', {
        agentId,
        sessionId: activeSession,
        message: fullMessage,
      })
      // invoke 完成意味着 orchestrator 已结束，兜底清除 streaming 状态
      // （llm-done 事件可能因竞态尚未到达）
      setStreaming(false)
      // 如果 AI 返回空内容，移除空的 assistant 气泡
      setMessages((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].content) {
          return prev.slice(0, -1)
        }
        return prev
      })
    } catch (e) {
      setStreaming(false)
      setMessages((prev) => [...prev, { role: 'system', content: String(e) }])
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 会话列表 */}
      <div style={{ width: 200, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 8 }}>
          <button onClick={createSession} style={{
            width: '100%', padding: '8px', backgroundColor: 'var(--accent)', color: 'white',
            border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
          }}>
            + 新对话
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* 用户对话 */}
          {sessions.filter(s => !isSystemSession(s.title)).map((s) => (
            <SessionItem key={s.id} s={s} activeSession={activeSession}
              onSelect={() => { setActiveSession(s.id); setMessages([]) }}
              onDelete={() => deleteSession(s.id)}
              renamingSession={renamingSession} renameValue={renameValue}
              setRenameValue={setRenameValue}
              onStartRename={() => { setRenamingSession(s.id); setRenameValue(s.title) }}
              onFinishRename={(v: string) => renameSession(s.id, v)}
              onCancelRename={() => setRenamingSession('')}
            />
          ))}

          {/* 系统对话（cron/heartbeat）折叠区 */}
          {sessions.some(s => isSystemSession(s.title)) && (
            <>
              <div
                onClick={() => setShowSystemSessions(!showSystemSessions)}
                style={{
                  padding: '6px 12px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer',
                  borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <span style={{ fontSize: 10 }}>{showSystemSessions ? '▼' : '▶'}</span>
                系统会话 ({sessions.filter(s => isSystemSession(s.title)).length})
                <span style={{ flex: 1 }} />
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!confirm('清理 7 天前的系统会话？')) return
                    try {
                      const r = await invoke<any>('cleanup_system_sessions', { agentId, keepDays: 7 })
                      alert(`已清理 ${r.deletedSessions} 个会话, ${r.deletedMessages} 条消息`)
                      loadSessions()
                    } catch (err) { alert('清理失败: ' + err) }
                  }}
                  style={{ fontSize: 10, padding: '1px 6px', border: '1px solid var(--border-subtle)', borderRadius: 3, background: 'var(--bg-elevated)', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  清理
                </button>
              </div>
              {showSystemSessions && sessions.filter(s => isSystemSession(s.title)).map((s) => (
                <SessionItem key={s.id} s={s} activeSession={activeSession}
                  onSelect={() => { setActiveSession(s.id); setMessages([]) }}
                  onDelete={() => deleteSession(s.id)}
                  renamingSession={renamingSession} renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  onStartRename={() => { setRenamingSession(s.id); setRenameValue(s.title) }}
                  onFinishRename={(v: string) => renameSession(s.id, v)}
                  onCancelRename={() => setRenamingSession('')}
                  isSystem
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* 对话区（整个区域支持拖拽图片） */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy' }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation() }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e) }}
      >
        {!activeSession ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            选择或创建一个对话
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {messages.map((msg, i) => {
                // 工具调用标记（历史加载的结构化消息）
                if (msg.role === 'tool') {
                  const isExpanded = expandedTools.has(i)
                  return (
                    <div key={i} style={{ marginBottom: 6 }}>
                      <div
                        onClick={() => toggleTool(i)}
                        style={{
                          padding: '3px 10px', borderRadius: isExpanded ? '6px 6px 0 0' : 6,
                          backgroundColor: 'var(--warning-bg)', border: '1px solid rgba(251,191,36,0.3)',
                          fontSize: 12, color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: 5,
                          cursor: 'pointer', userSelect: 'none',
                        }}
                      >
                        <span style={{ flexShrink: 0, fontSize: 11, color: '#bbb' }}>{isExpanded ? '\u25BC' : '\u25B6'}</span>
                        <span style={{ flexShrink: 0 }}>{'\u{1F527}'}</span>
                        <strong style={{ flexShrink: 0 }}>{msg.toolName || '工具'}</strong>
                        {!isExpanded && msg.content && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {msg.content.slice(0, 80)}
                          </span>
                        )}
                      </div>
                      {isExpanded && msg.content && (
                        <div style={{
                          padding: '6px 10px', backgroundColor: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderTop: 'none',
                          borderRadius: '0 0 6px 6px', fontSize: 11, lineHeight: 1.4, maxWidth: '80%',
                        }}>
                          <pre style={{
                            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            fontFamily: "'SF Mono', Monaco, monospace", fontSize: 11,
                            color: 'var(--text-secondary)', maxHeight: 200, overflow: 'auto',
                          }}>
                            {formatToolContent(msg.content)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )
                }

                // assistant 消息：分离内嵌的 [工具: xxx] 标记
                if (msg.role === 'assistant' && msg.content) {
                  const toolPattern = /\n?\[(?:工具|MCP 工具|技能工具): (.+?) 执行中\.\.\.\]\n?/g
                  const parts: Array<{ type: 'text' | 'tool'; content: string }> = []
                  let lastIdx = 0
                  let match
                  while ((match = toolPattern.exec(msg.content)) !== null) {
                    if (match.index > lastIdx) {
                      const text = msg.content.slice(lastIdx, match.index).trim()
                      if (text) parts.push({ type: 'text', content: text })
                    }
                    parts.push({ type: 'tool', content: match[1] })
                    lastIdx = match.index + match[0].length
                  }
                  if (lastIdx < msg.content.length) {
                    const text = msg.content.slice(lastIdx).trim()
                    if (text) parts.push({ type: 'text', content: text })
                  }

                  // 如果有工具标记，分段渲染
                  if (parts.length > 1 || (parts.length === 1 && parts[0].type === 'tool')) {
                    return (
                      <div key={i} style={{ marginBottom: 12 }}>
                        {parts.map((part, pi) =>
                          part.type === 'tool' ? (
                            <div key={pi} style={{ marginBottom: 6 }}>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '4px 10px', borderRadius: 6,
                                backgroundColor: 'var(--warning-bg)', border: '1px solid rgba(251,191,36,0.3)',
                                fontSize: 12, color: 'var(--warning)',
                              }}>
                                {'\u{1F527}'} <strong>{part.content}</strong>
                              </span>
                            </div>
                          ) : (
                            <div key={pi} style={{
                              maxWidth: '70%', padding: '10px 14px', borderRadius: 12,
                              backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)',
                              fontSize: 14, lineHeight: 1.6, wordBreak: 'break-word',
                              marginBottom: 4,
                            }}>
                              {renderMd(part.content)}
                            </div>
                          )
                        )}
                        {streaming && i === messages.length - 1 && !parts.some(p => p.type === 'text') && <ThinkingIndicator />}
                      </div>
                    )
                  }
                }

                const isUser = msg.role === 'user'
                const isSystem = msg.role === 'system'
                const avatar = isUser ? '/avatar-user.png' : '/avatar-ai.png'

                return (
                  <div key={i} style={{
                    marginBottom: 12, display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                    alignItems: 'flex-start', gap: 8,
                  }}>
                    {/* 左侧头像（AI / system） */}
                    {!isUser && (
                      <img src={avatar} alt="" style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                        objectFit: 'cover',
                      }} />
                    )}
                    <div style={{
                      maxWidth: isSystem ? '85%' : '70%',
                      padding: '10px 14px', borderRadius: 12,
                      backgroundColor: isUser ? '#3b82f6' : isSystem ? '#f0fdf4' : '#f3f4f6',
                      color: isUser ? 'white' : '#333',
                      border: isSystem ? '1px solid #bbf7d0' : 'none',
                      fontSize: isSystem ? 13 : 14,
                      lineHeight: 1.6, wordBreak: 'break-word',
                      minWidth: streaming && i === messages.length - 1 && !msg.content ? 120 : undefined,
                    }}>
                      {(msg.role === 'assistant' || isSystem) ? (
                        msg.content
                          ? renderMd(msg.content)
                          : streaming && i === messages.length - 1
                            ? <ThinkingIndicator />
                            : null
                      ) : (
                        <UserMessageContent content={msg.content || ''} />
                      )}
                    </div>
                    {/* 右侧头像（用户） */}
                    {isUser && (
                      <img src={avatar} alt="" style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                        objectFit: 'cover',
                      }} />
                    )}
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
            {/* 功能栏 */}
            <ToolBar
              messageCount={messages.filter(m => m.role !== 'system').length}
              showCompact={messages.length > 20}
              onCompact={async () => {
                const r = await invoke<string>('compact_session', { agentId, sessionId: activeSession })
                return r
              }}
            />
            {/* 命令提示 */}
            {input.startsWith('/') && !input.includes(' ') && (
              <div style={{
                padding: '8px 16px', borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-glass)',
                fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '4px 12px',
              }}>
                {['/help','/new','/model','/status','/usage','/tools','/skills','/providers','/memory','/compact','/clear','/reset','/export','/stop','/agents','/kill','/rename','/sessions','/skill'].filter(c =>
                  c.startsWith(input.toLowerCase())
                ).map(c => (
                  <span key={c} onClick={() => { setInput(c === '/model' || c === '/rename' || c === '/temp' || c === '/kill' || c === '/skill' ? c + ' ' : c); }} style={{ cursor: 'pointer', color: '#3b82f6', fontFamily: 'monospace', padding: '2px 6px', backgroundColor: 'var(--accent-bg)', borderRadius: 4 }}>{c}</span>
                ))}
              </div>
            )}
            {/* 附件预览 */}
            {pendingImages.length > 0 && (
              <div style={{ padding: '6px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {pendingImages.map((img, idx) => (
                  <div key={idx} style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={img} alt="" style={{ height: 48, borderRadius: 6, border: '1px solid var(--border-subtle)' }} />
                    <button
                      onClick={() => setPendingImages(prev => prev.filter((_, i) => i !== idx))}
                      style={{
                        position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                        borderRadius: '50%', backgroundColor: '#ef4444', color: 'white',
                        border: 'none', fontSize: 10, cursor: 'pointer', lineHeight: '18px', padding: 0,
                      }}
                    >x</button>
                  </div>
                ))}
              </div>
            )}
            {/* 输入区 */}
            <div
              style={{ padding: '10px 16px', borderTop: '1px solid var(--border-subtle)' }}
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming}
                  title="添加图片"
                  style={{
                    padding: '8px', backgroundColor: 'transparent', border: '1px solid #d1d5db',
                    borderRadius: 6, cursor: 'pointer', fontSize: 16, lineHeight: 1, color: 'var(--text-secondary)', flexShrink: 0,
                  }}
                >{'\u{1F4CE}'}</button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files) addImageFiles(e.target.files); e.target.value = '' }}
                />
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend() } }}
                  onPaste={handlePaste}
                  placeholder="输入消息... (/ 查看命令，可粘贴图片)"
                  disabled={streaming}
                  style={{ flex: 1, padding: '10px', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 14 }}
                />
                <button
                  onClick={handleSend}
                  disabled={streaming || !input.trim()}
                  style={{
                    padding: '10px 20px', backgroundColor: 'var(--accent)', color: 'white',
                    border: 'none', borderRadius: 6, cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
                    opacity: streaming || !input.trim() ? 0.6 : 1,
                  }}
                >
                  {streaming ? '生成中...' : '发送'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Skills Tab ──────────────────────────────────────────────

function SkillsTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [installUrl, setInstallUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadSkills = useCallback(async () => {
    try {
      const result = await invoke<Skill[]>('list_skills', { agentId })
      setSkills(result)
    } catch (e) { setError(String(e)) }
  }, [agentId])

  useEffect(() => { loadSkills() }, [loadSkills])

  const handleInstall = async () => {
    if (!installUrl.trim()) return
    setLoading(true)
    setError('')
    try {
      await invoke('install_skill', { agentId, filePath: installUrl.trim() })
      setInstallUrl('')
      loadSkills()
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      await invoke('toggle_skill', { agentId, skillName: name, enabled: !enabled })
      loadSkills()
    } catch (e) { setError(String(e)) }
  }

  const handleRemove = async (name: string) => {
    try {
      await invoke('remove_skill', { agentId, skillName: name })
      loadSkills()
    } catch (e) { setError(String(e)) }
  }

  return (
    <div style={{ padding: 20, maxWidth: 600 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>Skills 管理</h3>
      {error && <div style={{ padding: 8, backgroundColor: 'var(--error-bg)', color: 'var(--error)', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          value={installUrl}
          onChange={(e) => setInstallUrl(e.target.value)}
          placeholder="输入 Skill URL 或路径..."
          style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 13 }}
        />
        <button
          onClick={handleInstall}
          disabled={loading || !installUrl.trim()}
          style={{
            padding: '8px 16px', backgroundColor: 'var(--accent)', color: 'white',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            opacity: loading || !installUrl.trim() ? 0.6 : 1,
          }}
        >
          {loading ? '安装中...' : '安装'}
        </button>
      </div>

      {skills.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无已安装的 Skill</div>
      ) : (
        skills.map((skill) => (
          <div key={skill.name} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', border: '1px solid var(--border-subtle)', borderRadius: 8, marginBottom: 8,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>{skill.name}</div>
              {skill.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{skill.description}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => handleToggle(skill.name, skill.enabled)}
                style={{
                  padding: '4px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  border: '1px solid var(--border-subtle)', backgroundColor: skill.enabled ? '#dcfce7' : '#f3f4f6',
                  color: skill.enabled ? '#16a34a' : '#666',
                }}
              >
                {skill.enabled ? '已启用' : '已禁用'}
              </button>
              <button
                onClick={() => handleRemove(skill.name)}
                style={{
                  padding: '4px 10px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                  border: '1px solid #fecaca', backgroundColor: 'var(--error-bg)', color: 'var(--error)',
                }}
              >
                删除
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Cron Tab ────────────────────────────────────────────────

function CronTab({ agentId }: { agentId: string }) {
  const [jobs, setJobs] = useState<CronJob[]>([])
  const [error, setError] = useState('')

  const loadJobs = useCallback(async () => {
    try {
      const result = await invoke<CronJob[]>('list_cron_jobs', { agentId })
      setJobs(result)
    } catch (e) { setError(String(e)) }
  }, [agentId])

  useEffect(() => { loadJobs() }, [loadJobs])

  const handleTrigger = async (jobId: string) => {
    try {
      await invoke('trigger_cron_job', { jobId })
      loadJobs()
    } catch (e) { setError(String(e)) }
  }

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      if (enabled) await invoke('pause_cron_job', { jobId })
      else await invoke('resume_cron_job', { jobId })
      loadJobs()
    } catch (e) { setError(String(e)) }
  }

  const handleDelete = async (jobId: string) => {
    try {
      await invoke('delete_cron_job', { jobId })
      loadJobs()
    } catch (e) { setError(String(e)) }
  }

  const formatTime = (ts: number | null) => {
    if (!ts) return '-'
    return new Date(ts).toLocaleString('zh-CN')
  }

  return (
    <div style={{ padding: 20, maxWidth: 800 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>定时任务</h3>
      {error && <div style={{ padding: 8, backgroundColor: 'var(--error-bg)', color: 'var(--error)', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{error}</div>}

      {jobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>该 Agent 暂无定时任务</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>名称</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>计划</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>下次执行</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>状态</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '10px 12px' }}>{job.name}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{formatSchedule(job.schedule)}</td>
                <td style={{ padding: '10px 12px', fontSize: 12 }}>{formatTime(job.nextRunAt ?? (job as any).next_run_at)}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11,
                    backgroundColor: job.enabled ? '#dcfce7' : '#f3f4f6',
                    color: job.enabled ? '#16a34a' : '#666',
                  }}>
                    {job.enabled ? '运行中' : '已暂停'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button onClick={() => handleTrigger(job.id)} style={{ padding: '3px 8px', fontSize: 11, border: '1px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer', backgroundColor: 'white' }}>触发</button>
                    <button onClick={() => handleToggle(job.id, job.enabled)} style={{ padding: '3px 8px', fontSize: 11, border: '1px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer', backgroundColor: 'white' }}>{job.enabled ? '暂停' : '恢复'}</button>
                    <button onClick={() => handleDelete(job.id)} style={{ padding: '3px 8px', fontSize: 11, border: '1px solid #fecaca', borderRadius: 4, cursor: 'pointer', backgroundColor: 'var(--error-bg)', color: 'var(--error)' }}>删除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Settings Tab ────────────────────────────────────────────

function SettingsTab({ agentId, agent, onUpdate, onDelete }: {
  agentId: string
  agent: Agent
  onUpdate: (a: Agent) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(agent.name)
  const [model, setModel] = useState(agent.model)
  const [temperature, setTemperature] = useState(agent.temperature ?? 0.7)
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens ?? 2048)
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const providers = await invoke<any[]>('get_providers')
        const list: { id: string; label: string }[] = []
        for (const p of providers) {
          if (!p.enabled) continue
          for (const m of (p.models || [])) {
            list.push({ id: m.id, label: `${m.name || m.id} (${p.name})` })
          }
        }
        setModels(list)
      } catch (e) { console.error(e) }
    })()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      await invoke('update_agent', {
        agentId,
        name: name !== agent.name ? name : null,
        model: model !== agent.model ? model : null,
        temperature: temperature !== agent.temperature ? temperature : null,
        maxTokens: maxTokens !== agent.maxTokens ? maxTokens : null,
      })
      onUpdate({ ...agent, name, model, temperature, maxTokens })
      setMsg('保存成功')
    } catch (e) { setMsg(String(e)) }
    finally { setSaving(false) }
  }

  const handleDelete = async () => {
    try {
      await invoke('delete_agent', { agentId })
      onDelete()
    } catch (e) { setMsg(String(e)) }
  }

  return (
    <div style={{ padding: 20, maxWidth: 500 }}>
      <h3 style={{ margin: '0 0 20px', fontSize: 16 }}>Agent 设置</h3>

      {msg && <div style={{ padding: 8, backgroundColor: msg === '保存成功' ? '#dcfce7' : '#fef2f2', color: msg === '保存成功' ? '#16a34a' : '#dc2626', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{msg}</div>}

      {/* 名称 */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>名称</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }} />
      </div>

      {/* 模型 */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>模型</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          {!models.find((m) => m.id === model) && <option value={model}>{model}</option>}
        </select>
      </div>

      {/* Temperature */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Temperature: {temperature.toFixed(1)}</label>
        <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} style={{ width: '100%' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>精确 0</span><span>平衡 0.7</span><span>创意 2.0</span>
        </div>
      </div>

      {/* Max Tokens */}
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Max Tokens: {maxTokens}</label>
        <input type="range" min="256" max="8192" step="256" value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value))} style={{ width: '100%' }} />
      </div>

      {/* 保存 */}
      <button onClick={handleSave} disabled={saving} style={{
        width: '100%', padding: '10px', backgroundColor: 'var(--accent)', color: 'white',
        border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, marginBottom: 32,
        opacity: saving ? 0.6 : 1,
      }}>
        {saving ? '保存中...' : '保存设置'}
      </button>

      {/* 危险区域 */}
      <div style={{ borderTop: '1px solid #fecaca', paddingTop: 20 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--error)' }}>危险操作</h4>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>删除 Agent 将同时删除所有对话记录、记忆和工作区文件。</p>
        {!deleteConfirm ? (
          <button onClick={() => setDeleteConfirm(true)} style={{
            padding: '8px 16px', backgroundColor: 'white', color: 'var(--error)',
            border: '1px solid #fecaca', borderRadius: 6, cursor: 'pointer', fontSize: 13,
          }}>
            删除此 Agent
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleDelete} style={{
              padding: '8px 16px', backgroundColor: '#dc2626', color: 'white',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}>
              确认删除
            </button>
            <button onClick={() => setDeleteConfirm(false)} style={{
              padding: '8px 16px', backgroundColor: 'var(--bg-glass)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer', fontSize: 13,
            }}>
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Audit Tab ───────────────────────────────────────────────

interface AuditEntry {
  id: string
  toolName: string
  arguments: string
  result: string | null
  success: boolean
  policyDecision: string
  policySource: string
  durationMs: number
  createdAt: number
}

function AuditTab({ agentId }: { agentId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke<AuditEntry[]>('get_audit_log', { agentId, limit: 100 })
        setEntries(result)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    })()
  }, [agentId])

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div style={{ padding: 20, maxWidth: 900 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>工具调用审计日志</h3>
      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无审计记录</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>时间</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>工具</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>策略</th>
              <th style={{ textAlign: 'left', padding: '8px 12px' }}>结果</th>
              <th style={{ textAlign: 'right', padding: '8px 12px' }}>耗时</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                  {new Date(entry.createdAt).toLocaleString('zh-CN')}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace' }}>{entry.toolName}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: 11,
                    backgroundColor: entry.policyDecision === 'allowed' ? '#dcfce7' : '#fef2f2',
                    color: entry.policyDecision === 'allowed' ? '#16a34a' : '#dc2626',
                  }}>
                    {entry.policyDecision}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{entry.policySource}</span>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    padding: '2px 6px', borderRadius: 4, fontSize: 11,
                    backgroundColor: entry.success ? '#dcfce7' : '#fef2f2',
                    color: entry.success ? '#16a34a' : '#dc2626',
                  }}>
                    {entry.success ? '成功' : '失败'}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {entry.durationMs}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Subagents Tab ───────────────────────────────────────────

interface SubagentRecord {
  id: string
  parentId: string
  name: string
  task: string
  status: string
  result: string | null
  createdAt: number
  finishedAt: number | null
  timeoutSecs: number
}

function SubagentsTab({ agentId }: { agentId: string }) {
  const [subagents, setSubagents] = useState<SubagentRecord[]>([])
  const [loading, setLoading] = useState(true)

  const loadSubagents = useCallback(async () => {
    try {
      const result = await invoke<SubagentRecord[]>('list_subagents', { agentId })
      setSubagents(result)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { loadSubagents() }, [loadSubagents])

  const handleCancel = async (subagentId: string) => {
    try {
      await invoke('cancel_subagent', { subagentId })
      loadSubagents()
    } catch (e) { console.error(e) }
  }

  const statusColor = (status: string) => {
    if (status === 'Running') return { bg: '#dbeafe', color: '#2563eb' }
    if (status === 'Completed') return { bg: '#dcfce7', color: 'var(--success)' }
    if (status.startsWith('Failed')) return { bg: '#fef2f2', color: 'var(--error)' }
    if (status === 'Timeout') return { bg: '#fef3c7', color: '#d97706' }
    if (status === 'Cancelled') return { bg: '#f3f4f6', color: 'var(--text-secondary)' }
    return { bg: '#f3f4f6', color: 'var(--text-secondary)' }
  }

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div style={{ padding: 20, maxWidth: 800 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>子 Agent 管理</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        主 Agent 在对话中可通过 agent_spawn 工具创建子 Agent 执行子任务
      </p>

      {subagents.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>暂无子 Agent</div>
      ) : (
        subagents.map((sa) => {
          const sc = statusColor(sa.status)
          return (
            <div key={sa.id} style={{
              border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16, marginBottom: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{sa.name}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 12,
                    backgroundColor: sc.bg, color: sc.color,
                  }}>
                    {sa.status}
                  </span>
                  {sa.status === 'Running' && (
                    <button
                      onClick={() => handleCancel(sa.id)}
                      style={{
                        padding: '2px 8px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
                        border: '1px solid #fecaca', backgroundColor: 'var(--error-bg)', color: 'var(--error)',
                      }}
                    >
                      取消
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{sa.task}</div>
              {sa.result && (
                <div style={{
                  fontSize: 12, backgroundColor: 'var(--bg-glass)', padding: 8, borderRadius: 4,
                  marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto',
                }}>
                  {sa.result}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                创建: {new Date(sa.createdAt).toLocaleString('zh-CN')}
                {sa.finishedAt && ` · 完成: ${new Date(sa.finishedAt).toLocaleString('zh-CN')}`}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

// ─── Plugins Tab ─────────────────────────────────────────────

interface SystemPlugin {
  id: string; name: string; description: string; pluginType: string
  builtin: boolean; icon: string; defaultEnabled: boolean
}

function PluginsTab() {
  const [plugins, setPlugins] = useState<SystemPlugin[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke<SystemPlugin[]>('list_system_plugins')
        setPlugins(result)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>加载中...</div>

  // 按类型分组
  const grouped: Record<string, SystemPlugin[]> = {}
  for (const p of plugins) {
    if (!grouped[p.pluginType]) grouped[p.pluginType] = []
    grouped[p.pluginType].push(p)
  }

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>已加载插件</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
        系统级插件提供渠道、模型、记忆等运行时能力。在侧边栏"插件"页面查看详情。
      </p>

      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>{type}</div>
          {items.map(p => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <span style={{ fontSize: 18 }}>{p.icon || '\u{1F9E9}'}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</span>
                {p.builtin && <span style={{ fontSize: 10, marginLeft: 6, padding: '1px 5px', borderRadius: 3, backgroundColor: '#6366F1', color: '#fff' }}>内置</span>}
              </div>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: p.defaultEnabled ? 'var(--success)' : 'var(--border-subtle)',
              }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Autonomy Tab ────────────────────────────────────────────

interface AutonomyConfigData {
  default_level: string
  overrides: Record<string, string>
}

const LEVEL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  L1Confirm: { label: 'L1 需确认', color: 'var(--error)', bg: '#fef2f2' },
  L2Notify: { label: 'L2 自主+通知', color: '#d97706', bg: '#fef3c7' },
  L3Autonomous: { label: 'L3 完全自主', color: 'var(--success)', bg: '#dcfce7' },
}

const TOOL_GROUPS = [
  { label: '安全操作', tools: ['calculator', 'datetime', 'memory_read'] },
  { label: '读取操作', tools: ['file_read', 'file_list', 'code_search', 'web_search', 'web_fetch'] },
  { label: '写入操作', tools: ['file_write', 'file_edit', 'diff_edit', 'memory_write'] },
  { label: '执行操作', tools: ['bash_exec'] },
]

function AutonomyTab({ agentId }: { agentId: string }) {
  const [config, setConfig] = useState<AutonomyConfigData | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const result = await invoke<AutonomyConfigData>('get_autonomy_config', { agentId })
        setConfig(result)
      } catch (e) { console.error(e) }
    })()
  }, [agentId])

  const handleLevelChange = async (tool: string, level: string) => {
    if (!config) return
    const newConfig = { ...config, overrides: { ...config.overrides, [tool]: level } }
    setConfig(newConfig)
    setSaving(true)
    try {
      await invoke('update_autonomy_config', { agentId, autonomyConfig: newConfig })
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  if (!config) return <div style={{ padding: 20, color: 'var(--text-muted)' }}>加载中...</div>

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>自治等级配置</h3>
        {saving && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>保存中...</span>}
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
        控制 Agent 执行各类操作时���自主程度
      </p>

      {TOOL_GROUPS.map((group) => (
        <div key={group.label} style={{ marginBottom: 20 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#374151' }}>{group.label}</h4>
          {group.tools.map((tool) => {
            const current = config.overrides[tool] || config.default_level || 'L1Confirm'
            return (
              <div key={tool} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)',
              }}>
                <span style={{ fontSize: 13, fontFamily: 'monospace' }}>{tool}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {Object.entries(LEVEL_LABELS).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => handleLevelChange(tool, key)}
                      style={{
                        padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                        border: current === key ? `1px solid ${val.color}` : '1px solid #e5e7eb',
                        backgroundColor: current === key ? val.bg : 'white',
                        color: current === key ? val.color : '#999',
                        fontWeight: current === key ? 600 : 400,
                      }}
                    >
                      {val.label}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
