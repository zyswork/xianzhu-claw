/**
 * 侧边栏状态管理
 *
 * 提供全局可访问的侧边栏折叠状态，
 * 用于键盘快捷键等外部组件控制侧边栏。
 */

import { create } from 'zustand'

interface SidebarStore {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  collapsed: window.matchMedia('(max-width: 768px)').matches,
  setCollapsed: (collapsed) => set({ collapsed }),
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}))
