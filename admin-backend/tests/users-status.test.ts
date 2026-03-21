// 用户状态管理 API 测试

import { describe, it, expect, beforeAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import usersRouter from '../src/routes/users'
import { db } from '../src/db/index'
import { v4 as uuidv4 } from 'uuid'

const app = express()
app.use(express.json())
app.use('/users', usersRouter)

describe('用户状态管理 API', () => {
  let enterpriseId: string
  let adminUserId: string
  let testUserId: string

  beforeAll(() => {
    // 创建测试企业
    enterpriseId = `enterprise_${uuidv4()}`
    db.createEnterprise({
      id: enterpriseId,
      name: '测试企业',
      description: '用于测试的企业',
      logo: '',
      website: '',
      industry: '',
      size: '',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 创建管理员用户
    adminUserId = `user_${uuidv4()}`
    db.createUser({
      id: adminUserId,
      enterpriseId,
      email: `admin_${uuidv4()}@example.com`,
      name: '管理员',
      role: 'admin',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 创建测试用户
    testUserId = `user_${uuidv4()}`
    db.createUser({
      id: testUserId,
      enterpriseId,
      email: `test_${uuidv4()}@example.com`,
      name: '测试用户',
      role: 'user',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

  it('应该成功修改用户状态为 suspended', async () => {
    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'suspended',
        reason: '违规行为',
      })

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('id', testUserId)
    expect(response.body).toHaveProperty('status', 'suspended')
    expect(response.body).toHaveProperty('statusChangedAt')
    expect(response.body).toHaveProperty('statusChangedBy', adminUserId)
  })

  it('应该成功修改用户状态为 inactive', async () => {
    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'inactive',
        reason: '账户停用',
      })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('inactive')
  })

  it('应该成功修改用户状态为 active', async () => {
    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'active',
      })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('active')
  })

  it('应该拒绝无效的状态值', async () => {
    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'invalid_status',
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('无效的状态值')
  })

  it('应该拒绝缺少状态值的请求', async () => {
    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        reason: '某个原因',
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('无效的状态值')
  })

  it('应该拒绝非 admin 用户的请求', async () => {
    const regularUserId = `user_${uuidv4()}`
    db.createUser({
      id: regularUserId,
      enterpriseId,
      email: `regular_${uuidv4()}@example.com`,
      name: '普通用户',
      role: 'user',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .set('x-user-id', regularUserId)
      .set('x-user-role', 'user')
      .send({
        status: 'suspended',
      })

    expect(response.status).toBe(403)
    expect(response.body.error).toContain('管理员权限')
  })

  it('应该拒绝未授权的请求', async () => {
    const response = await request(app)
      .put(`/users/${testUserId}/status`)
      .send({
        status: 'suspended',
      })

    expect(response.status).toBe(401)
    expect(response.body.error).toContain('未授权')
  })

  it('应该返回 404 当用户不存在', async () => {
    const nonexistentUserId = `user_${uuidv4()}`
    const response = await request(app)
      .put(`/users/${nonexistentUserId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'suspended',
      })

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('用户不存在')
  })

  it('应该记录状态变更历史', async () => {
    const userId = `user_${uuidv4()}`
    db.createUser({
      id: userId,
      enterpriseId,
      email: `history_test_${uuidv4()}@example.com`,
      name: '历史测试用户',
      role: 'user',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 修改状态
    await request(app)
      .put(`/users/${userId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'suspended',
        reason: '测试历史记录',
      })

    // 获取历史记录
    const history = db.getStatusHistoryByUserId(userId)

    expect(history).toHaveLength(1)
    expect(history[0]).toHaveProperty('userId', userId)
    expect(history[0]).toHaveProperty('oldStatus', 'active')
    expect(history[0]).toHaveProperty('newStatus', 'suspended')
    expect(history[0]).toHaveProperty('reason', '测试历史记录')
    expect(history[0]).toHaveProperty('changedBy', adminUserId)
  })

  it('应该记录多次状态变更历史', async () => {
    const userId = `user_${uuidv4()}`
    db.createUser({
      id: userId,
      enterpriseId,
      email: `multi_history_${uuidv4()}@example.com`,
      name: '多次变更用户',
      role: 'user',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // 第一次修改
    await request(app)
      .put(`/users/${userId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'suspended',
        reason: '第一次变更',
      })

    // 第二次修改
    await request(app)
      .put(`/users/${userId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'inactive',
        reason: '第二次变更',
      })

    // 获取历史记录
    const history = db.getStatusHistoryByUserId(userId)

    expect(history).toHaveLength(2)
    // 最新的记录应该在前面（按 createdAt DESC 排序）
    expect(history[0]).toHaveProperty('newStatus', 'inactive')
    expect(history[1]).toHaveProperty('newStatus', 'suspended')
  })

  it('应该允许不提供 reason 字段', async () => {
    const userId = `user_${uuidv4()}`
    db.createUser({
      id: userId,
      enterpriseId,
      email: `no_reason_${uuidv4()}@example.com`,
      name: '无原因用户',
      role: 'user',
      permissions: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await request(app)
      .put(`/users/${userId}/status`)
      .set('x-user-id', adminUserId)
      .set('x-user-role', 'admin')
      .send({
        status: 'suspended',
      })

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('suspended')

    // 验证历史记录中 reason 为 null
    const history = db.getStatusHistoryByUserId(userId)
    expect(history[0]).toHaveProperty('reason', null)
  })
})
