/**
 * 对话页面（动态多供应商版本）
 *
 * 特性：
 * - 从后端动态加载供应商和模型列表
 * - 预置 Agent 模板一键创建
 * - 根据供应商 API Key 状态标记模型可用性
 * - 首次无 Key 时显示引导卡片
 * - 对话头部显示当前模型
 */

import { useState, useEffect, useRef, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { listen } from '@tauri-apps/api/event'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../i18n'
import AgentConfigPanel from '../components/AgentConfigPanel'

import { marked } from 'marked'
import DOMPurify from 'dompurify'

// 配置 marked
marked.setOptions({ breaks: true, gfm: true })

// DOMPurify 允许的标签
const ALLOWED_TAGS = [
  'a','b','blockquote','br','code','del','div','em','h1','h2','h3','h4',
  'hr','i','li','ol','p','pre','span','strong','table','tbody','td','th',
  'thead','tr','ul','img','details','summary',
]

/** Markdown 渲染（使用 marked + DOMPurify） */
function renderMarkdown(text: string): JSX.Element {
  const html = marked.parse(text, { async: false }) as string
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['class','href','rel','target','title','src','alt','start'],
  })
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: clean }} />
}

/** 工具调用卡片 */
function ToolCallCard({ name, args, result, status }: {
  name: string
  args?: string
  result?: string
  status: 'running' | 'done' | 'error'
}) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const statusColors = {
    running: { bg: '#fff8e1', border: '#ffe082', text: '#795548' },
    done: { bg: '#e8f5e9', border: '#a5d6a7', text: '#2e7d32' },
    error: { bg: '#ffebee', border: '#ef9a9a', text: '#c62828' },
  }
  const c = statusColors[status]

  return (
    <div style={{
      margin: '6px 0', padding: '8px 12px', borderRadius: '8px',
      backgroundColor: c.bg, border: `1px solid ${c.border}`, fontSize: '13px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: c.text }}>
        <span>{status === 'running' ? '⏳' : status === 'done' ? '✅' : '❌'}</span>
        <strong>{name}</strong>
        {status === 'running' && <span style={{ color: '#999' }}>{t('chat.toolExecuting')}</span>}
        {(args || result) && (
          <button onClick={() => setExpanded(!expanded)} style={{
            marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '11px', color: '#666',
          }}>
            {expanded ? t('common.collapse') : t('common.details')}
          </button>
        )}
      </div>
      {expanded && args && (
        <pre style={{
          margin: '6px 0 0', padding: '6px 8px', backgroundColor: 'rgba(0,0,0,0.05)',
          borderRadius: '4px', fontSize: '11px', overflow: 'auto', maxHeight: '150px',
        }}>
          <code>{(() => { try { return typeof args === 'string' ? args : JSON.stringify(JSON.parse(args), null, 2) } catch { return args } })()}</code>
        </pre>
      )}
      {expanded && result && (
        <div style={{ margin: '6px 0 0', fontSize: '12px', color: '#555' }}>
          {renderMarkdown(result.length > 500 ? result.slice(0, 500) + '...' : result)}
        </div>
      )}
    </div>
  )
}

interface ProviderModel {
  id: string
  name: string
}

interface Provider {
  id: string
  name: string
  baseUrl: string
  apiKeyMasked?: string
  models: ProviderModel[]
  enabled: boolean
}

/** 从 providers 构建的扁平模型列表项 */
interface ModelItem {
  id: string
  label: string
  provider: string
  providerName: string
  available: boolean
}

/** 预置 Agent 模板 */
const TEMPLATES = [
  { nameKey: 'chatPage.templateGeneral' as const, model: 'gpt-4o-mini', prompt: '你是一个有用的AI助手，擅长回答各种问题。', icon: '💬' },
  { nameKey: 'chatPage.templateCoding' as const, model: 'gpt-4o', prompt: '你是一个资深编程助手，擅长代码编写、调试和架构设计。请用简洁专业的方式回答。', icon: '👨‍💻' },
  { nameKey: 'chatPage.templateTranslator' as const, model: 'deepseek-chat', prompt: '你是一个专业翻译，擅长中英互译。保持原文风格和语气，翻译要自然流畅。', icon: '🌐' },
  { nameKey: 'chatPage.templateWriter' as const, model: 'claude-sonnet-4-20250514', prompt: '你是一个专业写作助手，擅长文章撰写、润色和创意写作。', icon: '✍️' },
]

interface Agent {
  id: string
  name: string
  model: string
  systemPrompt: string
  createdAt: number
}

interface Session {
  id: string
  agentId: string
  title: string
  createdAt: number
  lastMessageAt: number | null
  summary: string | null
}

interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  toolArgs?: string
  toolResult?: string
  toolError?: boolean
}

