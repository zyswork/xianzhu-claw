// 从 JWT token 中解析用户信息
export interface TokenPayload {
  id: string
  email: string
  enterpriseId: string
  role: string
}

export function getTokenPayload(): TokenPayload | null {
  const token = localStorage.getItem('token')
  if (!token) return null

  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload as TokenPayload
  } catch {
    return null
  }
}

export function getEnterpriseId(): string {
  return getTokenPayload()?.enterpriseId || ''
}
