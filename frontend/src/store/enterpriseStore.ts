import { create } from 'zustand'

export interface Enterprise {
  id: string
  name: string
  description: string
  industry: string
  size: string
}

interface EnterpriseStore {
  enterprise: Enterprise | null
  setEnterprise: (enterprise: Enterprise) => void
  clearEnterprise: () => void
}

export const useEnterpriseStore = create<EnterpriseStore>((set) => ({
  enterprise: null,
  setEnterprise: (enterprise) => set({ enterprise }),
  clearEnterprise: () => set({ enterprise: null }),
}))
