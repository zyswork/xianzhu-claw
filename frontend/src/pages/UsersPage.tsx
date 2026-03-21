import { useEffect, useState } from 'react'
import { api } from '../api/tauriHttp'
import { getEnterpriseId } from '../utils/auth'

interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'user'
  status: 'active' | 'inactive' | 'suspended'
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [form, setForm] = useState({ email: '', name: '', role: 'user', password: 'Default123!' })
  const [error, setError] = useState('')

  const enterpriseId = getEnterpriseId()

  const loadUsers = async () => {
    try {
      const res = await api.get(`/api/v1/users/enterprise/${enterpriseId}`)
      if (res.ok) setUsers(res.data.users || [])
    } catch (e) { console.error('加载用户失败:', e) }
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  const handleSubmit = async () => {
    setError('')
    try {
      if (editUser) {
        const res = await api.put(`/api/v1/users/${editUser.id}`, { name: form.name, role: form.role })
        if (!res.ok) { setError(res.data?.error || '更新失败'); return }
      } else {
        const res = await api.post(`/api/v1/users/enterprise/${enterpriseId}`, form)
        if (!res.ok) { setError(res.data?.error || '创建失败'); return }
      }
      setShowForm(false)
      setEditUser(null)
      setForm({ email: '', name: '', role: 'user', password: 'Default123!' })
      loadUsers()
    } catch (e) { setError('网络错误: ' + String(e)) }
  }

  const handleEdit = (user: User) => {
    setEditUser(user)
    setForm({ email: user.email, name: user.name, role: user.role, password: '' })
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该用户？')) return
    await api.delete(`/api/v1/users/${id}`)
    loadUsers()
  }

  if (loading) return <div style={{ padding: '20px' }}>加载中...</div>

  return (
    <div style={{ padding: '20px' }}>
      <h1>用户管理</h1>

      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => { setShowForm(!showForm); setEditUser(null); setForm({ email: '', name: '', role: 'user', password: 'Default123!' }) }}
          style={{ padding: '10px 20px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {showForm ? '取消' : '添加用户'}
        </button>
      </div>

      {showForm && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '4px' }}>
          <h3>{editUser ? '编辑用户' : '新建用户'}</h3>
          {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}
          {!editUser && (
            <input placeholder="邮箱" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          )}
          <input placeholder="名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
            style={{ display: 'block', width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }}>
            <option value="user">用户</option>
            <option value="manager">经理</option>
            <option value="admin">管理员</option>
          </select>
          <button onClick={handleSubmit}
            style={{ padding: '8px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            {editUser ? '保存' : '创建'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ddd' }}>
            <th style={{ padding: '10px', textAlign: 'left' }}>邮箱</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>名称</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>角色</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>状态</th>
            <th style={{ padding: '10px', textAlign: 'left' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '10px' }}>{user.email}</td>
              <td style={{ padding: '10px' }}>{user.name}</td>
              <td style={{ padding: '10px' }}>{user.role}</td>
              <td style={{ padding: '10px' }}>{user.status}</td>
              <td style={{ padding: '10px' }}>
                <button onClick={() => handleEdit(user)} style={{ marginRight: '5px', padding: '5px 10px', cursor: 'pointer' }}>编辑</button>
                <button onClick={() => handleDelete(user.id)} style={{ padding: '5px 10px', cursor: 'pointer', color: 'red' }}>删除</button>
              </td>
            </tr>
          ))}
          {users.length === 0 && <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: '#999' }}>暂无用户</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
