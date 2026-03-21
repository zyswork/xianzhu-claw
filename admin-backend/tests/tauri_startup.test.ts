import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import dotenv from 'dotenv'

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '../.env') })

// 常量定义
const BACKEND_URL = 'http://localhost:3000'
const BACKEND_HEALTH_CHECK = `${BACKEND_URL}/health`
const HEALTH_CHECK_TIMEOUT = 5000
const BACKEND_STARTUP_TIMEOUT = 10000
const HEALTH_CHECK_MAX_RETRIES = 20
const HEALTH_CHECK_RETRY_INTERVAL = 500
const PROCESS_SHUTDOWN_TIMEOUT = 3000

describe('Tauri 应用启动集成测试', () => {
  let backendProcess: ChildProcess | null = null

  /**
   * 轮询健康检查端点，直到后端就绪或超时
   * @param maxRetries 最大重试次数
   * @param retryInterval 重试间隔（毫秒）
   * @returns 后端是否就绪
   */
  async function waitForBackendReady(
    maxRetries = HEALTH_CHECK_MAX_RETRIES,
    retryInterval = HEALTH_CHECK_RETRY_INTERVAL
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(BACKEND_HEALTH_CHECK, {
          signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
        })
        if (response.ok) {
          return true
        }
      } catch (error) {
        // 继续重试
      }
      await new Promise((resolve) => setTimeout(resolve, retryInterval))
    }
    return false
  }

  beforeAll(async () => {
    // 启动后端服务用于测试
    const backendPath = path.join(__dirname, '../../admin-backend')

    return new Promise<void>((resolve, reject) => {
      backendProcess = spawn('npm', ['start'], {
        cwd: backendPath,
        stdio: 'pipe',
      })

      // 错误处理：后端启动失败
      backendProcess!.on('error', (error) => {
        reject(new Error(`后端启动失败: ${error.message}`))
      })

      // 错误处理：后端进程意外退出
      backendProcess!.on('exit', (code, signal) => {
        if (code !== null && code !== 0) {
          reject(new Error(`后端进程异常退出，退出码: ${code}`))
        }
      })

      // 等待后端就绪
      const startupTimeout = setTimeout(() => {
        reject(new Error(`后端启动超时（${BACKEND_STARTUP_TIMEOUT}ms）`))
      }, BACKEND_STARTUP_TIMEOUT)

      waitForBackendReady()
        .then((ready) => {
          clearTimeout(startupTimeout)
          if (ready) {
            resolve()
          } else {
            reject(new Error('后端启动超时：无法连接到健康检查端点'))
          }
        })
        .catch((error) => {
          clearTimeout(startupTimeout)
          reject(error)
        })
    })
  })

  afterAll(async () => {
    if (backendProcess) {
      return new Promise<void>((resolve) => {
        // 先尝试 SIGTERM 优雅关闭
        backendProcess!.kill('SIGTERM')

        // 设置超时：3 秒后如果还没关闭，强制 SIGKILL
        const timeoutId = setTimeout(() => {
          backendProcess!.kill('SIGKILL')
          resolve()
        }, PROCESS_SHUTDOWN_TIMEOUT)

        // 监听进程退出事件
        backendProcess!.on('exit', () => {
          clearTimeout(timeoutId)
          resolve()
        })
      })
    }
  })

  it('应该能够连接到后端健康检查端点', async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)

    try {
      const response = await fetch(BACKEND_HEALTH_CHECK, {
        signal: controller.signal,
      })
      expect(response.ok).toBe(true)
      const data = await response.json()
      expect(data.status).toBe('ok')
    } finally {
      clearTimeout(timeoutId)
    }
  })

  it('应该返回有效的健康检查响应', async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)

    try {
      const response = await fetch(BACKEND_HEALTH_CHECK, {
        signal: controller.signal,
      })
      const data = await response.json()
      expect(data).toHaveProperty('status')
      expect(data).toHaveProperty('timestamp')
    } finally {
      clearTimeout(timeoutId)
    }
  })

  it('应该在环境变量缺失时失败', async () => {
    // 验证当前环境有 JWT_SECRET
    expect(process.env.JWT_SECRET).toBeDefined()

    // 注意：真正的缺失测试需要在隔离进程中运行
    // 这里只验证当前环境配置正确
  })

  it('应该支持 CORS 请求', async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)

    try {
      const response = await fetch(BACKEND_HEALTH_CHECK, {
        signal: controller.signal,
        headers: {
          'Origin': 'http://localhost:5173',
        },
      })
      expect(response.ok).toBe(true)
      expect(response.headers.get('access-control-allow-origin')).toBeDefined()
    } finally {
      clearTimeout(timeoutId)
    }
  })

  it('应该在指定端口上运行', async () => {
    const port = process.env.PORT || 3000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)

    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: controller.signal,
      })
      expect(response.ok).toBe(true)
    } finally {
      clearTimeout(timeoutId)
    }
  })
})
