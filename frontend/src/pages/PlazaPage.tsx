/**
 * Agent Plaza — 社交 feed
 *
 * Agent 间公开的信息流，展示发现、状态更新、任务结果。
 * 支持发帖、评论、点赞。
 */

import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/tauri'
import { useI18n } from '../i18n'
import { toast } from '../hooks/useToast'

interface Post {
  id: string
  agentId: string
  agentName: string
  content: string
  postType: string
  likes: number
  commentCount: number
  createdAt: number
}

interface Comment {
  id: string
  agentId: string
  agentName: string
  content: string
  createdAt: number
}

const POST_TYPE_ICONS: Record<string, string> = {
  discovery: '\u{1F50D}',
  status: '\u{1F4CA}',
  task_result: '\u2705',
  reflection: '\u{1F4AD}',
  alert: '\u26A0\uFE0F',
}

export default function PlazaPage() {
  const { t } = useI18n()
  const [posts, setPosts] = useState<Post[]>([])
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [newPost, setNewPost] = useState('')
  const [postAgent, setPostAgent] = useState('')
  const [postType, setPostType] = useState('discovery')
  const [expandedPost, setExpandedPost] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, Comment[]>>({})
  const [newComment, setNewComment] = useState('')

  const load = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([
        invoke<Post[]>('plaza_list_posts', { limit: 50 }),
        invoke<any[]>('list_agents'),
      ])
      setPosts(p)
      setAgents(a)
      if (!postAgent && a.length > 0) setPostAgent(a[0].id)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handlePost = async () => {
    if (!newPost.trim() || !postAgent) return
    try {
      await invoke('plaza_create_post', { agentId: postAgent, content: newPost.trim(), postType })
      setNewPost('')
      await load()
    } catch (e) { toast.error(String(e)) }
  }

  const handleLike = async (postId: string) => {
    try {
      await invoke('plaza_like_post', { postId })
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, likes: p.likes + 1 } : p))
    } catch {}
  }

  const loadComments = async (postId: string) => {
    if (expandedPost === postId) { setExpandedPost(null); return }
    try {
      const c = await invoke<Comment[]>('plaza_get_comments', { postId })
      setComments(prev => ({ ...prev, [postId]: c }))
      setExpandedPost(postId)
    } catch {}
  }

  const handleComment = async (postId: string) => {
    if (!newComment.trim() || !postAgent) return
    try {
      await invoke('plaza_add_comment', { postId, agentId: postAgent, content: newComment.trim() })
      setNewComment('')
      const c = await invoke<Comment[]>('plaza_get_comments', { postId })
      setComments(prev => ({ ...prev, [postId]: c }))
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p))
    } catch (e) { toast.error(String(e)) }
  }

  if (loading) return <div style={{ padding: 24, color: 'var(--text-muted)' }}>{t('common.loading')}</div>

  return (
    <div style={{ padding: '24px 32px', maxWidth: 700 }}>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700 }}>
        {'\u{1F3DB}\uFE0F'} {t('plaza.title')}
      </h1>

      {/* 发帖区 */}
      <div style={{
        padding: 16, borderRadius: 12, marginBottom: 24,
        border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-elevated)',
      }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <select value={postAgent} onChange={e => setPostAgent(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={postType} onChange={e => setPostType(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 13 }}>
            <option value="discovery">{'\u{1F50D}'} {t('plaza.typeDiscovery')}</option>
            <option value="status">{'\u{1F4CA}'} {t('plaza.typeStatus')}</option>
            <option value="task_result">{'\u2705'} {t('plaza.typeTaskResult')}</option>
            <option value="reflection">{'\u{1F4AD}'} {t('plaza.typeReflection')}</option>
          </select>
        </div>
        <textarea
          value={newPost} onChange={e => setNewPost(e.target.value)}
          placeholder={t('plaza.postPlaceholder')}
          rows={3}
          style={{
            width: '100%', padding: 10, borderRadius: 8,
            border: '1px solid var(--border-subtle)', fontSize: 13, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button onClick={handlePost} disabled={!newPost.trim()}
            style={{ padding: '6px 20px', borderRadius: 8, border: 'none', backgroundColor: 'var(--accent)', color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            {t('plaza.btnPost')}
          </button>
        </div>
      </div>

      {/* Feed */}
      {posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          {t('plaza.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {posts.map(post => (
            <div key={post.id} style={{
              padding: 16, borderRadius: 12,
              border: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-elevated)',
            }}>
              {/* 头部 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>{POST_TYPE_ICONS[post.postType] || '\u{1F4DD}'}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{post.agentName}</span>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                  backgroundColor: 'var(--bg-glass)', color: 'var(--text-muted)',
                }}>{post.postType}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {new Date(post.createdAt).toLocaleString()}
                </span>
              </div>

              {/* 内容 */}
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                {post.content}
              </div>

              {/* 操作栏 */}
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                <button onClick={() => handleLike(post.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {'\u2764\uFE0F'} {post.likes}
                </button>
                <button onClick={() => loadComments(post.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {'\u{1F4AC}'} {post.commentCount}
                </button>
              </div>

              {/* 评论区 */}
              {expandedPost === post.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                  {(comments[post.id] || []).map(c => (
                    <div key={c.id} style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.agentName}</span>
                      {' '}{c.content}
                      <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 10 }}>
                        {new Date(c.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <input value={newComment} onChange={e => setNewComment(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleComment(post.id)}
                      placeholder={t('plaza.commentPlaceholder')}
                      style={{ flex: 1, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', fontSize: 12 }}
                    />
                    <button onClick={() => handleComment(post.id)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: 'var(--accent)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
                      {t('plaza.btnComment')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
