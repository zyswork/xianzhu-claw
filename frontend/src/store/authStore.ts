import { create } from 'zustand'
import { useEnterpriseStore } from './enterpriseStore'

export interface User {
  id: string
  email: string
  name: string
  role: string
  enterpriseId: string
}

interface AuthStore {
  user: User | null
  token: string | null
  setUser: (user: User) => void
  setToken: (token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem('token') : null,
  setUser: (user) => set({ user }),
  setToken: (token) => {
    localStorage.setItem('token', token)
    set({ token })
  },
  logout: () => {
    localStorage.removeItem('token')
    set({ user: null, token: null })
    useEnterpriseStore.setState({ enterprise: null })
  },
}))
