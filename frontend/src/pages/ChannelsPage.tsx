/**
 * 频道管理 — 通过 cloud_api_proxy Tauri 命令调用云端 API
 */
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

async function cloudApi(method: string, path: string, body?: any): Promise<any> {
  return invoke('cloud_api_proxy', { method, path, body: body || null })
}

interface ChannelInfo {
  id: string; name: string; desc: string; icon: string; connected: boolean
  bot?: { username: string; name: string }
  configFields?: { key: string; label: string; placeholder: string; type?: string }[]
}

const CHANNELS: ChannelInfo[] = [
  { id: 'telegram', name: 'Telegram', icon: '\u{1F4E8}', desc: '通过 Telegram Bot 与 AI 对话。从 @BotFather 获取 Token，一分钟接入。', connected: false, configFields: [{ key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...', type: 'password' }] },
  { id: 'feishu', name: '飞书 (Lark)', icon: '\u{1F426}', desc: '飞书群聊 AI 助手。', connected: false },
  { id: 'dingtalk', name: '钉钉', icon: '\u{1F4AC}', desc: '钉钉群机器人接入。', connected: false },
  { id: 'wechat', name: '微信', icon: '\u{1F4F1}', desc: '微信公众号/企业微信接入。', connected: false },
  { id: 'discord', name: 'Discord', icon: '\u{1F3AE}', desc: '通过 Bot API 接入 Discord。', connected: false },
  { id: 'slack', name: 'Slack', icon: '\u{1F4BC}', desc: 'Socket Mode 接入 Slack 工作区。', connected: false },
]

export default function ChannelsPage() {
  const [channels, setChannels] = useState(CHANNELS)
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => { checkStatuses() }, [])

  const checkStatuses = async () => {
    setLoadError('')
    try {
      // 优先从本地 settings 检查
      const token = await invoke<string | null>('get_setting', { key: 'telegram_bot_token' })
      const infoStr = await invoke<string | null>('get_setting', { key: 'telegram_bot_info' })
      const hasToken = !!token
      let botInfo = null
      try { if (infoStr) botInfo = JSON.parse(infoStr) } catch {}

      setChannels(prev => prev.map(c =>
        c.id === 'telegram' ? { ...c, connected: hasToken, bot: botInfo } : c
      ))
    } catch (e: any) {
      setLoadError(String(e))
    }
  }

  const handleSetup = async (channelId: string) => {
    if (channelId !== 'telegram') { alert('该频道暂未支持'); return }
    const token = formValues.botToken?.trim()
    if (!token) { setError('请输入 Bot Token'); return }

    setSaving(true); setError('')
    try {
      // 步骤 1: 通过 Tauri Rust 侧验证 Token（绕过 WebView 限制）
      setError('正在验证 Token...')
      const verifyResult = await invoke<any>('verify_telegram_token', { botToken: token })

      if (!verifyResult.ok) { setError('Token 无效: ' + (verifyResult.error || '')); setSaving(false); return }
      setError(`验证成功: @${verifyResult.username}，正在保存...`)

      // 步骤 2: 保存到本地 settings（桌面端直接轮询 Telegram）
      await invoke('set_setting', { key: 'telegram_bot_token', value: token })
      await invoke('set_setting', { key: 'telegram_bot_info', value: JSON.stringify({
        username: verifyResult.username, first_name: verifyResult.name, id: verifyResult.id,
      })})

      // 注：不再发到云端（避免双重轮询）
      // 桌面离线时的 Fallback 由云端 sync 机制单独处理

      setConfiguring(null); setFormValues({}); setError('')
      alert('Telegram 已连接！重启应用后生效（本地轮询）。')
      checkStatuses()
    } catch (e: any) { setError('连接失败: ' + String(e)) }
    setSaving(false)
  }

  const handleDisconnect = async (channelId: string) => {
    if (!confirm('确定断开连接？')) return
    try { await cloudApi('POST', `/api/v1/channels/${channelId}/disconnect`); checkStatuses() } catch {}
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>频道</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>将 AI 接入你日常使用的通讯应用</p>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--success)', marginRight: 6 }} />
          {channels.filter(c => c.connected).length} 已连接
        </div>
      </div>

      {loadError && (
        <div style={{ padding: '10px 16px', borderRadius: 8, backgroundColor: 'var(--error-bg)', color: 'var(--error)', fontSize: 13, marginTop: 12 }}>
          {loadError}
          <button onClick={checkStatuses} style={{ marginLeft: 12, fontSize: 12, padding: '2px 8px', borderRadius: 4, cursor: 'pointer' }}>重试</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
        {channels.map(ch => (
          <div key={ch.id} style={{ padding: '18px 20px', borderRadius: 12, backgroundColor: 'var(--bg-elevated)', border: ch.connected ? '2px solid var(--success)' : '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{ch.icon}</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{ch.name}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: ch.connected ? 'var(--success-bg)' : 'var(--bg-glass)', color: ch.connected ? 'var(--success)' : 'var(--text-muted)', fontWeight: ch.connected ? 600 : 400 }}>
                {ch.connected ? '已连接' : '未连接'}
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>{ch.desc}</p>
            {ch.connected && ch.bot && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Bot: @{ch.bot.username}</div>}

            {configuring === ch.id && ch.configFields && (
              <div style={{ marginBottom: 12 }}>
                {error && <div style={{ color: 'var(--error)', fontSize: 12, marginBottom: 8 }}>{error}</div>}
                {ch.configFields.map(f => (
                  <input key={f.key} type={f.type || 'text'} placeholder={f.placeholder}
                    value={formValues[f.key] || ''} onChange={e => setFormValues({ ...formValues, [f.key]: e.target.value })}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 13, border: '1px solid var(--border-subtle)', marginBottom: 8, boxSizing: 'border-box' }} />
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => handleSetup(ch.id)} disabled={saving}
                    style={{ padding: '6px 16px', borderRadius: 8, backgroundColor: 'var(--accent)', color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer' }}>
                    {saving ? '连接中...' : '连接'}
                  </button>
                  <button onClick={() => { setConfiguring(null); setError('') }}
                    style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 13, cursor: 'pointer' }}>取消</button>
                </div>
              </div>
            )}

            {configuring !== ch.id && (ch.connected ? (
              <button onClick={() => handleDisconnect(ch.id)} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12, cursor: 'pointer', color: 'var(--error)' }}>断开连接</button>
            ) : (
              <button onClick={() => ch.configFields ? setConfiguring(ch.id) : alert('该频道暂未支持')} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 12, cursor: 'pointer', color: 'var(--text-accent)' }}>点击配置</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
