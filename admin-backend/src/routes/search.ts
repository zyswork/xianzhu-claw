/**
 * 搜索路由
 *
 * 提供向量搜索 API 端点
 */

import express, { Router, Request, Response } from 'express'
import { getQdrantService } from '../services/qdrant.service'

const router = Router()

/**
 * 向量搜索端点
 *
 * GET /search?q=<query>&collection=<collection>&limit=<limit>
 *
 * 查询参数：
 * - q: 搜索查询文本（用于演示，实际应用中需要转换为 embedding）
 * - collection: Qdrant 集合名称，默认 "documents"
 * - limit: 返回结果数量，默认 10
 *
 * 响应：
 * - results: 搜索结果数组
 * - cacheStats: 缓存统计信息
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, collection = 'documents', limit = 10 } = req.query

    // 验证必需参数
    if (!q) {
      return res.status(400).json({
        error: 'Missing required query parameter: q',
      })
    }

    // 获取 Qdrant 服务
    const qdrantService = getQdrantService()

    // 在实际应用中，需要将查询文本转换为 embedding
    // 这里使用模拟 embedding 作为演示
    const queryEmbedding = generateMockEmbedding(String(q))

    // 执行缓存搜索
    const results = await qdrantService.searchWithCache(
      String(collection),
      queryEmbedding,
      parseInt(String(limit), 10) || 10
    )

    // 获取缓存统计
    const cacheStats = qdrantService.getCacheStats()

    return res.json({
      query: String(q),
      collection: String(collection),
      results,
      cacheStats,
    })
  } catch (error) {
    console.error('搜索出错:', error)
    return res.status(500).json({
      error: '搜索失败',
      message: error instanceof Error ? error.message : '未知错误',
    })
  }
})

/**
 * 获取缓存统计端点
 *
 * GET /search/cache/stats
 *
 * 响应：缓存统计信息
 */
router.get('/cache/stats', (req: Request, res: Response) => {
  try {
    const qdrantService = getQdrantService()
    const stats = qdrantService.getCacheStats()

    return res.json({
      message: '缓存统计信息',
      stats,
    })
  } catch (error) {
    console.error('获取缓存统计出错:', error)
    return res.status(500).json({
      error: '获取缓存统计失败',
      message: error instanceof Error ? error.message : '未知错误',
    })
  }
})

/**
 * 清空缓存端点
 *
 * DELETE /search/cache
 *
 * 响应：清空结果
 */
router.delete('/cache', (req: Request, res: Response) => {
  try {
    const qdrantService = getQdrantService()
    qdrantService.clearCache()

    return res.json({
      message: '缓存已清空',
    })
  } catch (error) {
    console.error('清空缓存出错:', error)
    return res.status(500).json({
      error: '清空缓存失败',
      message: error instanceof Error ? error.message : '未知错误',
    })
  }
})

/**
 * 生成模拟 embedding
 *
 * 在实际应用中，应使用真实的 embedding 模型（如 OpenAI Embeddings）
 * 这里使用简单的哈希算法生成演示用的 embedding
 *
 * @param text - 输入文本
 * @returns 向量
 */
function generateMockEmbedding(text: string): number[] {
  // 创建长度为 384 的向量（模拟真实 embedding 维度）
  const dimension = 384
  const vector: number[] = new Array(dimension)

  // 使用文本的哈希值生成伪随机向量
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // 转换为 32 位整数
  }

  // 用哈希值作为随机种子生成向量
  for (let i = 0; i < dimension; i++) {
    hash = (hash * 9301 + 49297) % 233280
    vector[i] = (hash / 233280 - 0.5) * 2 // 范围 -1 到 1
  }

  // 正规化向量到单位长度
  let norm = 0
  for (let i = 0; i < dimension; i++) {
    norm += vector[i] * vector[i]
  }
  norm = Math.sqrt(norm)
  for (let i = 0; i < dimension; i++) {
    vector[i] /= norm
  }

  return vector
}

export default router
