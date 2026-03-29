/**
 * 登录页
 *
 * 用户登出后显示，支持通过 token 重新登录
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useI18n } from '../i18n'

export default function LoginPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    const trimmed = token.trim()
    if (!trimmed) { setError(t('login.tokenRequired')); return }
    setLoading(true)
    setError('')
    try {
      // 解析 token（JWT base64 payload 或简单 token）
      let user = { id: '', email: '', name: '', role: 'user', enterpriseId: '' }
      try {
        const parts = trimmed.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]))
          user = {
            id: payload.sub || payload.id || '',
            email: payload.email || '',
            name: payload.name || payload.email || 'User',
            role: payload.role || 'user',
            enterpriseId: payload.enterprise_id || payload.enterpriseId || '',
          }
        }
      } catch {
        // 非 JWT token，用默认 user
        user.name = 'User'
      }
      login(trimmed, user)
      navigate('/agents', { replace: true })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // 跳过登录（作为本地用户继续使用）
  const handleSkip = () => {
    localStorage.removeItem('had_login')
    navigate('/agents', { replace: true })
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary, #0a0a14)',
    }}>
      <div style={{
        width: 380, padding: 32, borderRadius: 16,
        background: 'var(--bg-elevated, #1a1a2e)',
        border: '1px solid var(--border-subtle, #2a2a3e)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
            {t('login.title')}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted, #888)' }}>
            {t('login.subtitle')}
          </p>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary, #aaa)', marginBottom: 6 }}>
            Token
          </label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleLogin() }}
            placeholder={t('login.tokenPlaceholder')}
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14,
              border: '1px solid var(--border-subtle, #2a2a3e)',
              borderRadius: 8, backgroundColor: 'var(--bg-primary, #0a0a14)',
              color: 'var(--text-primary, #fff)', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--error, #ef4444)', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%', padding: 10, fontSize: 14, fontWeight: 600,
            border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
            background: 'var(--accent-gradient, linear-gradient(135deg, #10b981, #06b6d4))',
            color: '#fff', opacity: loading ? 0.6 : 1,
            marginBottom: 10,
          }}
        >
          {loading ? t('common.loading') : t('login.loginBtn')}
        </button>

        <button
          onClick={handleSkip}
          style={{
            width: '100%', padding: 8, fontSize: 13,
            border: '1px solid var(--border-subtle, #2a2a3e)',
            borderRadius: 8, cursor: 'pointer',
            background: 'transparent', color: 'var(--text-muted, #888)',
          }}
        >
          {t('login.skipBtn')}
        </button>
      </div>
    </div>
  )
}
