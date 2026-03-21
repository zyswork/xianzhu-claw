// 认证路由

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { generateToken } from '../middleware/auth.js'
import { validateRequest } from '../middleware/validator.js'
import { authSchemas } from '../middleware/validation.js'
import { User } from '../models/user.js'

const router = Router()

// 登录
router.post('/login', validateRequest(authSchemas.login), (req: Request, res: Response) => {
  try {
    const { email, password, enterpriseId } = req.body

    // 验证企业是否存在
    const enterprise = db.getEnterpriseById(enterpriseId)
    if (!enterprise) {
      res.status(404).json({ error: '企业不存在' })
      return
    }

    // 获取用户（简化实现，实际应该验证密码）
    const users = db.getUsersByEnterpriseId(enterpriseId)
    const user = users.find(u => u.email === email)

    if (!user) {
      res.status(401).json({ error: '用户名或密码错误' })
      return
    }

    // 生成 token
    const token = generateToken({
      id: user.id,
      email: user.email,
      enterpriseId: user.enterpriseId,
      role: user.role,
    })

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        enterpriseId: user.enterpriseId,
      },
    })
  } catch (error) {
    console.error('登录失败:', error)
    res.status(500).json({ error: '登录失败' })
  }
})

// 注册
router.post('/register', validateRequest(authSchemas.register), (req: Request, res: Response) => {
  try {
    const { email, name, password, enterpriseId } = req.body

    // 验证企业是否存在
    const enterprise = db.getEnterpriseById(enterpriseId)
    if (!enterprise) {
      res.status(404).json({ error: '企业不存在' })
      return
    }

    // 检查用户是否已存在
    const users = db.getUsersByEnterpriseId(enterpriseId)
    if (users.some(u => u.email === email)) {
      res.status(400).json({ error: '用户已存在' })
      return
    }

    // 创建新用户
    const newUser: User = {
      id: `user_${uuidv4()}`,
      enterpriseId,
      email,
      name,
      role: 'user',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const created = db.createUser(newUser)

    // 生成 token
    const token = generateToken({
      id: created.id,
      email: created.email,
      enterpriseId: created.enterpriseId,
      role: created.role,
    })

    res.status(201).json({
      token,
      user: {
        id: created.id,
        email: created.email,
        name: created.name,
        role: created.role,
        enterpriseId: created.enterpriseId,
      },
    })
  } catch (error) {
    console.error('注册失败:', error)
    res.status(500).json({ error: '注册失败' })
  }
})

export default router

