/**
 * i18n 组件库
 *
 * 提供声明式的多语言组件，不需要每个文件手动 useI18n + t()
 * 用法：<T k="dashboard.title" /> 或 <T k="common.save" as="button" />
 */

import React from 'react'
import { useI18n } from './store'
import { showConfirm } from '../hooks/useConfirm'

// ─── 核心：通用翻译组件 ───

interface TProps {
  /** 翻译 key，如 "dashboard.title" */
  k: string
  /** 插值参数 */
  params?: Record<string, string | number>
  /** 渲染为什么标签，默认 span */
  as?: keyof JSX.IntrinsicElements
  /** 透传给元素的 props */
  [prop: string]: any
}

/** 通用翻译组件：<T k="dashboard.title" /> */
export function T({ k, params, as: Tag = 'span', ...rest }: TProps) {
  const { t } = useI18n()
  // 去掉自定义 props，只传 HTML 属性
  const { k: _, params: __, as: ___, ...htmlProps } = { k, params, as: Tag, ...rest }
  return <Tag {...htmlProps}>{t(k, params)}</Tag>
}

// ─── 页面标题 ───

interface PageTitleProps {
  /** 翻译 key */
  k: string
  /** 右侧附加内容 */
  right?: React.ReactNode
  /** 副标题 key */
  subtitle?: string
  subtitleParams?: Record<string, string | number>
}

/** 页面标题：<PageTitle k="dashboard.title" subtitle="dashboard.subtitle" /> */
export function PageTitle({ k, right, subtitle, subtitleParams }: PageTitleProps) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{t(k)}</h1>
        {subtitle && (
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
            {t(subtitle, subtitleParams)}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

// ─── 按钮 ───

interface I18nButtonProps {
  k: string
  params?: Record<string, string | number>
  loadingKey?: string
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  onClick?: () => void
  disabled?: boolean
  style?: React.CSSProperties
}

const BUTTON_STYLES: Record<string, React.CSSProperties> = {
  primary: { backgroundColor: 'var(--accent)', color: '#fff', border: 'none' },
  secondary: { backgroundColor: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' },
  danger: { backgroundColor: 'transparent', color: 'var(--error)', border: '1px solid var(--border-subtle)' },
  ghost: { backgroundColor: 'transparent', color: 'var(--text-secondary)', border: 'none' },
}

/** i18n 按钮：<Btn k="common.save" variant="primary" /> */
export function Btn({ k, params, loadingKey, loading, variant = 'secondary', size = 'md', onClick, disabled, style }: I18nButtonProps) {
  const { t } = useI18n()
  const sizeStyle = size === 'sm'
    ? { padding: '4px 10px', fontSize: 11, borderRadius: 4 }
    : { padding: '6px 14px', fontSize: 13, borderRadius: 6 }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        fontWeight: 500,
        ...BUTTON_STYLES[variant],
        ...sizeStyle,
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      {loading ? t(loadingKey || 'common.loading') : t(k, params)}
    </button>
  )
}

// ─── 表单标签 ───

interface LabelProps {
  k: string
  required?: boolean
  children?: React.ReactNode
}

/** 表单标签：<Label k="settings.fieldApiKey" required /> */
export function Label({ k, required, children }: LabelProps) {
  const { t } = useI18n()
  return (
    <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
      {t(k)} {required && <span style={{ color: 'var(--error)' }}>*</span>}
      {children}
    </label>
  )
}

// ─── 空状态 ───

interface EmptyStateProps {
  k: string
  icon?: string
  action?: React.ReactNode
}

/** 空状态：<EmptyState k="agents.emptyTitle" icon="🤖" /> */
export function EmptyState({ k, icon, action }: EmptyStateProps) {
  const { t } = useI18n()
  return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
      {icon && <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>}
      <div>{t(k)}</div>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  )
}

// ─── 状态标签 ───

interface BadgeProps {
  k: string
  color?: 'success' | 'warning' | 'error' | 'info' | 'muted'
}

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  success: { bg: 'var(--success)', color: '#fff' },
  warning: { bg: '#f59e0b', color: '#fff' },
  error: { bg: 'var(--error)', color: '#fff' },
  info: { bg: '#6366F1', color: '#fff' },
  muted: { bg: '#9ca3af', color: '#fff' },
}

/** 状态标签：<Badge k="plugins.statusReady" color="warning" /> */
export function Badge({ k, color = 'info' }: BadgeProps) {
  const { t } = useI18n()
  const c = BADGE_COLORS[color]
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 4,
      backgroundColor: c.bg, color: c.color, fontWeight: 600,
    }}>
      {t(k)}
    </span>
  )
}

// ─── Tab 切换 ───

interface TabBarProps {
  tabs: { key: string; labelKey: string; count?: number }[]
  active: string
  onChange: (key: string) => void
}

/** Tab 栏：<TabBar tabs={[{key:'all', labelKey:'skills.tabAll'}]} active={tab} onChange={setTab} /> */
export function TabBar({ tabs, active, onChange }: TabBarProps) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            padding: '6px 14px', borderRadius: 16, fontSize: 13, cursor: 'pointer',
            backgroundColor: active === tab.key ? 'var(--accent)' : 'var(--bg-glass)',
            color: active === tab.key ? '#fff' : 'var(--text-secondary)',
            border: 'none', fontWeight: active === tab.key ? 600 : 400,
          }}
        >
          {t(tab.labelKey)}{tab.count !== undefined ? ` ${tab.count}` : ''}
        </button>
      ))}
    </div>
  )
}

// ─── 确认对话框 ───

/** i18n 确认对话框 */
export async function confirmI18n(key: string, params?: Record<string, string | number>): Promise<boolean> {
  const { t } = useI18n.getState()
  return showConfirm(t(key, params))
}

/** i18n 提示框 */
export function alertI18n(key: string, params?: Record<string, string | number>) {
  const { t } = useI18n.getState()
  alert(t(key, params))
}
