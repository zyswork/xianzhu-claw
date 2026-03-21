// JWT 认证中间件

import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    enterpriseId: string
    role: string
  }
}

// 生成 JWT token
export function generateToken(user: { id: string; email: string; enterpriseId: string; role: string }): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '24h' })
}

// 验证 JWT token
export function verifyToken(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch (error) {
    return null
  }
}

// 认证中间件
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.status(401).json({ error: '缺少认证令牌' })
    return
  }

  const token = authHeader.replace('Bearer ', '')
  const decoded = verifyToken(token)

  if (!decoded) {
    res.status(401).json({ error: '无效的认证令牌' })
    return
  }

  req.user = decoded
  next()
}

// 可选认证中间件（不强制要求）
export function optionalAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '')
    const decoded = verifyToken(token)
    if (decoded) {
      req.user = decoded
    }
  }
  next()
}

// 角色检查中间件
export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: '未认证' })
      return
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: '权限不足' })
      return
    }

    next()
  }
}
