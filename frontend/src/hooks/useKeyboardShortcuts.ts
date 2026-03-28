/**
 * 全局键盘快捷键 hook
 *
 * 支持组合键格式：cmd+k, cmd+shift+s, escape, cmd+1 等
 * macOS 使用 Cmd，其他平台使用 Ctrl
 */

import { useEffect, useRef } from 'react'

interface ShortcutMap {
  [key: string]: () => void
}

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  // 使用 ref 避免每次 shortcuts 对象变化都重新绑定监听器
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const shift = e.shiftKey

      let key = ''
      if (meta && shift) key = `cmd+shift+${e.key.toLowerCase()}`
      else if (meta) key = `cmd+${e.key.toLowerCase()}`
      else if (e.key === 'Escape') key = 'escape'

      if (!key || !shortcutsRef.current[key]) return

      // 判断是否在输入框中
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      // Escape 在输入框中也要生效
      if (isInput && key === 'escape') {
        shortcutsRef.current[key]()
        e.preventDefault()
        return
      }

      // 在输入框中不拦截非 cmd 组合键
      if (isInput && !key.startsWith('cmd+')) return

      shortcutsRef.current[key]()
      e.preventDefault()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
