/**
 * Token 监控页面
 *
 * 展示实际 LLM API 调用的 token 消耗统计
 * 数据来源：本地 SQLite token_usage 表
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { useI18n } from '../i18n'
import Select from '../components/Select'

interface ModelStats {
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  calls: number
}

interface AgentTokenStats {
  agent_id: string
  days: number
  total_input_tokens: number
  total_output_tokens: number
  total_tokens: number
  models: ModelStats[]
}

interface DailyStats {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  calls: number
}

interface Agent {
  id: string
  name: string
  model: string
}

function estimateCost(model: string, input: number, output: number): number {
  const m = model.toLowerCase()
  const [ip, op] =
    m.includes('gpt-5') && m.includes('mini') ? [0.30, 1.20]
    : m.includes('gpt-5') || m.includes('gpt-4.5') ? [5, 20]
    : m.includes('gpt-4o-mini') || m.includes('gpt-4.1-mini') ? [0.15, 0.6]
    : m.includes('gpt-4o') || m.includes('gpt-4.1') ? [2.5, 10]
    : m.includes('o4-mini') || m.includes('o3-mini') ? [1.1, 4.4]
    : m.includes('o3') || m.includes('o4') ? [10, 40]
    : m.includes('claude-opus-4') ? [15, 75]
    : m.includes('claude-sonnet-4') ? [3, 15]
    : m.includes('claude-haiku-4') ? [0.8, 4]
    : m.includes('claude-opus') ? [15, 75]
    : m.includes('claude-sonnet') ? [3, 15]
    : m.includes('claude-haiku') ? [0.25, 1.25]
    : m.includes('claude') ? [3, 15]
    : m.includes('gemini') && m.includes('flash') ? [0.075, 0.3]
    : m.includes('gemini') && m.includes('pro') ? [1.25, 5]
    : m.includes('gemini') ? [0.5, 1.5]
    : m.includes('deepseek-r1') ? [0.55, 2.19]
    : m.includes('deepseek') ? [0.27, 1.1]
    : m.includes('grok') && m.includes('mini') ? [0.3, 0.5]
    : m.includes('grok') ? [3, 15]
    : m.includes('qwen') && m.includes('turbo') ? [0.3, 0.6]
    : m.includes('qwen') ? [0.8, 2]
    : m.includes('moonshot') || m.includes('kimi') ? [1, 1]
    : m.includes('glm') && m.includes('flash') ? [0.1, 0.1]
    : m.includes('glm') ? [1, 1]
    : m.includes('mistral') && m.includes('large') ? [2, 6]
    : m.includes('mistral') ? [0.25, 0.25]
    : m.includes('llama') ? [0.2, 0.2]
    : [1, 3]
  return (input * ip + output * op) / 1_000_000
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

const DIST_COLORS = ['var(--accent)', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#6b7280']

export default function TokenMonitoringPage() {
  const { t } = useI18n()
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgent, setSelectedAgent] = useState('')
  const [stats, setStats] = useState<AgentTokenStats | null>(null)
  const [daily, setDaily] = useState<DailyStats[]>([])
  const [days, setDays] = useState(7)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    invoke<Agent[]>('list_agents').then((r) => {
      if (Array.isArray(r)) {
        setAgents(r)
        if (r.length > 0) setSelectedAgent(r[0].id)
      }
    }).catch((e) => {
      console.error('list_agents failed:', e)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!selectedAgent) return
    setLoading(true)
    Promise.all([
      invoke<AgentTokenStats>('get_token_stats', { agentId: selectedAgent, days }),
      invoke<DailyStats[]>('get_token_daily_stats', { agentId: selectedAgent, days }),
    ]).then(([s, d]) => {
      setStats(s)
      setDaily(d || [])
    }).catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedAgent, days])

  const totalCost = stats?.models?.reduce((sum, m) =>
    sum + estimateCost(m.model, m.input_tokens, m.output_tokens), 0) ?? 0
  const maxDaily = Math.max(...daily.map(d => d.totalTokens), 1)
  const totalCalls = stats?.models?.reduce((s, m) => s + m.calls, 0) ?? 0

  // 统计卡片配置
  const statCards = [
    { label: t('tokens.statTotal'), value: formatTokens(stats?.total_tokens ?? 0), icon: 'token', color: 'var(--accent)', gradient: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(6,182,212,0.08))' },
    { label: t('tokens.statInput'), value: formatTokens(stats?.total_input_tokens ?? 0), icon: 'input', color: '#3b82f6', gradient: 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(99,102,241,0.08))' },
    { label: t('tokens.statOutput'), value: formatTokens(stats?.total_output_tokens ?? 0), icon: 'output', color: '#f59e0b', gradient: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(251,146,60,0.08))' },
    { label: t('tokens.statCost'), value: `$${totalCost.toFixed(2)}`, icon: 'cost', color: '#ef4444', gradient: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(244,63,94,0.08))' },
  ]

  const iconSvgs: Record<string, React.ReactNode> = {
    token: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M6 12h12"/></svg>,
    input: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>,
    output: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>,
    cost: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 960 }}>
      {/* 页头 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-heading)' }}>{t('tokens.title')}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Select
            value={selectedAgent}
            onChange={setSelectedAgent}
            options={agents.map(a => ({ value: a.id, label: `${a.name} (${a.model})` }))}
            style={{ minWidth: 220 }}
          />
          <div style={{
            display: 'flex', borderRadius: 8, overflow: 'hidden',
            border: '1px solid var(--border-subtle)',
          }}>
            {[7, 14, 30].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                border: 'none', cursor: 'pointer',
                backgroundColor: days === d ? 'var(--accent)' : 'var(--bg-elevated)',
                color: days === d ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.15s ease',
              }}>{d}{t('tokens.labelDays')}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 200, color: 'var(--text-muted)',
        }}>{t('common.loading')}</div>
      ) : stats && (
        <>
          {/* 统计卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            {statCards.map(({ label, value, icon, color, gradient }) => (
              <div key={label} style={{
                padding: '20px 16px', borderRadius: 14,
                background: gradient,
                border: '1px solid var(--border-subtle)',
                backdropFilter: 'var(--glass-blur)',
                display: 'flex', alignItems: 'center', gap: 14,
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: `${color}18`, color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {iconSvgs[icon]}
                </div>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 每日趋势 */}
          {daily.length > 0 && (
            <div style={{
              marginBottom: 28, padding: '20px 24px', borderRadius: 14,
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              backdropFilter: 'var(--glass-blur)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>
                  {t('tokens.sectionDailyTrend')}
                </h3>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {totalCalls} {t('tokens.columnCalls')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140, padding: '0 2px' }}>
                {daily.map((d, i) => {
                  const pct = d.totalTokens / maxDaily
                  return (
                    <div key={i} style={{
                      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: 4,
                    }}>
                      {pct > 0.05 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>
                          {formatTokens(d.totalTokens)}
                        </div>
                      )}
                      <div
                        style={{
                          width: '70%', maxWidth: 36,
                          height: `${Math.max(pct * 100, 2)}px`,
                          background: 'var(--accent-gradient)',
                          borderRadius: '6px 6px 2px 2px',
                          transition: 'height 0.3s ease',
                          cursor: 'pointer',
                          position: 'relative',
                        }}
                        title={`${d.date}\n${formatTokens(d.totalTokens)} tokens\n${d.calls} calls\n$${estimateCost('', d.inputTokens, d.outputTokens).toFixed(4)}`}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '0.8' }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                      />
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.date.slice(5)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* 模型分布 */}
          {stats.models.length > 1 && (
            <div style={{
              marginBottom: 28, padding: '20px 24px', borderRadius: 14,
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              backdropFilter: 'var(--glass-blur)',
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>
                {t('tokens.sectionDistribution') || 'Model Distribution'}
              </h3>
              <div style={{ display: 'flex', height: 28, borderRadius: 8, overflow: 'hidden' }}>
                {(() => {
                  const total = stats.models.reduce((s, m) => s + m.total_tokens, 0)
                  return stats.models.map((m, i) => {
                    const pct = total > 0 ? (m.total_tokens / total * 100) : 0
                    return pct > 0 ? (
                      <div key={m.model} title={`${m.model}: ${pct.toFixed(1)}%`}
                        style={{
                          width: `${pct}%`, backgroundColor: DIST_COLORS[i % DIST_COLORS.length],
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'width 0.3s ease',
                        }}>
                        {pct > 10 && (
                          <span style={{ fontSize: 10, color: '#fff', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 6px' }}>
                            {m.model.split('/').pop()}
                          </span>
                        )}
                      </div>
                    ) : null
                  })
                })()}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 10 }}>
                {(() => {
                  const total = stats.models.reduce((s, m) => s + m.total_tokens, 0)
                  return stats.models.map((m, i) => (
                    <span key={m.model} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: DIST_COLORS[i % DIST_COLORS.length], display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontWeight: 500 }}>{m.model}</span>
                      <span style={{ color: 'var(--text-muted)' }}>({(m.total_tokens / total * 100).toFixed(1)}%)</span>
                    </span>
                  ))
                })()}
              </div>
            </div>
          )}

          {/* 模型明细表 */}
          {stats.models.length > 0 && (
            <div style={{
              padding: '20px 24px', borderRadius: 14,
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              backdropFilter: 'var(--glass-blur)',
            }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--text-heading)' }}>
                {t('tokens.sectionModels')}
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 13 }}>
                  <thead>
                    <tr>
                      {[
                        { label: t('tokens.columnModel'), align: 'left' as const },
                        { label: t('tokens.columnInput'), align: 'right' as const },
                        { label: t('tokens.columnOutput'), align: 'right' as const },
                        { label: t('tokens.columnTotal'), align: 'right' as const },
                        { label: t('tokens.columnCalls'), align: 'right' as const },
                        { label: t('tokens.columnCost'), align: 'right' as const },
                      ].map(col => (
                        <th key={col.label} style={{
                          textAlign: col.align, padding: '10px 14px',
                          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                          textTransform: 'uppercase', letterSpacing: '0.5px',
                          borderBottom: '1px solid var(--border-subtle)',
                        }}>{col.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.models.map((m, i) => {
                      const cost = estimateCost(m.model, m.input_tokens, m.output_tokens)
                      return (
                        <tr key={m.model}
                          style={{ transition: 'background 0.1s ease' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-glass-hover)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = '' }}
                        >
                          <td style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                                backgroundColor: DIST_COLORS[i % DIST_COLORS.length],
                              }} />
                              <span style={{ fontFamily: "'SF Mono', Monaco, monospace", fontWeight: 500, fontSize: 12 }}>
                                {m.model}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                            {formatTokens(m.input_tokens)}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                            {formatTokens(m.output_tokens)}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)' }}>
                            {formatTokens(m.total_tokens)}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                            {m.calls}
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 500, color: cost > 1 ? 'var(--error)' : 'var(--text-accent)', borderBottom: '1px solid var(--border-subtle)' }}>
                            ${cost.toFixed(4)}
                          </td>
                        </tr>
                      )
                    })}
                    {/* 合计行 */}
                    <tr>
                      <td style={{ padding: '14px', fontWeight: 700, fontSize: 12 }}>{t('tokens.totalRow') || 'Total'}</td>
                      <td style={{ padding: '14px', textAlign: 'right', fontWeight: 600 }}>
                        {formatTokens(stats.models.reduce((s, m) => s + m.input_tokens, 0))}
                      </td>
                      <td style={{ padding: '14px', textAlign: 'right', fontWeight: 600 }}>
                        {formatTokens(stats.models.reduce((s, m) => s + m.output_tokens, 0))}
                      </td>
                      <td style={{ padding: '14px', textAlign: 'right', fontWeight: 700 }}>
                        {formatTokens(stats.models.reduce((s, m) => s + m.total_tokens, 0))}
                      </td>
                      <td style={{ padding: '14px', textAlign: 'right', fontWeight: 600 }}>
                        {stats.models.reduce((s, m) => s + m.calls, 0)}
                      </td>
                      <td style={{ padding: '14px', textAlign: 'right', fontWeight: 700, color: 'var(--error)', fontSize: 14 }}>
                        ${totalCost.toFixed(4)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
