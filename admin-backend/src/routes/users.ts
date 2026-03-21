// 用户管理路由

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { User, CreateUserRequest, UpdateUserRequest, UserResponse, AssignPermissionRequest, ChangeUserStatusRequest, UserStatusResponse } from '../models/user.js'

const router = Router()

// 验证用户是否为 admin 的中间件
const requireAdmin = (req: any, res: Response, next: any) => {
  const user = req.user
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' })
    return
  }
  next()
}

// 模拟认证中间件（从请求头获取用户信息）
const authMiddleware = (req: any, res: Response, next: any) => {
  // 从请求头获取用户信息（实际应用中应该从 JWT token 解析）
  const userId = req.headers['x-user-id']
  const userRole = req.headers['x-user-role']

  if (!userId) {
    res.status(401).json({ error: '未授权' })
    return
  }

  req.user = {
    id: userId,
    role: userRole || 'user'
  }
  next()
}

// 获取企业用户列表
router.get('/enterprise/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const users = db.getUsersByEnterpriseId(enterpriseId)
    const response: UserResponse[] = users.map(u => ({
      id: u.id,
      enterpriseId: u.enterpriseId,
      email: u.email,
      name: u.name,
      role: u.role,
      permissions: u.permissions,
      status: u.status,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      lastLogin: u.lastLogin?.toISOString(),
    }))
    res.json({ users: response, total: response.length })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    res.status(500).json({ error: '获取用户列表失败' })
  }
})

// 创建用户
router.post('/enterprise/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { email, name, role, permissions } = req.body as CreateUserRequest

    if (!email || !name || !role) {
      res.status(400).json({ error: '邮箱、名称和角色不能为空' })
      return
    }

    const user: User = {
      id: `user_${uuidv4()}`,
      enterpriseId,
      email,
      name,
      role,
      permissions: permissions || [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const created = db.createUser(user)
    const response: UserResponse = {
      id: created.id,
      enterpriseId: created.enterpriseId,
      email: created.email,
      name: created.name,
      role: created.role,
      permissions: created.permissions,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    }

    res.status(201).json(response)
  } catch (error) {
    console.error('创建用户失败:', error)
    res.status(500).json({ error: '创建用户失败' })
  }
})

// 获取用户详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const user = db.getUserById(id)

    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    const response: UserResponse = {
      id: user.id,
      enterpriseId: user.enterpriseId,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: user.permissions,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLogin: user.lastLogin?.toISOString(),
    }

    res.json(response)
  } catch (error) {
    console.error('获取用户详情失败:', error)
    res.status(500).json({ error: '获取用户详情失败' })
  }
})

// 更新用户
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body as UpdateUserRequest

    const user = db.getUserById(id)
    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    const updated = db.updateUser(id, {
      ...updates,
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '更新用户失败' })
      return
    }

    const response: UserResponse = {
      id: updated.id,
      enterpriseId: updated.enterpriseId,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      permissions: updated.permissions,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      lastLogin: updated.lastLogin?.toISOString(),
    }

    res.json(response)
  } catch (error) {
    console.error('更新用户失败:', error)
    res.status(500).json({ error: '更新用户失败' })
  }
})

// 分配权限
router.post('/:id/permissions', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { permissions } = req.body as AssignPermissionRequest

    if (!Array.isArray(permissions)) {
      res.status(400).json({ error: '权限必须是数组' })
      return
    }

    const user = db.getUserById(id)
    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    const updated = db.updateUser(id, {
      permissions,
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '分配权限失败' })
      return
    }

    const response: UserResponse = {
      id: updated.id,
      enterpriseId: updated.enterpriseId,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      permissions: updated.permissions,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }

    res.json(response)
  } catch (error) {
    console.error('分配权限失败:', error)
    res.status(500).json({ error: '分配权限失败' })
  }
})

// 删除用户
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const user = db.getUserById(id)

    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    const success = db.deleteUser(id)
    if (!success) {
      res.status(500).json({ error: '删除用户失败' })
      return
    }

    res.json({ success: true, message: '用户已删除' })
  } catch (error) {
    console.error('删除用户失败:', error)
    res.status(500).json({ error: '删除用户失败' })
  }
})

// 修改用户状态
router.put('/:id/status', authMiddleware, requireAdmin, (req: any, res: Response) => {
  try {
    const { id } = req.params
    const { status, reason } = req.body as ChangeUserStatusRequest
    const adminId = req.user.id

    // 验证状态值
    const validStatuses = ['active', 'inactive', 'suspended']
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ error: '无效的状态值，必须是 active、inactive 或 suspended' })
      return
    }

    // 获取用户
    const user = db.getUserById(id)
    if (!user) {
      res.status(404).json({ error: '用户不存在' })
      return
    }

    // 记录状态变更历史
    const historyId = `history_${uuidv4()}`
    db.createStatusHistory({
      id: historyId,
      userId: id,
      oldStatus: user.status,
      newStatus: status,
      reason: reason || null,
      changedBy: adminId,
      createdAt: new Date(),
    })

    // 更新用户状态
    const updated = db.updateUser(id, {
      status: status as any,
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '更新用户状态失败' })
      return
    }

    const response: UserStatusResponse = {
      id: updated.id,
      status: updated.status,
      statusChangedAt: updated.updatedAt.toISOString(),
      statusChangedBy: adminId,
    }

    res.json(response)
  } catch (error) {
    console.error('修改用户状态失败:', error)
    res.status(500).json({ error: '修改用户状态失败' })
  }
})

export default router
