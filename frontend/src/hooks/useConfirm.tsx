/**
 * 全局确认弹窗 — 替代 window.confirm()
 *
 * 用法：
 *   const confirm = useConfirm()
 *   const ok = await confirm('确定删除？')
 *   if (!ok) return
 *
 * 或非组件内：
 *   import { showConfirm } from './hooks/useConfirm'
 *   if (!await showConfirm('确定？')) return
 */

import { create } from 'zustand'
import { useCallback } from 'react'
import { useI18n } from '../i18n'

interface ConfirmState {
  visible: boolean
  message: string
  resolve: ((ok: boolean) => void) | null
  show: (message: string) => Promise<boolean>
  close: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  visible: false,
  message: '',
  resolve: null,
  show: (message: string) => {
    return new Promise<boolean>((resolve) => {
      set({ visible: true, message, resolve })
    })
  },
  close: (ok: boolean) => {
    const { resolve } = get()
    resolve?.(ok)
    set({ visible: false, message: '', resolve: null })
  },
}))

/** Hook — 返回 confirm 函数 */
export function useConfirm() {
  const show = useConfirmStore((s) => s.show)
  return useCallback((message: string) => show(message), [show])
}

/** 非组件内使用 */
export function showConfirm(message: string): Promise<boolean> {
  return useConfirmStore.getState().show(message)
}

/** 渲染组件 — 放在 App 最外层 */
export function ConfirmDialog() {
  const { visible, message, close } = useConfirmStore()
  const { t } = useI18n()

  if (!visible) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
      }}
      onClick={() => close(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'white', borderRadius: 12, padding: 24,
          maxWidth: 400, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
      >
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.6, color: '#333', whiteSpace: 'pre-wrap' }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={() => close(false)}
            style={{
              padding: '8px 20px', border: '1px solid #e5e7eb', borderRadius: 6,
              backgroundColor: 'white', cursor: 'pointer', fontSize: 13,
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            autoFocus
            onClick={() => close(true)}
            style={{
              padding: '8px 20px', border: 'none', borderRadius: 6,
              backgroundColor: '#dc2626', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
