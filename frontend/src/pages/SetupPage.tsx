/**
 * 首次启动引导页 — 参考 PetClaw 多步骤向导风格
 *
 * 步骤：欢迎 → 环境准备 → 技能展示 → AI 配置 → 完成
 */

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

const TOTAL_STEPS = 4

// 暖白色调（参考 PetClaw）
const S = {
  bg: '#f7f7f4',
  card: '#fff',
  cardBorder: '#e8e8e4',
  text: '#262521',
  textSub: '#888882',
  accent: '#262521',
  accentBg: '#262521',
  accentText: '#fff',
  green: '#22c55e',
  bar: '#ddd',
  barActive: '#262521',
}

export default function SetupPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [setupStatus, setSetupStatus] = useState<Record<string, string>>({})
  const [skills, setSkills] = useState<{ name: string; desc: string; icon: string }[]>([])
  const [providers, setProviders] = useState<{ name: string; hasKey: boolean }[]>([])
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('')

  useEffect(() => {
    runAutoSetup()
  }, [])

  const runAutoSetup = async () => {
    // 环境检查
    setSetupStatus(s => ({ ...s, env: 'running' }))
    try { await invoke('health_check'); setSetupStatus(s => ({ ...s, env: 'done' })) }
    catch { setSetupStatus(s => ({ ...s, env: 'done' })) }

    // Node.js
    setSetupStatus(s => ({ ...s, node: 'running' }))
    try {
      const rt = await invoke<any>('check_runtime')
      if (!rt?.installed) await invoke('setup_runtime')
      setSetupStatus(s => ({ ...s, node: 'done' }))
    } catch { setSetupStatus(s => ({ ...s, node: 'skip' })) }

    // 默认 Agent
    try {
      const agents = await invoke<any[]>('list_agents')
      if (!agents || agents.length === 0) {
        await invoke('create_agent', {
          name: '通用助手', systemPrompt: '你是一个有用的AI助手，擅长回答各种问题。', model: 'gpt-4o',
        })
      }
      setSetupStatus(s => ({ ...s, agent: 'done' }))
    } catch { setSetupStatus(s => ({ ...s, agent: 'skip' })) }

    // 加载技能
    try {
      const agents = await invoke<any[]>('list_agents')
      if (agents?.length) {
        const list = await invoke<any[]>('list_skills', { agentId: agents[0].id })
        setSkills((list || []).map((s: any) => ({ name: s.name, desc: s.description || '', icon: '\u{1F527}' })))
      }
    } catch { /* ignore */ }

    // 加载 providers
    try {
      const p = await invoke<any[]>('get_providers')
      setProviders((p || []).map((x: any) => ({ name: x.name, hasKey: !!(x.apiKey && x.enabled) })))
    } catch { /* ignore */ }
  }

  const handleSaveProvider = async () => {
    if (!apiKey.trim()) return
    try {
      const p = await invoke<any[]>('get_providers') || []
      const custom = {
        id: 'custom-' + Date.now(),
        name: '自定义供应商',
        apiType: 'openai',
        baseUrl: apiUrl.trim() || 'https://api.openai.com/v1',
        apiKey: apiKey.trim(),
        models: [{ id: 'gpt-4o', name: 'GPT-4o' }, { id: 'gpt-4o-mini', name: 'GPT-4o Mini' }],
        enabled: true,
      }
      p.push(custom)
      await invoke('set_setting', { key: 'providers', value: JSON.stringify(p) })
      setProviders(prev => [...prev, { name: custom.name, hasKey: true }])
      setApiKey('')
    } catch (e) { alert('保存失败: ' + e) }
  }

  const pages = [
    // Step 0: 欢迎
    () => (
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 12px', color: S.text }}>
          欢迎使用 YonClaw
        </h1>
        <p style={{ color: S.textSub, fontSize: 15, lineHeight: 1.7, margin: '0 0 32px' }}>
          YonClaw 是你的本地 AI 助手。所有数据存储在本地，<br />
          不会离开你的设备。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { label: '环境检查', status: setupStatus.env },
            { label: '准备 Node.js 运行时', status: setupStatus.node },
            { label: '初始化工作区', status: setupStatus.agent },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 18px', backgroundColor: S.card, borderRadius: 12,
              border: `1px solid ${S.cardBorder}`,
            }}>
              <span style={{ fontSize: 14, color: S.text }}>{item.label}</span>
              {item.status === 'done' && <span style={{ color: S.green, fontSize: 18 }}>{'\u2705'}</span>}
              {item.status === 'running' && <span style={{ color: S.textSub, fontSize: 13 }}>...</span>}
              {item.status === 'skip' && <span style={{ color: S.textSub, fontSize: 13 }}>跳过</span>}
              {!item.status && <span style={{ color: '#ddd', fontSize: 13 }}>{'\u25CB'}</span>}
            </div>
          ))}
        </div>
      </div>
    ),

    // Step 1: 技能展示
    () => (
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: S.text }}>
          YonClaw 拥有的技能
        </h1>
        <p style={{ color: S.textSub, fontSize: 14, margin: '0 0 24px' }}>
          我们为您预装了好用且安全的 Skill
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, backgroundColor: S.card, borderRadius: 12, border: `1px solid ${S.cardBorder}`, overflow: 'hidden' }}>
          {(skills.length > 0 ? skills : [
            { name: 'memory_write', desc: '长期记忆存储', icon: '\u{1F9E0}' },
            { name: 'memory_read', desc: '记忆检索（语义+关键词）', icon: '\u{1F50D}' },
            { name: 'bash_exec', desc: '执行终端命令', icon: '\u{1F4BB}' },
            { name: 'file_read', desc: '读取本地文件', icon: '\u{1F4C4}' },
            { name: 'web_fetch', desc: '获取网页内容', icon: '\u{1F310}' },
            { name: 'provider_manage', desc: '对话中管理 AI 供应商', icon: '\u2699\uFE0F' },
            { name: 'agent_self_config', desc: '对话中修改模型和参数', icon: '\u{1F916}' },
          ]).map((skill, i, arr) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', padding: '13px 18px',
              borderBottom: i < arr.length - 1 ? `1px solid ${S.cardBorder}` : 'none',
            }}>
              <span style={{ fontSize: 18, marginRight: 14, width: 24, textAlign: 'center' }}>{skill.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: S.text }}>{skill.name}</div>
                {skill.desc && <div style={{ fontSize: 12, color: S.textSub, marginTop: 1 }}>{skill.desc}</div>}
              </div>
              <span style={{ color: S.green, fontSize: 18 }}>{'\u2705'}</span>
            </div>
          ))}
        </div>
      </div>
    ),

    // Step 2: AI 配置
    () => (
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: S.text }}>
          配置 AI 供应商
        </h1>
        <p style={{ color: S.textSub, fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
          YonClaw 需要 LLM API 才能工作。<br />
          支持 OpenAI、Anthropic、DeepSeek 等 OpenAI 兼容接口。
        </p>

        {providers.some(p => p.hasKey) ? (
          <div style={{ backgroundColor: S.card, borderRadius: 12, border: `1px solid ${S.cardBorder}`, overflow: 'hidden' }}>
            {providers.filter(p => p.hasKey).map((p, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', borderBottom: `1px solid ${S.cardBorder}`,
              }}>
                <span style={{ fontSize: 14, color: S.text }}>{p.name}</span>
                <span style={{ color: S.green, fontSize: 18 }}>{'\u2705'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ backgroundColor: S.card, borderRadius: 12, border: `1px solid ${S.cardBorder}`, padding: 20 }}>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, color: S.textSub, display: 'block', marginBottom: 6 }}>API Key</label>
              <input
                value={apiKey} onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                type="password"
                style={{
                  width: '100%', padding: '10px 14px', border: `1px solid ${S.cardBorder}`,
                  borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: S.bg, color: S.text,
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, color: S.textSub, display: 'block', marginBottom: 6 }}>Base URL（可选）</label>
              <input
                value={apiUrl} onChange={e => setApiUrl(e.target.value)}
                placeholder="https://api.openai.com/v1（默认）"
                style={{
                  width: '100%', padding: '10px 14px', border: `1px solid ${S.cardBorder}`,
                  borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: S.bg, color: S.text,
                }}
              />
            </div>
            <button onClick={handleSaveProvider} disabled={!apiKey.trim()} style={{
              padding: '10px 20px', backgroundColor: S.accentBg, color: S.accentText,
              border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer',
              opacity: apiKey.trim() ? 1 : 0.4,
            }}>
              保存配置
            </button>
          </div>
        )}

        <p style={{ color: S.textSub, fontSize: 12, marginTop: 16 }}>
          也可以跳过此步骤，稍后在「设置」中配置。
        </p>
      </div>
    ),

    // Step 3: 完成
    () => (
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 12px', color: S.text }}>
          一切就绪！
        </h1>
        <p style={{ color: S.textSub, fontSize: 15, lineHeight: 1.7, margin: '0 0 32px' }}>
          YonClaw 已准备好为你工作。<br />
          你可以随时通过对话管理设置、安装技能、切换模型。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { icon: '\u{1F4AC}', label: '直接对话', desc: '和 AI 助手自然交流' },
            { icon: '/', label: '斜杠命令', desc: '输入 / 查看 21 个快捷命令' },
            { icon: '\u{1F4CE}', label: '图片输入', desc: '粘贴或拖拽图片给 AI 分析' },
            { icon: '\u{1F9E0}', label: '越用越聪明', desc: 'AI 自动记住你的偏好和习惯' },
          ].map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '14px 18px', backgroundColor: S.card, borderRadius: 12,
              border: `1px solid ${S.cardBorder}`,
            }}>
              <span style={{ fontSize: 22, width: 32, textAlign: 'center' }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: S.text }}>{item.label}</div>
                <div style={{ fontSize: 12, color: S.textSub }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
  ]

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: S.bg,
      fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    }}>
      {/* 左侧内容区 */}
      <div style={{ flex: 1, maxWidth: 560, padding: '60px 60px 80px', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部步骤条 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 40 }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div key={i} style={{
              height: 3, borderRadius: 2, flex: 1,
              backgroundColor: i <= step ? S.barActive : S.bar,
              transition: 'background-color 0.3s ease',
            }} />
          ))}
        </div>

        {/* 页面内容 */}
        <div style={{ flex: 1 }}>
          {pages[step]()}
        </div>

        {/* 底部导航 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 40 }}>
          <button
            onClick={onComplete}
            style={{ background: 'none', border: 'none', color: S.textSub, fontSize: 14, cursor: 'pointer', padding: '8px 0' }}
          >
            跳过
          </button>
          <div style={{ display: 'flex', gap: 10 }}>
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                style={{
                  padding: '10px 24px', backgroundColor: S.card, color: S.text,
                  border: `1px solid ${S.cardBorder}`, borderRadius: 8, fontSize: 14, cursor: 'pointer',
                }}
              >
                上一步
              </button>
            )}
            <button
              onClick={() => step < TOTAL_STEPS - 1 ? setStep(step + 1) : onComplete()}
              style={{
                padding: '10px 28px', backgroundColor: S.accentBg, color: S.accentText,
                border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 500,
              }}
            >
              {step < TOTAL_STEPS - 1 ? '下一步' : '开始使用'}
            </button>
          </div>
        </div>
      </div>

      {/* 右侧装饰区 */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderLeft: `1px solid ${S.cardBorder}`,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 120, lineHeight: 1, marginBottom: 16 }}>{'\u{1F916}'}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: S.text }}>YonClaw</div>
          <div style={{ fontSize: 13, color: S.textSub, marginTop: 4 }}>Your AI Assistant</div>
        </div>
      </div>
    </div>
  )
}
