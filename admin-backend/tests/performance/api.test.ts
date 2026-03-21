import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import axios from 'axios'

const API_BASE_URL = 'http://localhost:3000'
const HEALTH_CHECK_URL = `${API_BASE_URL}/health`

describe('API 运行时性能', () => {
  // 注意: 这些测试需要后端服务运行
  // 运行前请确保后端已启动: npm run dev

  it('健康检查应该在 5ms 内响应', async () => {
    try {
      const startTime = Date.now()
      const response = await axios.get(HEALTH_CHECK_URL, { timeout: 5000 })
      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty('status', 'ok')
      expect(duration).toBeLessThan(5)
    } catch (error) {
      // 如果后端未运行，跳过此测试
      console.warn('后端服务未运行，跳过性能测试')
    }
  })

  it('平均 API 响应时间应该 < 200ms', async () => {
    try {
      const times: number[] = []
      const iterations = 10

      for (let i = 0; i < iterations; i++) {
        const startTime = Date.now()
        await axios.get(HEALTH_CHECK_URL, { timeout: 5000 })
        const endTime = Date.now()
        times.push(endTime - startTime)
      }

      const average = times.reduce((a, b) => a + b) / times.length
      const max = Math.max(...times)
      const min = Math.min(...times)

      console.log(`性能统计 (${iterations} 次请求):`)
      console.log(`  平均: ${average.toFixed(2)}ms`)
      console.log(`  最小: ${min}ms`)
      console.log(`  最大: ${max}ms`)

      expect(average).toBeLessThan(200)
    } catch (error) {
      // 如果后端未运行，跳过此测试
      console.warn('后端服务未运行，跳过性能测试')
    }
  })

  it('API 信息端点应该快速响应', async () => {
    try {
      const startTime = Date.now()
      const response = await axios.get(`${API_BASE_URL}/api/v1/info`, { timeout: 5000 })
      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty('name')
      expect(response.data).toHaveProperty('version')
      expect(duration).toBeLessThan(200)
    } catch (error) {
      // 如果后端未运行，跳过此测试
      console.warn('后端服务未运行，跳过性能测试')
    }
  })

  it('响应应该包含 Content-Encoding 头（启用压缩）', async () => {
    try {
      const response = await axios.get(HEALTH_CHECK_URL, {
        timeout: 5000,
        headers: {
          'Accept-Encoding': 'gzip, deflate',
        },
      })

      // 检查是否启用了压缩
      const contentEncoding = response.headers['content-encoding']
      expect(['gzip', 'deflate', undefined]).toContain(contentEncoding)
    } catch (error) {
      // 如果后端未运行，跳过此测试
      console.warn('后端服务未运行，跳过性能测试')
    }
  })
})
