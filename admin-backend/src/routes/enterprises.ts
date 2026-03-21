// 企业管理路由

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import { Enterprise, CreateEnterpriseRequest, UpdateEnterpriseRequest, EnterpriseResponse } from '../models/enterprise.js'

const router = Router()

// 获取企业列表
router.get('/', (req: Request, res: Response) => {
  try {
    const enterprises = db.getEnterprises()
    const response: EnterpriseResponse[] = enterprises.map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      logo: e.logo,
      website: e.website,
      industry: e.industry,
      size: e.size,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    }))
    res.json({ enterprises: response, total: response.length })
  } catch (error) {
    console.error('获取企业列表失败:', error)
    res.status(500).json({ error: '获取企业列表失败' })
  }
})

// 创建企业
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, logo, website, industry, size } = req.body as CreateEnterpriseRequest

    if (!name || !description) {
      res.status(400).json({ error: '企业名称和描述不能为空' })
      return
    }

    const enterprise: Enterprise = {
      id: `enterprise_${uuidv4()}`,
      name,
      description,
      logo,
      website,
      industry,
      size,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const created = db.createEnterprise(enterprise)
    const response: EnterpriseResponse = {
      id: created.id,
      name: created.name,
      description: created.description,
      logo: created.logo,
      website: created.website,
      industry: created.industry,
      size: created.size,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    }

    res.status(201).json(response)
  } catch (error) {
    console.error('创建企业失败:', error)
    res.status(500).json({ error: '创建企业失败' })
  }
})

// 获取企业详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const enterprise = db.getEnterpriseById(id)

    if (!enterprise) {
      res.status(404).json({ error: '企业不存在' })
      return
    }

    const response: EnterpriseResponse = {
      id: enterprise.id,
      name: enterprise.name,
      description: enterprise.description,
      logo: enterprise.logo,
      website: enterprise.website,
      industry: enterprise.industry,
      size: enterprise.size,
      status: enterprise.status,
      createdAt: enterprise.createdAt.toISOString(),
      updatedAt: enterprise.updatedAt.toISOString(),
    }

    res.json(response)
  } catch (error) {
    console.error('获取企业详情失败:', error)
    res.status(500).json({ error: '获取企业详情失败' })
  }
})

// 更新企业
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body as UpdateEnterpriseRequest

    const enterprise = db.getEnterpriseById(id)
    if (!enterprise) {
      res.status(404).json({ error: '企业不存在' })
      return
    }

    const updated = db.updateEnterprise(id, {
      ...updates,
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '更新企业失败' })
      return
    }

    const response: EnterpriseResponse = {
      id: updated.id,
      name: updated.name,
      description: updated.description,
      logo: updated.logo,
      website: updated.website,
      industry: updated.industry,
      size: updated.size,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    }

    res.json(response)
  } catch (error) {
    console.error('更新企业失败:', error)
    res.status(500).json({ error: '更新企业失败' })
  }
})

// 删除企业
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const enterprise = db.getEnterpriseById(id)

    if (!enterprise) {
      res.status(404).json({ error: '企业不存在' })
      return
    }

    const success = db.deleteEnterprise(id)
    if (!success) {
      res.status(500).json({ error: '删除企业失败' })
      return
    }

    res.json({ success: true, message: '企业已删除' })
  } catch (error) {
    console.error('删除企业失败:', error)
    res.status(500).json({ error: '删除企业失败' })
  }
})

export default router
