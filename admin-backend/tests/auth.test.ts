// 认证路由测试

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import authRouter from '../src/routes/auth'
import { db } from '../src/db/index'
import { v4 as uuidv4 } from 'uuid'

const app = express()
app.use(express.json())
app.use('/auth', authRouter)

describe('认证路由', () => {
  let enterpriseId: string
  const timestamp = Date.now()

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
  })

  it('应该成功注册新用户', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `test_${timestamp}@example.com`,
        name: '测试用户',
        password: 'password123',
        enterpriseId,
      })

    expect(response.status).toBe(201)
    expect(response.body).toHaveProperty('token')
    expect(response.body).toHaveProperty('user')
    expect(response.body.user.email).toBe(`test_${timestamp}@example.com`)
  })

  it('应该拒绝重复的邮箱注册', async () => {
    const dupEmail = `duplicate_${timestamp}@example.com`
    // 先注册一个用户
    await request(app)
      .post('/auth/register')
      .send({
        email: dupEmail,
        name: '用户1',
        password: 'password123',
        enterpriseId,
      })

    // 尝试用相同邮箱注册
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: dupEmail,
        name: '用户2',
        password: 'password123',
        enterpriseId,
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('用户已存在')
  })

  it('应该验证必要字段', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: `validation_${timestamp}@example.com`,
        // 缺少 name 和 password
        enterpriseId,
      })

    expect(response.status).toBe(400)
    expect(response.body.error).toBe('数据验证失败')
  })

  it('应该成功登录已注册的用户', async () => {
    const loginEmail = `login_${timestamp}@example.com`
    // 先注册一个用户
    await request(app)
      .post('/auth/register')
      .send({
        email: loginEmail,
        name: '登录测试',
        password: 'password123',
        enterpriseId,
      })

    // 尝试登录
    const response = await request(app)
      .post('/auth/login')
      .send({
        email: loginEmail,
        password: 'password123',
        enterpriseId,
      })

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('token')
    expect(response.body.user.email).toBe(loginEmail)
  })

  it('应该拒绝不存在的用户登录', async () => {
    const response = await request(app)
      .post('/auth/login')
      .send({
        email: `nonexistent_${timestamp}@example.com`,
        password: 'password123',
        enterpriseId,
      })

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('用户名或密码错误')
  })

  it('应该拒绝不存在的企业', async () => {
    const response = await request(app)
      .post('/auth/register')
      .send({
        email: 'test@example.com',
        name: '测试用户',
        password: 'password123',
        enterpriseId: 'nonexistent_enterprise',
      })

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('企业不存在')
  })
})
