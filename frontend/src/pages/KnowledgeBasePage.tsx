import { useEffect, useState } from 'react'
import { api } from '../api/tauriHttp'
import { getEnterpriseId } from '../utils/auth'

interface Document {
  id: string
  title: string
  content: string
  tags: string[]
  status: 'draft' | 'published' | 'archived'
  createdAt: string
}

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editDoc, setEditDoc] = useState<Document | null>(null)
  const [form, setForm] = useState({ title: '', content: '', tags: '', contentType: 'text' })
  const [error, setError] = useState('')

  const enterpriseId = getEnterpriseId()

  const loadDocuments = async () => {
    try {
      const res = await api.get(`/api/v1/knowledge-base/enterprise/${enterpriseId}`)
      if (res.ok) {
        const docs = (res.data.documents || []).map((d: any) => ({
          ...d,
          tags: typeof d.tags === 'string' ? (d.tags ? d.tags.split(',') : []) : (d.tags || [])
        }))
        setDocuments(docs)
      }
    } catch (e) { console.error('加载文档失败:', e) }
    setLoading(false)
  }

  useEffect(() => { loadDocuments() }, [])

  const handleSubmit = async () => {
    setError('')
    const body = { title: form.title, content: form.content, tags: form.tags, contentType: form.contentType, createdBy: 'current_user' }
    try {
      if (editDoc) {
        const res = await api.put(`/api/v1/knowledge-base/${editDoc.id}`, body)
        if (!res.ok) { setError(res.data?.error || '更新失败'); return }
      } else {
        const res = await api.post(`/api/v1/knowledge-base/enterprise/${enterpriseId}`, body)
        if (!res.ok) { setError(res.data?.error || '创建失败'); return }
      }
      setShowForm(false); setEditDoc(null); setForm({ title: '', content: '', tags: '', contentType: 'text' })
      loadDocuments()
    } catch (e) { setError('网络错误: ' + String(e)) }
  }

  const handleEdit = (doc: Document) => {
    setEditDoc(doc)
    setForm({ title: doc.title, content: doc.content, tags: Array.isArray(doc.tags) ? doc.tags.join(',') : '', contentType: 'text' })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该文档？')) return
    await api.delete(`/api/v1/knowledge-base/${id}`)
    loadDocuments()
  }

  const filteredDocuments = documents.filter(
    (doc) =>
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (Array.isArray(doc.tags) && doc.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase())))
  )

  if (loading) return <div style={{ padding: '20px' }}>加载中...</div>

  return (
    <div style={{ padding: '20px' }}>
      <h1>知识库</h1>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <input type="text" placeholder="搜索文档..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }} />
        <button onClick={() => { setShowForm(!showForm); setEditDoc(null); setForm({ title: '', content: '', tags: '', contentType: 'text' }) }}
          style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {showForm ? '取消' : '上传文档'}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px' }}>
          <h3>{editDoc ? '编辑文档' : '新建文档'}</h3>
          {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}
          <input placeholder="标题" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <textarea placeholder="内容" value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={6}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <input placeholder="标签（逗号分隔）" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <button onClick={handleSubmit}
            style={{ padding: '8px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {editDoc ? '保存' : '创建'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gap: '15px' }}>
        {filteredDocuments.map((doc) => (
          <div key={doc.id} style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>{doc.title}</h3>
            <p style={{ margin: '0 0 10px 0', color: '#666' }}>{doc.content?.substring(0, 100)}...</p>
            <div style={{ marginBottom: '10px' }}>
              {Array.isArray(doc.tags) && doc.tags.map((tag) => (
                <span key={tag} style={{ display: 'inline-block', padding: '3px 8px', backgroundColor: '#e9ecef', borderRadius: '3px', marginRight: '5px', fontSize: '12px' }}>
                  {tag}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => handleEdit(doc)} style={{ padding: '5px 10px', cursor: 'pointer' }}>编辑</button>
              <button onClick={() => handleDelete(doc.id)} style={{ padding: '5px 10px', cursor: 'pointer', color: 'red' }}>删除</button>
            </div>
          </div>
        ))}
        {filteredDocuments.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>暂无文档</div>}
      </div>
    </div>
  )
}