export default function ChatPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [createError, setCreateError] = useState('')
  const [providers, setProviders] = useState<Provider[]>([])
  const [allModels, setAllModels] = useState<ModelItem[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [agentForm, setAgentForm] = useState({
    name: '',
    systemPrompt: '你是一个有用的AI助手。',
    model: '',
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const hasAnyKey = allModels.some((m) => m.available)

  // 从 providers 构建扁平模型列表
  const buildModelList = (providerList: Provider[]): ModelItem[] => {
    const models: ModelItem[] = []
    for (const p of providerList) {
      if (!p.enabled) continue
      const hasKey = !!p.apiKeyMasked && p.apiKeyMasked !== ''
      const isLocal = p.id === 'ollama' || p.baseUrl?.includes('localhost')
      const available = hasKey || isLocal
      for (const m of p.models || []) {
        models.push({
          id: m.id,
          label: m.name,
          provider: p.id,
          providerName: p.name,
          available,
        })
      }
    }
    return models
  }

  // 加载供应商列表
  const loadProviders = async () => {
    try {
      const list = await invoke<Provider[]>('get_providers')
      const providerList = list || []
      setProviders(providerList)
      const models = buildModelList(providerList)
      setAllModels(models)
      // 设置默认模型（第一个可用的）
      if (!agentForm.model) {
        const firstAvailable = models.find((m) => m.available)
        if (firstAvailable) {
          setAgentForm((prev) => ({ ...prev, model: firstAvailable.id }))
        }
      }
    } catch (e) {
      console.error('加载模型失败:', e)
    }
  }

  // 加载 Agent 列表
  const loadAgents = async () => {
    try {
      const list = await invoke<Agent[]>('list_agents')
      setAgents(list || [])
      if (list?.length > 0 && !selectedAgent) {
        setSelectedAgent(list[0].id)
      }
    } catch (e) {
      console.error('加载 Agent 列表失败:', e)
    }
  }

  // 加载对话历史（结构化消息，含完整 tool_calls）
  const loadHistory = async (_agentId: string, sessionId: string) => {
    try {
      // 优先使用结构化消息 API
      const structured = await invoke<Array<Record<string, any>>>(
        'load_structured_messages',
        { sessionId, limit: 50 }
      )
      if (structured && structured.length > 0) {
        const msgs: Message[] = []
        for (const m of structured) {
          const role = m.role as Message['role']
          if (role === 'system') continue

          if (role === 'tool') {
            msgs.push({
              role: 'tool',
              content: m.content || '',
              toolName: m.name || m.tool_name || t('common.tools'),
              toolResult: m.content || '',
            })
          } else if (role === 'assistant' && m.tool_calls) {
            // assistant 消息带 tool_calls — 先显示文本部分
            if (m.content) {
              msgs.push({ role: 'assistant', content: m.content })
            }
            // 显示每个工具调用
            const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
            for (const tc of calls) {
              const name = tc.function?.name || tc.name || t('common.tools')
              const args = tc.function?.arguments || JSON.stringify(tc.arguments || {})
              msgs.push({
                role: 'tool',
                content: `调用 ${name}`,
                toolName: name,
                toolArgs: args,
              })
            }
          } else {
            msgs.push({ role, content: m.content || '' })
          }
        }
        setMessages(msgs)
        return
      }

      // 回退：旧的纯文本历史
      const history = await invoke<Array<{ userMessage: string; agentResponse: string }>>(
        'get_conversations',
        { agentId: _agentId, sessionId, limit: 50 }
      )
      const msgs: Message[] = []
      for (const c of (history || []).reverse()) {
        msgs.push({ role: 'user', content: c.userMessage })
        if (c.agentResponse) {
          msgs.push({ role: 'assistant', content: c.agentResponse })
        }
      }
      setMessages(msgs)
    } catch (e) {
      console.error('加载历史失败:', e)
      setMessages([])
    }
  }

  // 加载 agent 的会话列表，如果没有则自动创建
  const loadSessions = async (agentId: string) => {
    try {
      const list = await invoke<Session[]>('list_sessions', { agentId })
      if (!list || list.length === 0) {
        // 自动创建第一个会话
        const session = await invoke<Session>('create_session', { agentId })
        setSessions([session])
        setActiveSessionId(session.id)
        setMessages([])
      } else {
        setSessions(list)
        setActiveSessionId(list[0].id)
        await loadHistory(agentId, list[0].id)
      }
    } catch (e) {
      console.error('加载会话失败:', e)
      setSessions([])
      setActiveSessionId(null)
    }
  }

  useEffect(() => {
    loadProviders()
    loadAgents()
  }, [])

  useEffect(() => {
    if (selectedAgent) loadSessions(selectedAgent)
  }, [selectedAgent])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 监听流式 token
  useEffect(() => {
    let unlisten1: (() => void) | undefined
    let unlisten2: (() => void) | undefined
    const setup = async () => {
      unlisten1 = await listen<string>('llm-token', (event) => {
        const payload = event.payload
        // 检测工具调用标记：\n[工具调用: xxx]\n
        const toolMatch = payload.match(/^\n?\[(?:工具调用:|工具:|技能工具:|MCP 工具:)\s*(.+?)(?:\s*执行中\.\.\.)?\]\n?$/)
        if (toolMatch) {
          const toolName = toolMatch[1].trim()
          setMessages((prev) => {
            // 如果上一条是同名工具的 in-progress 标记，跳过重复
            const last = prev[prev.length - 1]
            if (last?.role === 'tool' && last.toolName === toolName) return prev
            return [...prev, { role: 'tool', content: `正在调用 ${toolName}...`, toolName }]
          })
          return
        }
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + payload }]
          }
          return [...prev, { role: 'assistant', content: payload }]
        })
      })
      unlisten2 = await listen('llm-done', () => setStreaming(false))
    }
    setup()
    return () => { unlisten1?.(); unlisten2?.() }
  }, [])

  // 斜杠命令处理
  const handleSlashCommand = async (cmd: string, args: string) => {
    switch (cmd) {
      case '/new': {
        if (!selectedAgent) return
        try {
          const session = await invoke<Session>('create_session', { agentId: selectedAgent })
          setSessions((prev) => [session, ...prev])
          setActiveSessionId(session.id)
          setMessages([])
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: 'system', content: '❌ ' + t('chatPage.newSessionFailed') + ': ' + (e?.message || e) }])
        }
        break
      }
      case '/clear': {
        if (!activeSessionId) return
        try {
          await invoke('clear_history', { sessionId: activeSessionId })
          setMessages([])
          setMessages([{ role: 'system', content: t('chatPage.clearSuccess') }])
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: 'system', content: '❌ 清空失败: ' + (e?.message || e) }])
        }
        break
      }
      case '/compact': {
        if (!selectedAgent || !activeSessionId) return
        setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.compacting') }])
        try {
          const summary = await invoke<string>('compact_session', {
            agentId: selectedAgent,
            sessionId: activeSessionId,
          })
          // 重新加载消息
          await loadHistory(selectedAgent, activeSessionId)
          setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.compactSuccess') + summary }])
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: 'system', content: '❌ 压缩失败: ' + (e?.message || e) }])
        }
        break
      }
      case '/rename': {
        if (!activeSessionId || !args.trim()) {
          setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.renameUsage') }])
          return
        }
        try {
          await invoke('rename_session', { sessionId: activeSessionId, title: args.trim() })
          setSessions((prev) =>
            prev.map((s) => (s.id === activeSessionId ? { ...s, title: args.trim() } : s))
          )
          setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.renamed') + args.trim() }])
        } catch (e: any) {
          setMessages((prev) => [...prev, { role: 'system', content: '❌ 重命名失败: ' + (e?.message || e) }])
        }
        break
      }
      case '/sessions': {
        const list = sessions.map((s, i) => `${i + 1}. ${s.title}${s.id === activeSessionId ? ' ' + t('chatPage.sessionCurrent') : ''}`).join('\n')
        setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.sessionListTitle') + list }])
        break
      }
      case '/help': {
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: t('chatPage.helpText'),
          },
        ])
        break
      }
      default:
        setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.unknownCommand', { cmd }) }])
    }
  }

  // 发送消息
  const handleSend = async () => {
    if (!input.trim() || !selectedAgent || streaming) return
    const userMsg = input.trim()
    setInput('')

    // 斜杠命令拦截（仅匹配已知命令，不拦截文件路径等）
    const SLASH_COMMANDS = ['/new', '/clear', '/compact', '/rename', '/sessions', '/help']
    if (userMsg.startsWith('/')) {
      const spaceIdx = userMsg.indexOf(' ')
      const cmd = spaceIdx > 0 ? userMsg.slice(0, spaceIdx) : userMsg
      if (SLASH_COMMANDS.includes(cmd)) {
        const args = spaceIdx > 0 ? userMsg.slice(spaceIdx + 1) : ''
        await handleSlashCommand(cmd, args)
        return
      }
    }

    if (!activeSessionId) {
      setMessages((prev) => [...prev, { role: 'system', content: t('chatPage.noSessionWarning') }])
      return
    }
    setMessages((prev) => [...prev, { role: 'user', content: userMsg }])
    setStreaming(true)
    try {
      await invoke('send_message', { agentId: selectedAgent, sessionId: activeSessionId, message: userMsg })
      setStreaming(false)
      // 刷新会话列表（标题可能自动更新了）
      const updatedSessions = await invoke<Session[]>('list_sessions', { agentId: selectedAgent })
      if (updatedSessions) setSessions(updatedSessions)
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '❌ ' + (e?.message || e) },
      ])
      setStreaming(false)
    }
  }

  // 从模板创建 Agent
  const handleCreateFromTemplate = async (tpl: typeof TEMPLATES[0]) => {
    const modelInfo = allModels.find((m) => m.id === tpl.model)
    if (!modelInfo?.available) {
      const providerName = modelInfo?.providerName || 'provider'
      setCreateError(t('chatPage.needConfigKey', { provider: providerName }))
      return
    }
    try {
      const result = await invoke<Agent>('create_agent', {
        name: t(tpl.nameKey),
        systemPrompt: tpl.prompt,
        model: tpl.model,
      })
      await loadAgents()
      if (result?.id) setSelectedAgent(result.id)
    } catch (e: any) {
      setCreateError(String(e?.message || e || t('chatPage.createFailed')))
    }
  }

  // 自定义创建 Agent
  const handleCreateAgent = async () => {
    if (!agentForm.name.trim()) return
    setCreateError('')
    const modelInfo = allModels.find((m) => m.id === agentForm.model)
    if (!modelInfo?.available) {
      const providerName = modelInfo?.providerName || 'provider'
      setCreateError(t('chatPage.needConfigKey', { provider: providerName }))
      return
    }
    try {
      const result = await invoke<Agent>('create_agent', agentForm)
      setShowCreateAgent(false)
      const firstAvailable = allModels.find((m) => m.available)
      setAgentForm({ name: '', systemPrompt: '你是一个有用的AI助手。', model: firstAvailable?.id || '' })
      await loadAgents()
      if (result?.id) setSelectedAgent(result.id)
    } catch (e: any) {
      setCreateError(String(e?.message || e || t('chatPage.createFailed')))
    }
  }

  // 删除 Agent
  const handleDeleteAgent = async (id: string) => {
    if (!confirm(t('chatPage.confirmDeleteAgent'))) return
    try {
      await invoke('delete_agent', { agentId: id })
      if (selectedAgent === id) { setSelectedAgent(''); setMessages([]) }
      loadAgents()
    } catch (e) { console.error('删除 Agent 失败:', e) }
  }

  // 判断模型是否可用
  const isModelAvailable = (modelId: string) => {
    const m = allModels.find((x) => x.id === modelId)
    return m?.available ?? false
  }

  // 当前选中 Agent 的模型信息
  const currentAgent = agents.find((a) => a.id === selectedAgent)
  const currentModelInfo = allModels.find((m) => m.id === currentAgent?.model)

  return (
    <div style={{ display: 'flex', height: '100%', margin: '-24px', overflow: 'hidden' }}>
      {/* 左侧 Agent 列表 */}
      <div style={{ width: '220px', borderRight: '1px solid #ddd', padding: '10px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <strong>{t('chatPage.conversation')}</strong>
          <button
            onClick={() => { setShowCreateAgent(!showCreateAgent); setCreateError('') }}
            style={{ padding: '4px 8px', fontSize: '12px', cursor: 'pointer' }}
          >
            {showCreateAgent ? t('chatPage.cancelCreate') : t('chatPage.customCreate')}
          </button>
        </div>

        {/* 自定义创建表单 */}
        {showCreateAgent && (
          <div style={{ marginBottom: '10px', padding: '8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' }}>
            <input
              placeholder={t('chatPage.fieldName')}
              value={agentForm.name}
              onChange={(e) => setAgentForm({ ...agentForm, name: e.target.value })}
              style={{ width: '100%', padding: '4px', marginBottom: '5px', boxSizing: 'border-box' }}
            />
            <textarea
              placeholder="System Prompt"
              value={agentForm.systemPrompt}
              onChange={(e) => setAgentForm({ ...agentForm, systemPrompt: e.target.value })}
              rows={2}
              style={{ width: '100%', padding: '4px', marginBottom: '5px', boxSizing: 'border-box', fontSize: '12px' }}
            />
            <select
              value={agentForm.model}
              onChange={(e) => setAgentForm({ ...agentForm, model: e.target.value })}
              style={{ width: '100%', padding: '4px', marginBottom: '5px', boxSizing: 'border-box' }}
            >
              {allModels.map((m) => (
                <option key={`${m.provider}-${m.id}`} value={m.id} disabled={!m.available}>
                  {m.label} ({m.providerName}) {!m.available ? t('chatPage.notConfiguredKey') : ''}
                </option>
              ))}
            </select>
            {createError && (
              <div style={{ color: '#dc3545', fontSize: '12px', marginBottom: '5px' }}>{createError}</div>
            )}
            <button
              onClick={handleCreateAgent}
              disabled={!agentForm.name.trim()}
              style={{
                width: '100%', padding: '4px',
                backgroundColor: !agentForm.name.trim() ? '#999' : '#28a745',
                color: 'white', border: 'none', borderRadius: '3px',
                cursor: !agentForm.name.trim() ? 'not-allowed' : 'pointer',
                opacity: !agentForm.name.trim() ? 0.6 : 1,
              }}
            >
              {t('chatPage.createBtn')}
            </button>
          </div>
        )}

        {/* Agent 列表 */}
        {agents.map((a) => (
          <div
            key={a.id}
            onClick={() => setSelectedAgent(a.id)}
            style={{
              padding: '8px', marginBottom: '4px', borderRadius: '4px', cursor: 'pointer',
              backgroundColor: selectedAgent === a.id ? '#e3f2fd' : 'transparent',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: selectedAgent === a.id ? 'bold' : 'normal', fontSize: '13px' }}>{a.name}</div>
              <div style={{ fontSize: '11px', color: '#999' }}>
                {allModels.find((m) => m.id === a.model)?.label || a.model}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {selectedAgent === a.id && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowConfig(!showConfig) }}
                  style={{ fontSize: '12px', color: '#666', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                  title={t('chatPage.configTitle')}
                >
                  ⚙
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteAgent(a.id) }}
                style={{ fontSize: '11px', color: 'red', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
          </div>
        ))}

        {agents.length === 0 && !showCreateAgent && (
          <div style={{ color: '#999', fontSize: '12px', textAlign: 'center', marginTop: '10px' }}>
            {t('chatPage.quickStartHint')}
          </div>
        )}

        {/* 会话列表 */}
        {selectedAgent && sessions.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '15px', marginBottom: '6px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
              <strong style={{ fontSize: '12px', color: '#666' }}>{t('chatPage.sessions')}</strong>
              <button
                onClick={async () => {
                  try {
                    const session = await invoke<Session>('create_session', { agentId: selectedAgent })
                    setSessions((prev) => [session, ...prev])
                    setActiveSessionId(session.id)
                    setMessages([])
                  } catch (e) { console.error('新建会话失败:', e) }
                }}
                style={{ padding: '2px 6px', fontSize: '11px', cursor: 'pointer', background: 'none', border: '1px solid #ccc', borderRadius: '3px' }}
              >
                {t('common.new')}
              </button>
            </div>
            {sessions.map((s) => (
              <div
                key={s.id}
                onClick={async () => {
                  setActiveSessionId(s.id)
                  await loadHistory(selectedAgent, s.id)
                }}
                style={{
                  padding: '6px 8px', marginBottom: '2px', borderRadius: '4px', cursor: 'pointer',
                  backgroundColor: activeSessionId === s.id ? '#e8f5e9' : 'transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '12px',
                }}
              >
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {s.title}
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!confirm(t('chatPage.confirmDeleteSession'))) return
                    try {
                      await invoke('delete_session', { sessionId: s.id })
                      const updated = sessions.filter((x) => x.id !== s.id)
                      setSessions(updated)
                      if (activeSessionId === s.id) {
                        if (updated.length > 0) {
                          setActiveSessionId(updated[0].id)
                          await loadHistory(selectedAgent, updated[0].id)
                        } else {
                          setActiveSessionId(null)
                          setMessages([])
                        }
                      }
                    } catch (e) { console.error('删除会话失败:', e) }
                  }}
                  style={{ fontSize: '10px', color: 'red', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 右侧内容区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* 对话头部：显示当前模型 */}
        {currentAgent && (
          <div style={{
            padding: '8px 15px', borderBottom: '1px solid #eee',
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#666',
          }}>
            <span style={{ fontWeight: 600, color: '#333' }}>{currentAgent.name}</span>
            <span style={{
              padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
              backgroundColor: currentModelInfo?.provider === 'anthropic' ? '#f0e6ff' : '#e6f3ff',
              color: currentModelInfo?.provider === 'anthropic' ? '#7c3aed' : '#0066cc',
            }}>
              {currentModelInfo?.label || currentAgent.model}
            </span>
          </div>
        )}

        {/* 消息列表 / 欢迎页 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>

          {/* 首次引导：无 API Key */}
          {!hasAnyKey && !selectedAgent && (
            <div style={{ maxWidth: '500px', margin: '40px auto', textAlign: 'center' }}>
              <div style={{ fontSize: '40px', marginBottom: '16px' }}>🔑</div>
              <h3 style={{ margin: '0 0 8px' }}>{t('chatPage.guideApiKeyTitle')}</h3>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                {t('chatPage.guideApiKeyDesc')}
              </p>
              <button
                onClick={() => navigate('/settings')}
                style={{
                  padding: '10px 24px', backgroundColor: '#007bff', color: 'white',
                  border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer',
                }}
              >
                {t('chatPage.gotoSettings')}
              </button>
            </div>
          )}

          {/* 有 Key 但无 Agent：显示模板 */}
          {hasAnyKey && !selectedAgent && agents.length === 0 && (
            <div style={{ maxWidth: '600px', margin: '30px auto' }}>
              <h3 style={{ textAlign: 'center', marginBottom: '4px' }}>{t('chatPage.guideTemplateTitle')}</h3>
              <p style={{ textAlign: 'center', color: '#999', fontSize: '13px', marginBottom: '20px' }}>
                {t('chatPage.guideTemplateDesc')}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {TEMPLATES.map((tpl) => {
                  const available = isModelAvailable(tpl.model)
                  return (
                    <div
                      key={tpl.nameKey}
                      onClick={() => available && handleCreateFromTemplate(tpl)}
                      style={{
                        padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px',
                        cursor: available ? 'pointer' : 'not-allowed',
                        opacity: available ? 1 : 0.5,
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        if (available) {
                          e.currentTarget.style.borderColor = '#007bff'
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,123,255,0.15)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e0e0e0'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <div style={{ fontSize: '24px', marginBottom: '8px' }}>{tpl.icon}</div>
                      <div style={{ fontWeight: 600, marginBottom: '4px' }}>{t(tpl.nameKey)}</div>
                      <div style={{ fontSize: '12px', color: '#999' }}>
                        {allModels.find((m) => m.id === tpl.model)?.label || tpl.model}
                        {!available && ' ' + t('chatPage.needsKey')}
                      </div>
                    </div>
                  )
                })}
              </div>
              {createError && (
                <div style={{ color: '#dc3545', fontSize: '13px', textAlign: 'center', marginTop: '12px' }}>
                  {createError}
                </div>
              )}
            </div>
          )}

          {/* 有 Agent 但未选中 */}
          {hasAnyKey && !selectedAgent && agents.length > 0 && (
            <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>
              {t('chatPage.selectAgent')}
            </div>
          )}

          {/* 选中 Agent 但无消息 */}
          {selectedAgent && messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#999', marginTop: '40px' }}>
              {t('chatPage.startChat')}
            </div>
          )}

          {/* 消息列表 */}
          {messages.map((msg, i) => {
            // 系统消息（斜杠命令反馈）
            if (msg.role === 'system') {
              return (
                <div key={i} style={{ marginBottom: '8px', display: 'flex', justifyContent: 'center' }}>
                  <div style={{
                    maxWidth: '80%', padding: '8px 14px', borderRadius: '8px',
                    backgroundColor: '#e8eaf6', border: '1px solid #c5cae9',
                    fontSize: '13px', color: '#37474f', whiteSpace: 'pre-wrap',
                  }}>
                    {msg.content}
                  </div>
                </div>
              )
            }
            // 工具调用卡片
            if (msg.role === 'tool') {
              const isRunning = msg.content?.includes('执行中') || msg.content?.includes('正在调用')
              return (
                <div key={i} style={{ marginBottom: '8px', maxWidth: '80%' }}>
                  <ToolCallCard
                    name={msg.toolName || t('common.tools')}
                    args={msg.toolArgs}
                    result={isRunning ? undefined : msg.toolResult}
                    status={isRunning ? 'running' : (msg.toolError ? 'error' : 'done')}
                  />
                </div>
              )
            }
            return (
              <div
                key={i}
                style={{
                  marginBottom: '12px', display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '70%', padding: '10px 14px', borderRadius: '12px',
                    backgroundColor: msg.role === 'user' ? '#007bff' : '#f1f1f1',
                    color: msg.role === 'user' ? 'white' : '#333',
                    wordBreak: 'break-word', lineHeight: 1.6,
                  }}
                >
                  {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
                </div>
              </div>
            )
          })}
          {streaming && messages[messages.length - 1]?.role !== 'assistant' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ padding: '10px 14px', borderRadius: '12px', backgroundColor: '#f1f1f1', color: '#999' }}>
                {t('chat.statusThinking')}
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div style={{ padding: '10px 15px', borderTop: '1px solid #ddd' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              }}
              placeholder={selectedAgent ? t('chatPage.inputPlaceholder') : t('chatPage.inputDisabled')}
              disabled={!selectedAgent || streaming}
              style={{
                flex: 1, padding: '10px', border: '1px solid #ddd',
                borderRadius: '4px', fontSize: '14px',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!selectedAgent || streaming || !input.trim()}
              style={{
                padding: '10px 20px', backgroundColor: '#007bff', color: 'white',
                border: 'none', borderRadius: '4px',
                cursor: !selectedAgent || streaming || !input.trim() ? 'not-allowed' : 'pointer',
                opacity: !selectedAgent || streaming || !input.trim() ? 0.6 : 1,
              }}
            >
              {streaming ? t('agentDetail.generating') : t('common.send')}
            </button>
          </div>
        </div>
      </div>

      {/* 右侧配置面板 */}
      {showConfig && selectedAgent && (
        <AgentConfigPanel agentId={selectedAgent} onClose={() => setShowConfig(false)} />
      )}
    </div>
  )
}