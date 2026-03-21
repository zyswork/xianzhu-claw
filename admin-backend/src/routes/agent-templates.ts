// Agent 模板管理路由

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import {
  AgentTemplate,
  CreateAgentTemplateRequest,
  UpdateAgentTemplateRequest,
  PublishTemplateRequest,
  AgentTemplateResponse,
} from '../models/agent-template.js'

const router = Router()

// 获取模板列表
router.get('/enterprise/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const templates = db.getTemplatesByEnterpriseId(enterpriseId)
    const response: AgentTemplateResponse[] = templates.map(t => ({
      id: t.id,
      enterpriseId: t.enterpriseId,
      name: t.name,
      description: t.description,
      category: t.category,
      config: t.config,
      version: t.version,
      status: t.status,
      permissions: t.permissions,
      createdBy: t.createdBy,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      publishedAt: t.publishedAt?.toISOString(),
      tags: t.tags,
    }))
    res.json({ templates: response, total: response.length })
  } catch (error) {
    console.error('获取模板列表失败:', error)
    res.status(500).json({ error: '获取模板列表失败' })
  }
})

// 创建模板
router.post('/enterprise/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { name, description, category, config, tags, permissions } = req.body as CreateAgentTemplateRequest
    const userId = (req.headers['x-user-id'] as string) || 'system'

    if (!name || !description || !category || !config) {
      res.status(400).json({ error: '模板名称、描述、分类和配置不能为空' })
      return
    }

    const template: AgentTemplate = {
      id: `template_${uuidv4()}`,
      enterpriseId,
      name,
      description,
      category,
      config,
      version: '0.1.0',
      status: 'draft',
      permissions: permissions || { read: [], write: [] },
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      tags: tags || [],
    }

    const created = db.createTemplate(template)
    const response: AgentTemplateResponse = {
      id: created.id,
      enterpriseId: created.enterpriseId,
      name: created.name,
      description: created.description,
      category: created.category,
      config: created.config,
      version: created.version,
      status: created.status,
      permissions: created.permissions,
      createdBy: created.createdBy,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      tags: created.tags,
    }

    res.status(201).json(response)
  } catch (error) {
    console.error('创建模板失败:', error)
    res.status(500).json({ error: '创建模板失败' })
  }
})

// 获取模板详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const template = db.getTemplateById(id)

    if (!template) {
      res.status(404).json({ error: '模板不存在' })
      return
    }

    const response: AgentTemplateResponse = {
      id: template.id,
      enterpriseId: template.enterpriseId,
      name: template.name,
      description: template.description,
      category: template.category,
      config: template.config,
      version: template.version,
      status: template.status,
      permissions: template.permissions,
      createdBy: template.createdBy,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
      publishedAt: template.publishedAt?.toISOString(),
      tags: template.tags,
    }

    res.json(response)
  } catch (error) {
    console.error('获取模板详情失败:', error)
    res.status(500).json({ error: '获取模板详情失败' })
  }
})

// 更新模板
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body as UpdateAgentTemplateRequest

    const template = db.getTemplateById(id)
    if (!template) {
      res.status(404).json({ error: '模板不存在' })
      return
    }

    const updated = db.updateTemplate(id, {
      ...updates,
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '更新模板失败' })
      return
    }

    const response: AgentTemplateResponse = {
      id: updated.id,
      enterpriseId: updated.enterpriseId,
      name: updated.name,
      description: updated.description,
      category: updated.category,
      config: updated.config,
      version: updated.version,
      status: updated.status,
      permissions: updated.permissions,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      publishedAt: updated.publishedAt?.toISOString(),
      tags: updated.tags,
    }

    res.json(response)
  } catch (error) {
    console.error('更新模板失败:', error)
    res.status(500).json({ error: '更新模板失败' })
  }
})

// 发布模板
router.post('/:id/publish', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { version, changelog } = req.body as PublishTemplateRequest

    const template = db.getTemplateById(id)
    if (!template) {
      res.status(404).json({ error: '模板不存在' })
      return
    }

    const updated = db.updateTemplate(id, {
      version: version || template.version,
      status: 'published',
      publishedAt: new Date(),
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '发布模板失败' })
      return
    }

    const response: AgentTemplateResponse = {
      id: updated.id,
      enterpriseId: updated.enterpriseId,
      name: updated.name,
      description: updated.description,
      category: updated.category,
      config: updated.config,
      version: updated.version,
      status: updated.status,
      permissions: updated.permissions,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      publishedAt: updated.publishedAt?.toISOString(),
      tags: updated.tags,
    }

    res.json(response)
  } catch (error) {
    console.error('发布模板失败:', error)
    res.status(500).json({ error: '发布模板失败' })
  }
})

// 获取模板版本历史
router.get('/:id/versions', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const template = db.getTemplateById(id)

    if (!template) {
      res.status(404).json({ error: '模板不存在' })
      return
    }

    // 返回当前版本信息
    const versions = [
      {
        version: template.version,
        config: template.config,
        createdAt: template.createdAt.toISOString(),
        createdBy: template.createdBy,
        status: template.status,
      },
    ]

    res.json({ versions })
  } catch (error) {
    console.error('获取模板版本历史失败:', error)
    res.status(500).json({ error: '获取模板版本历史失败' })
  }
})

// 删除模板
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const template = db.getTemplateById(id)

    if (!template) {
      res.status(404).json({ error: '模板不存在' })
      return
    }

    const success = db.deleteTemplate(id)
    if (!success) {
      res.status(500).json({ error: '删除模板失败' })
      return
    }

    res.json({ success: true, message: '模板已删除' })
  } catch (error) {
    console.error('删除模板失败:', error)
    res.status(500).json({ error: '删除模板失败' })
  }
})

export default router
