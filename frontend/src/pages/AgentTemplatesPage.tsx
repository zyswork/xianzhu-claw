import { useEffect, useState } from 'react'
import { api } from '../api/tauriHttp'
import { getEnterpriseId } from '../utils/auth'

interface AgentTemplate {
  id: string
  name: string
  description: string
  category: string
  config: string
  status: 'draft' | 'published' | 'deprecated'
  createdAt: string
}

export default function AgentTemplatesPage() {
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTpl, setEditTpl] = useState<AgentTemplate | null>(null)
  const [form, setForm] = useState({ name: '', description: '', category: '', config: '{}' })
  const [error, setError] = useState('')

  const enterpriseId = getEnterpriseId()

  const loadTemplates = async () => {
    try {
      const res = await api.get(`/api/v1/agent-templates/enterprise/${enterpriseId}`)
      if (res.ok) setTemplates(res.data.templates || [])
    } catch (e) { console.error('加载模板失败:', e) }
    setLoading(false)
  }

  useEffect(() => { loadTemplates() }, [])

  const handleSubmit = async () => {
    setError('')
    const body = { name: form.name, description: form.description, category: form.category, config: form.config, createdBy: 'current_user' }
    try {
      if (editTpl) {
        const res = await api.put(`/api/v1/agent-templates/${editTpl.id}`, body)
        if (!res.ok) { setError(res.data?.error || '更新失败'); return }
      } else {
        const res = await api.post(`/api/v1/agent-templates/enterprise/${enterpriseId}`, body)
        if (!res.ok) { setError(res.data?.error || '创建失败'); return }
      }
      setShowForm(false); setEditTpl(null); setForm({ name: '', description: '', category: '', config: '{}' })
      loadTemplates()
    } catch (e) { setError('网络错误: ' + String(e)) }
  }

  const handleEdit = (tpl: AgentTemplate) => {
    setEditTpl(tpl)
    setForm({ name: tpl.name, description: tpl.description || '', category: tpl.category || '', config: tpl.config || '{}' })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该模板？')) return
    await api.delete(`/api/v1/agent-templates/${id}`)
    loadTemplates()
  }

  const handlePublish = async (id: string) => {
    await api.post(`/api/v1/agent-templates/${id}/publish`)
    loadTemplates()
  }

  if (loading) return <div style={{ padding: '20px' }}>加载中...</div>

  return (
    <div style={{ padding: '20px' }}>
      <h1>Agent 模板</h1>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => { setShowForm(!showForm); setEditTpl(null); setForm({ name: '', description: '', category: '', config: '{}' }) }}
          style={{ padding: '10px 20px', backgroundColor: '#ffc107', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {showForm ? '取消' : '创建模板'}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px' }}>
          <h3>{editTpl ? '编辑模板' : '新建模板'}</h3>
          {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}
          <input placeholder="模板名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <textarea placeholder="描述" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <input placeholder="分类" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <textarea placeholder="配置 (JSON)" value={form.config} onChange={e => setForm({ ...form, config: e.target.value })} rows={4}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box', fontFamily: 'monospace' }} />
          <button onClick={handleSubmit}
            style={{ padding: '8px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {editTpl ? '保存' : '创建'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
        {templates.map((tpl) => (
          <div key={tpl.id} style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>{tpl.name}</h3>
            <p style={{ margin: '0 0 10px 0', color: '#666' }}>{tpl.description}</p>
            <div style={{ marginBottom: '10px' }}><strong>分类:</strong> {tpl.category}</div>
            <div style={{ marginBottom: '10px' }}>
              <strong>状态:</strong>{' '}
              <span style={{ padding: '3px 8px', backgroundColor: tpl.status === 'published' ? '#d4edda' : '#fff3cd', borderRadius: '3px', fontSize: '12px' }}>
                {tpl.status}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => handleEdit(tpl)} style={{ padding: '5px 10px', cursor: 'pointer' }}>编辑</button>
              {tpl.status === 'draft' && (
                <button onClick={() => handlePublish(tpl.id)} style={{ padding: '5px 10px', cursor: 'pointer', color: '#28a745' }}>发布</button>
              )}
              <button onClick={() => handleDelete(tpl.id)} style={{ padding: '5px 10px', cursor: 'pointer', color: 'red' }}>删除</button>
            </div>
          </div>
        ))}
        {templates.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#999', gridColumn: '1/-1' }}>暂无模板</div>}
      </div>
    </div>
  )
}
