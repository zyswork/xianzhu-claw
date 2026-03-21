// 知识库管理路由

import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../db/index.js'
import {
  KnowledgeBaseDocument,
  CreateDocumentRequest,
  UpdateDocumentRequest,
  DocumentSearchRequest,
  DocumentResponse,
} from '../models/knowledge-base.js'

const router = Router()

// 获取文档列表
router.get('/enterprise/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const documents = db.getDocumentsByEnterpriseId(enterpriseId)
    const response: DocumentResponse[] = documents.map(d => ({
      id: d.id,
      enterpriseId: d.enterpriseId,
      title: d.title,
      content: d.content,
      contentType: d.contentType,
      tags: d.tags,
      permissions: d.permissions,
      version: d.version,
      status: d.status,
      createdBy: d.createdBy,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      vectorized: d.vectorized,
    }))
    res.json({ documents: response, total: response.length })
  } catch (error) {
    console.error('获取文档列表失败:', error)
    res.status(500).json({ error: '获取文档列表失败' })
  }
})

// 创建文档
router.post('/enterprise/:enterpriseId', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.params
    const { title, content, contentType, tags, permissions } = req.body as CreateDocumentRequest
    const userId = (req.headers['x-user-id'] as string) || 'system'

    if (!title || !content) {
      res.status(400).json({ error: '文档标题和内容不能为空' })
      return
    }

    const document: KnowledgeBaseDocument = {
      id: `doc_${uuidv4()}`,
      enterpriseId,
      title,
      content,
      contentType: contentType || 'text',
      tags: tags || [],
      permissions: permissions || { read: [], write: [] },
      version: 1,
      status: 'draft',
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      vectorized: false,
    }

    const created = db.createDocument(document)
    const response: DocumentResponse = {
      id: created.id,
      enterpriseId: created.enterpriseId,
      title: created.title,
      content: created.content,
      contentType: created.contentType,
      tags: created.tags,
      permissions: created.permissions,
      version: created.version,
      status: created.status,
      createdBy: created.createdBy,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
      vectorized: created.vectorized,
    }

    res.status(201).json(response)
  } catch (error) {
    console.error('创建文档失败:', error)
    res.status(500).json({ error: '创建文档失败' })
  }
})

// 获取文档详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const document = db.getDocumentById(id)

    if (!document) {
      res.status(404).json({ error: '文档不存在' })
      return
    }

    const response: DocumentResponse = {
      id: document.id,
      enterpriseId: document.enterpriseId,
      title: document.title,
      content: document.content,
      contentType: document.contentType,
      tags: document.tags,
      permissions: document.permissions,
      version: document.version,
      status: document.status,
      createdBy: document.createdBy,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      vectorized: document.vectorized,
    }

    res.json(response)
  } catch (error) {
    console.error('获取文档详情失败:', error)
    res.status(500).json({ error: '获取文档详情失败' })
  }
})

// 更新文档
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body as UpdateDocumentRequest

    const document = db.getDocumentById(id)
    if (!document) {
      res.status(404).json({ error: '文档不存在' })
      return
    }

    const updated = db.updateDocument(id, {
      ...updates,
      version: document.version + 1,
      updatedAt: new Date(),
    })

    if (!updated) {
      res.status(500).json({ error: '更新文档失败' })
      return
    }

    const response: DocumentResponse = {
      id: updated.id,
      enterpriseId: updated.enterpriseId,
      title: updated.title,
      content: updated.content,
      contentType: updated.contentType,
      tags: updated.tags,
      permissions: updated.permissions,
      version: updated.version,
      status: updated.status,
      createdBy: updated.createdBy,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
      vectorized: updated.vectorized,
    }

    res.json(response)
  } catch (error) {
    console.error('更新文档失败:', error)
    res.status(500).json({ error: '更新文档失败' })
  }
})

// 搜索文档
router.post('/search', (req: Request, res: Response) => {
  try {
    const { enterpriseId } = req.headers
    const { query, tags, limit, offset } = req.body as DocumentSearchRequest

    if (!enterpriseId || typeof enterpriseId !== 'string') {
      res.status(400).json({ error: '缺少企业 ID' })
      return
    }

    if (!query) {
      res.status(400).json({ error: '搜索关键词不能为空' })
      return
    }

    let results = db.searchDocuments(enterpriseId, query)

    if (tags && tags.length > 0) {
      results = results.filter(d => tags.some(tag => d.tags.includes(tag)))
    }

    const start = offset || 0
    const end = start + (limit || 10)
    const paginated = results.slice(start, end)

    const response: DocumentResponse[] = paginated.map(d => ({
      id: d.id,
      enterpriseId: d.enterpriseId,
      title: d.title,
      content: d.content,
      contentType: d.contentType,
      tags: d.tags,
      permissions: d.permissions,
      version: d.version,
      status: d.status,
      createdBy: d.createdBy,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      vectorized: d.vectorized,
    }))

    res.json({ documents: response, total: results.length })
  } catch (error) {
    console.error('搜索文档失败:', error)
    res.status(500).json({ error: '搜索文档失败' })
  }
})

// 删除文档
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const document = db.getDocumentById(id)

    if (!document) {
      res.status(404).json({ error: '文档不存在' })
      return
    }

    const success = db.deleteDocument(id)
    if (!success) {
      res.status(500).json({ error: '删除文档失败' })
      return
    }

    res.json({ success: true, message: '文档已删除' })
  } catch (error) {
    console.error('删除文档失败:', error)
    res.status(500).json({ error: '删除文档失败' })
  }
})

export default router
