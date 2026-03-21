/**
 * 设置页面 - 动态多供应商管理
 *
 * 支持任意数量的 LLM 供应商配置，包括：
 * - 预置供应商（OpenAI、Anthropic、DeepSeek、通义千问、智谱AI、Moonshot、Ollama）
 * - 自定义供应商（自定义 Base URL）
 * - 每个供应商独立的模型列表管理
 * - 环境变量自动导入提示
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/tauri'

interface ProviderModel {
  id: string
  name: string
}

interface Provider {
  id: string
  name: string
  apiType: string // 'openai' | 'anthropic'
  baseUrl: string
  apiKey?: string
  apiKeyMasked?: string
  models: ProviderModel[]
  enabled: boolean
}

/** 预置供应商模板 */
const PRESET_PROVIDERS: Omit<Provider, 'apiKey' | 'apiKeyMasked'>[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    ],
    enabled: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiType: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    ],
    enabled: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiType: 'openai',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ],
    enabled: true,
  },
  {
    id: 'qwen',
    name: '通义千问',
    apiType: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen-turbo', name: 'Qwen Turbo' },
      { id: 'qwen-plus', name: 'Qwen Plus' },
      { id: 'qwen-max', name: 'Qwen Max' },
    ],
    enabled: true,
  },
  {
    id: 'zhipu',
    name: '智谱AI',
    apiType: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4-flash', name: 'GLM-4 Flash' },
      { id: 'glm-4', name: 'GLM-4' },
      { id: 'glm-4-plus', name: 'GLM-4 Plus' },
    ],
    enabled: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    apiType: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K' },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K' },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K' },
    ],
    enabled: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    apiType: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'llama3', name: 'Llama 3' },
      { id: 'qwen2', name: 'Qwen 2' },
      { id: 'mistral', name: 'Mistral' },
    ],
    enabled: true,
  },
]

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Provider | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')

  const loadProviders = async () => {
    try {
      const list = await invoke<Provider[]>('get_providers')
      setProviders(list || [])
    } catch (err) {
      console.error('加载供应商配置失败:', err)
    }
    setLoading(false)
  }

  useEffect(() => { loadProviders() }, [])

  const handleEdit = (p: Provider) => {
    setEditingId(p.id)
    setEditForm({ ...p, apiKey: '' }) // apiKey 需要重新输入
    setMessage(null)
  }

  const handleSave = async () => {
    if (!editForm) return
    try {
      await invoke('save_provider', { provider: editForm })
      setMessage({ type: 'success', text: `${editForm.name} 配置已保存` })
      setEditingId(null)
      setEditForm(null)
      await loadProviders()
    } catch (err) {
      setMessage({ type: 'error', text: '保存失败: ' + String(err) })
    }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`确定删除供应商 "${name}"？`)) return
    try {
      await invoke('delete_provider', { providerId: id })
      setMessage({ type: 'success', text: `${name} 已删除` })
      if (editingId === id) { setEditingId(null); setEditForm(null) }
      await loadProviders()
    } catch (err) {
      setMessage({ type: 'error', text: '删除失败: ' + String(err) })
    }
  }

  const handleAddPreset = async (preset: typeof PRESET_PROVIDERS[0]) => {
    // 检查是否已存在
    if (providers.some((p) => p.id === preset.id)) {
      setMessage({ type: 'error', text: `${preset.name} 已存在` })
      setShowAddMenu(false)
      return
    }
    try {
      await invoke('save_provider', {
        provider: { ...preset, apiKey: '' },
      })
      setMessage({ type: 'success', text: `${preset.name} 已添加，请配置 API Key` })
      setShowAddMenu(false)
      await loadProviders()
    } catch (err) {
      setMessage({ type: 'error', text: '添加失败: ' + String(err) })
    }
  }

  const handleAddCustom = async () => {
    const customId = 'custom-' + Date.now()
    const custom: Provider = {
      id: customId,
      name: '自定义供应商',
      apiType: 'openai',
      baseUrl: '',
      apiKey: '',
      models: [],
      enabled: true,
    }
    try {
      await invoke('save_provider', { provider: custom })
      setShowAddMenu(false)
      await loadProviders()
      // 自动进入编辑模式
      setEditingId(customId)
      setEditForm(custom)
    } catch (err) {
      setMessage({ type: 'error', text: '添加失败: ' + String(err) })
    }
  }

  const handleToggleEnabled = async (p: Provider) => {
    try {
      await invoke('save_provider', {
        provider: { ...p, enabled: !p.enabled, apiKey: '' },
      })
      await loadProviders()
    } catch (err) {
      setMessage({ type: 'error', text: '切换失败: ' + String(err) })
    }
  }

  const addModelToForm = () => {
    if (!editForm || !newModelId.trim()) return
    setEditForm({
      ...editForm,
      models: [...editForm.models, { id: newModelId.trim(), name: newModelName.trim() || newModelId.trim() }],
    })
    setNewModelId('')
    setNewModelName('')
  }

  const removeModelFromForm = (modelId: string) => {
    if (!editForm) return
    setEditForm({
      ...editForm,
      models: editForm.models.filter((m) => m.id !== modelId),
    })
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>加载中...</div>
  }

  // 未添加的预置供应商
  const availablePresets = PRESET_PROVIDERS.filter(
    (preset) => !providers.some((p) => p.id === preset.id)
  )

  return (
    <div style={{ padding: '20px', maxWidth: '700px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ marginTop: 0, marginBottom: '4px' }}>模型供应商</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', margin: 0 }}>
            管理 LLM 供应商和模型。支持 OpenAI 兼容接口的供应商可直接添加。
          </p>
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            style={{
              padding: '8px 16px', backgroundColor: 'var(--accent)', color: '#fff',
              border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer',
            }}
          >
            + 添加供应商
          </button>
          {showAddMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: '4px',
              backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, minWidth: '220px',
              padding: '4px 0',
            }}>
              {availablePresets.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => handleAddPreset(preset)}
                  style={{
                    padding: '8px 16px', cursor: 'pointer', fontSize: '13px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f5f5' }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                >
                  <span>{preset.name}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{preset.apiType}</span>
                </div>
              ))}
              {availablePresets.length > 0 && (
                <div style={{ borderTop: '1px solid #eee', margin: '4px 0' }} />
              )}
              <div
                onClick={handleAddCustom}
                style={{ padding: '8px 16px', cursor: 'pointer', fontSize: '13px', color: '#007bff' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f5f5' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                + 自定义供应商 (OpenAI 兼容)
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div style={{
          padding: '10px 15px', marginBottom: '16px', borderRadius: '6px', fontSize: '13px',
          backgroundColor: message.type === 'success' ? '#d4edda' : '#f8d7da',
          color: message.type === 'success' ? '#155724' : '#721c24',
          border: `1px solid ${message.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
        }}>
          {message.text}
        </div>
      )}

      {/* 供应商列表 */}
      {providers.map((p) => {
        const isEditing = editingId === p.id
        const hasKey = !!(p.apiKeyMasked && p.apiKeyMasked !== '')
        const isOllama = p.id === 'ollama' || p.baseUrl.includes('localhost')

        return (
          <div
            key={p.id}
            style={{
              marginBottom: '12px', padding: '16px',
              border: `1px solid ${p.enabled && (hasKey || isOllama) ? '#c3e6cb' : '#e0e0e0'}`,
              borderRadius: '8px',
              backgroundColor: !p.enabled ? '#fafafa' : (hasKey || isOllama) ? '#f8fff8' : '#fff',
              opacity: p.enabled ? 1 : 0.6,
            }}
          >
            {/* 供应商头部 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? '12px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={() => handleToggleEnabled(p)}
                    style={{ marginRight: '6px' }}
                  />
                </label>
                <strong style={{ fontSize: '15px' }}>{p.name}</strong>
                <span style={{
                  fontSize: '11px', padding: '2px 6px', borderRadius: '3px',
                  backgroundColor: hasKey || isOllama ? '#28a745' : '#ffc107',
                  color: hasKey || isOllama ? 'white' : '#333',
                }}>
                  {isOllama ? '本地' : hasKey ? '已配置' : '未配置 Key'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '2px 6px', backgroundColor: 'var(--bg-glass)', borderRadius: '3px' }}>
                  {p.apiType}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {!isEditing && (
                  <button
                    onClick={() => handleEdit(p)}
                    style={{
                      padding: '4px 12px', fontSize: '12px', cursor: 'pointer',
                      border: '1px solid var(--border-subtle)', borderRadius: '4px', backgroundColor: 'var(--bg-elevated)',
                    }}
                  >
                    编辑
                  </button>
                )}
                <button
                  onClick={() => handleDelete(p.id, p.name)}
                  style={{
                    padding: '4px 8px', fontSize: '12px', cursor: 'pointer',
                    border: '1px solid #f5c6cb', borderRadius: '4px', backgroundColor: 'var(--bg-elevated)', color: '#dc3545',
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            {/* 非编辑模式：显示模型列表摘要 */}
            {!isEditing && (
              <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                {(!p.models || p.models.length === 0) && (
                  <span style={{
                    fontSize: '12px', padding: '3px 10px', borderRadius: '4px',
                    backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffc107',
                  }}>
                    未添加模型 — 请点击"编辑"添加模型后才能在对话中使用
                  </span>
                )}
                {p.models?.map((m) => (
                  <span key={m.id} style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                    backgroundColor: '#e9ecef', color: '#495057',
                  }}>
                    {m.name || m.id}
                  </span>
                ))}
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', padding: '2px 4px' }}>
                  {p.baseUrl}
                </span>
              </div>
            )}

            {/* 编辑模式 */}
            {isEditing && editForm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>名称</label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>API 类型</label>
                    <select
                      value={editForm.apiType}
                      onChange={(e) => setEditForm({ ...editForm, apiType: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Base URL</label>
                  <input
                    value={editForm.baseUrl}
                    onChange={(e) => setEditForm({ ...editForm, baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>
                    API Key {p.apiKeyMasked && <span style={{ color: 'var(--text-muted)' }}>（当前: {p.apiKeyMasked}，留空保持不变）</span>}
                  </label>
                  <input
                    type="password"
                    value={editForm.apiKey || ''}
                    onChange={(e) => setEditForm({ ...editForm, apiKey: e.target.value })}
                    placeholder={p.apiKeyMasked ? '留空保持不变' : '输入 API Key'}
                    style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>

                {/* 模型列表编辑 */}
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                    模型列表 <span style={{ color: '#dc3545' }}>*</span>
                  </label>
                  {editForm.models.length === 0 && (
                    <div style={{
                      padding: '8px 12px', marginBottom: '8px', borderRadius: '4px',
                      backgroundColor: '#fff3cd', color: '#856404', fontSize: '12px',
                      border: '1px solid #ffc107',
                    }}>
                      请至少添加一个模型，否则无法在对话中使用此供应商。输入供应商支持的模型 ID（如 gpt-4o-mini、deepseek-chat 等）。
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
                    {editForm.models.map((m) => (
                      <span key={m.id} style={{
                        fontSize: '12px', padding: '3px 8px', borderRadius: '4px',
                        backgroundColor: '#e9ecef', display: 'flex', alignItems: 'center', gap: '4px',
                      }}>
                        {m.name || m.id}
                        <span
                          onClick={() => removeModelFromForm(m.id)}
                          style={{ cursor: 'pointer', color: '#dc3545', fontWeight: 'bold', fontSize: '14px', lineHeight: 1 }}
                        >
                          ×
                        </span>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      placeholder="模型 ID (如 gpt-4o)"
                      style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '12px' }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModelToForm() } }}
                    />
                    <input
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      placeholder="显示名称 (可选)"
                      style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--border-subtle)', borderRadius: '4px', fontSize: '12px' }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addModelToForm() } }}
                    />
                    <button
                      onClick={addModelToForm}
                      disabled={!newModelId.trim()}
                      style={{
                        padding: '5px 10px', fontSize: '12px', cursor: newModelId.trim() ? 'pointer' : 'not-allowed',
                        border: '1px solid var(--border-subtle)', borderRadius: '4px', backgroundColor: newModelId.trim() ? '#e9ecef' : '#f5f5f5',
                      }}
                    >
                      添加
                    </button>
                  </div>
                </div>

                {/* 保存/取消 */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setEditingId(null); setEditForm(null) }}
                    style={{
                      padding: '6px 16px', fontSize: '13px', cursor: 'pointer',
                      border: '1px solid var(--border-subtle)', borderRadius: '4px', backgroundColor: 'var(--bg-elevated)',
                    }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSave}
                    style={{
                      padding: '6px 16px', fontSize: '13px', cursor: 'pointer',
                      border: 'none', borderRadius: '4px', backgroundColor: 'var(--accent)', color: '#fff',
                    }}
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {providers.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0' }}>
          暂无供应商配置，点击上方「+ 添加供应商」开始
        </div>
      )}

      {/* 环境变量提示 */}
      <div style={{
        marginTop: '20px', padding: '12px', backgroundColor: '#f8f9fa',
        borderRadius: '6px', fontSize: '13px', color: 'var(--text-secondary)',
      }}>
        <strong>提示：</strong>支持通过环境变量自动导入 API Key（启动时读取）：
        <pre style={{
          margin: '8px 0 0', padding: '8px', backgroundColor: '#e9ecef',
          borderRadius: '4px', fontSize: '12px', overflow: 'auto',
        }}>
{`export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export DEEPSEEK_API_KEY="sk-..."`}
        </pre>
      </div>

      {/* 高级设置 */}
      <AdvancedSettings />
    </div>
  )
}

/** 高级设置面板（嵌入配置 + 系统状态 + 缓存统计） */
function AdvancedSettings() {
  const [expanded, setExpanded] = useState(false)
  const [embeddingKey, setEmbeddingKey] = useState('')
  const [embeddingUrl, setEmbeddingUrl] = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [embeddingDimensions, setEmbeddingDimensions] = useState('')
  const [dailyLimit, setDailyLimit] = useState('')
  const [cloudUrl, setCloudUrl] = useState('')
  const [cloudKey, setCloudKey] = useState('')
  const [health, setHealth] = useState<any>(null)
  const [cacheStats, setCacheStats] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  const loadSettings = async () => {
    try {
      const settings = await invoke<Record<string, string>>('get_settings_by_prefix', { prefix: 'embedding_' })
      setEmbeddingKey(settings?.embedding_api_key || '')
      setEmbeddingUrl(settings?.embedding_api_url || '')
      setEmbeddingModel(settings?.embedding_model || '')
      setEmbeddingDimensions(settings?.embedding_dimensions || '')
      const cloud = await invoke<Record<string, string>>('get_settings_by_prefix', { prefix: 'cloud_' })
      setCloudUrl(cloud?.cloud_gateway_url || '')
      setCloudKey(cloud?.cloud_api_key || '')
    } catch (e) { console.error(e) }
    try {
      const limit = await invoke<string | null>('get_setting', { key: 'daily_token_limit' })
      setDailyLimit(limit || '')
    } catch (e) { console.error(e) }
    try {
      setHealth(await invoke('health_check'))
      setCacheStats(await invoke('get_cache_stats'))
    } catch (e) { console.error(e) }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      if (embeddingKey) await invoke('set_setting', { key: 'embedding_api_key', value: embeddingKey })
      if (embeddingUrl) await invoke('set_setting', { key: 'embedding_api_url', value: embeddingUrl })
      if (embeddingModel) await invoke('set_setting', { key: 'embedding_model', value: embeddingModel })
      if (embeddingDimensions) await invoke('set_setting', { key: 'embedding_dimensions', value: embeddingDimensions })
      if (dailyLimit) await invoke('set_setting', { key: 'daily_token_limit', value: dailyLimit })
      if (cloudUrl) await invoke('set_setting', { key: 'cloud_gateway_url', value: cloudUrl })
      if (cloudKey) await invoke('set_setting', { key: 'cloud_api_key', value: cloudKey })
      alert('设置已保存')
    } catch (e: any) {
      alert('保存失败: ' + (e?.message || e))
    }
    setSaving(false)
  }

  useEffect(() => { if (expanded) loadSettings() }, [expanded])

  if (!expanded) {
    return (
      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        <button onClick={() => setExpanded(true)} style={{
          padding: '8px 20px', background: 'none', border: '1px solid #ccc',
          borderRadius: '4px', cursor: 'pointer', color: 'var(--text-secondary)',
        }}>
          高级设置
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: '20px', padding: '16px', border: '1px solid #e0e0e0', borderRadius: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ margin: 0 }}>高级设置</h3>
        <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
      </div>

      {/* 向量嵌入 */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>向量嵌入（语义检索）</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          配置后，记忆检索从关键词匹配升级为语义理解。支持 OpenAI 兼容 API。
        </p>
        <input placeholder="Embedding API Key（如 sk-...）" value={embeddingKey} onChange={e => setEmbeddingKey(e.target.value)}
          style={{ width: '100%', padding: '6px', marginBottom: '6px', boxSizing: 'border-box' }} type="password" />
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input placeholder="API URL（默认 OpenAI）" value={embeddingUrl} onChange={e => setEmbeddingUrl(e.target.value)}
            style={{ flex: 3, padding: '6px' }} />
          <input placeholder="模型" value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)}
            style={{ flex: 2, padding: '6px' }} />
          <input placeholder="维度" value={embeddingDimensions} onChange={e => setEmbeddingDimensions(e.target.value)}
            style={{ flex: 1, padding: '6px' }} type="number" />
        </div>
        <button
          onClick={async () => {
            if (!embeddingKey || !embeddingUrl) { alert('请先填写 API Key 和 URL'); return }
            try {
              const res = await fetch(embeddingUrl, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${embeddingKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: embeddingModel || 'text-embedding-3-small', input: '测试连接', dimensions: parseInt(embeddingDimensions) || 1024 }),
              })
              const data = await res.json()
              if (data?.data?.[0]?.embedding) {
                alert(`连接成功！维度: ${data.data[0].embedding.length}, Token: ${data.usage?.total_tokens || '?'}`)
              } else {
                alert('连接失败: ' + JSON.stringify(data).substring(0, 200))
              }
            } catch (e: any) { alert('连接失败: ' + (e?.message || e)) }
          }}
          style={{ padding: '4px 12px', fontSize: '12px', border: '1px solid var(--border-subtle)', borderRadius: '4px', cursor: 'pointer', backgroundColor: 'var(--bg-elevated)' }}
        >
          测试连接
        </button>
      </div>

      {/* 云端连接（混合架构） */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>云端连接（混合架构）</h4>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          配置后，桌面端自动连接云端。移动端可通过云端远程控制桌面 Agent。
        </p>
        <input placeholder="Gateway URL（如 wss://zys-openclaw.com/ws/bridge）" value={cloudUrl} onChange={e => setCloudUrl(e.target.value)}
          style={{ width: '100%', padding: '6px', marginBottom: '6px', boxSizing: 'border-box' }} />
        <input placeholder="API Key" value={cloudKey} onChange={e => setCloudKey(e.target.value)}
          style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }} type="password" />
      </div>

      {/* Token 限额 */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px', color: 'var(--text-secondary)' }}>每日 Token 限额</h4>
        <input placeholder="每日上限（0 = 不限制）" value={dailyLimit} onChange={e => setDailyLimit(e.target.value)}
          style={{ width: '200px', padding: '6px' }} type="number" />
      </div>

      <button onClick={saveSettings} disabled={saving} style={{
        padding: '8px 20px', backgroundColor: 'var(--success)', color: 'white',
        border: 'none', borderRadius: '4px', cursor: saving ? 'not-allowed' : 'pointer',
        marginBottom: '16px',
      }}>
        {saving ? '保存中...' : '保存设置'}
      </button>

      {/* 系统状态 */}
      {health && (
        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '6px', fontSize: '13px' }}>
          <h4 style={{ margin: '0 0 8px' }}>系统状态</h4>
          <div>数据库: {health.db ? '正常' : '异常'} | Agent: {health.agents} | 记忆: {health.memories} | 今日 Token: {health.today_tokens?.toLocaleString()}</div>
          {cacheStats && (
            <div style={{ marginTop: '4px' }}>
              响应缓存: {cacheStats.response_cache?.entries} 条 ({cacheStats.response_cache?.total_hits} 次命中) |
              嵌入缓存: {cacheStats.embedding_cache?.entries} 条
            </div>
          )}
        </div>
      )}
    </div>
  )
}
