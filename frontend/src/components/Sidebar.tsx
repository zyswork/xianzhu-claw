/**
 * 侧边栏 — 深色风格（参考 PetClaw 左侧导航）
 */

import { useNavigate, useLocation } from 'react-router-dom'
import { useI18n } from '../i18n'

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()

  const menuItems = [
    { icon: '\u{1F4AC}', label: t('sidebar.chat'), path: '/agents' },
    { icon: '\u{1F9E9}', label: t('sidebar.skills'), path: '/skills' },
    { icon: '\u23F0', label: t('sidebar.cron'), path: '/cron' },
    { icon: '\u{1F4E8}', label: t('sidebar.channels'), path: '/channels' },
    { icon: '\u{1F50C}', label: t('sidebar.plugins'), path: '/plugins' },
    { icon: '\u{1F4CA}', label: t('sidebar.dashboard'), path: '/dashboard' },
    { icon: '\u{1F9E0}', label: t('sidebar.memory'), path: '/memory' },
    { icon: '\u2699\uFE0F', label: t('sidebar.settings'), path: '/settings' },
  ]

  return (
    <aside style={{
      width: '200px',
      backgroundColor: 'var(--sidebar-bg)',
      display: 'flex',
      flexDirection: 'column',
      color: 'var(--sidebar-text)',
    }}>
      {/* Logo */}
      <div style={{ padding: '20px 18px 16px', borderBottom: '1px solid var(--sidebar-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/avatar-ai.png" alt="YonClaw" style={{ width: 32, height: 32, borderRadius: '50%' }} />
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>YonClaw</div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.4)' }}>AI Assistant</div>
          </div>
        </div>
      </div>

      {/* + 新建聊天 */}
      <div style={{ padding: '12px 14px 8px' }}>
        <button
          onClick={() => navigate('/agents/new')}
          style={{
            width: '100%', padding: '8px', borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.08)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer',
            fontSize: 13, fontWeight: 500,
          }}
        >
          + 新建聊天
        </button>
      </div>

      {/* 导航 */}
      <nav style={{ flex: 1, padding: '4px 0' }}>
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path ||
            (item.path === '/agents' && location.pathname.startsWith('/agents'))
          return (
            <a
              key={item.path}
              href={item.path}
              onClick={(e) => { e.preventDefault(); navigate(item.path) }}
              style={{
                display: 'block',
                padding: '9px 18px',
                color: isActive ? '#fff' : 'var(--sidebar-text)',
                textDecoration: 'none',
                fontSize: '13px',
                backgroundColor: isActive ? 'var(--sidebar-active)' : 'transparent',
                fontWeight: isActive ? 600 : 400,
                borderRadius: 0,
                transition: 'all 0.12s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'rgba(255,255,255,0.06)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = isActive ? 'var(--sidebar-active)' : 'transparent'
              }}
            >
              {item.icon}  {item.label}
            </a>
          )
        })}
      </nav>

      {/* 底部 */}
      <div style={{ padding: '8px 14px' }}>
        <a
          href="/audit"
          onClick={(e) => { e.preventDefault(); navigate('/audit') }}
          style={{ display: 'block', padding: '6px 4px', fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}
        >
          {'\u{1F4DD}'} 审计日志
        </a>
        <a
          href="/token-monitoring"
          onClick={(e) => { e.preventDefault(); navigate('/token-monitoring') }}
          style={{ display: 'block', padding: '6px 4px', fontSize: 12, color: 'rgba(255,255,255,0.35)', textDecoration: 'none' }}
        >
          {'\u{1F4C8}'} Token 监控
        </a>
      </div>

      <div style={{
        padding: '10px 18px',
        borderTop: '1px solid var(--sidebar-border)',
        fontSize: '11px',
        color: 'rgba(255,255,255,0.25)',
      }}>
        YonClaw v0.1.0
      </div>
    </aside>
  )
}
