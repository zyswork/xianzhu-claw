import { useState, useEffect } from 'react'
import { api } from '../api/tauriHttp'

interface UseBackendConnectionOptions {
  maxRetries?: number
  retryInterval?: number
}

interface UseBackendConnectionReturn {
  isConnected: boolean
  retryCount: number
  error: string | null
}

const DEFAULT_MAX_RETRIES = 10
const DEFAULT_RETRY_INTERVAL = 1000

export function useBackendConnection(
  options: UseBackendConnectionOptions = {}
): UseBackendConnectionReturn {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryInterval = DEFAULT_RETRY_INTERVAL,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    let timeoutId: NodeJS.Timeout | null = null
    let currentRetryCount = 0

    const checkBackendHealth = async () => {
      // 检测 Tauri 环境：本地 Tauri 应用不需要远程后端健康检查
      // 所有 Agent 功能通过 Tauri invoke 直接调用 Rust 端
      const isTauri = Boolean(typeof window !== 'undefined' && (window as any).__TAURI__)
      if (isTauri) {
        // Tauri 环境直接标记连接成功，跳过 HTTP health check
        if (isMounted) {
          setIsConnected(true)
          setError(null)
        }
        return
      }

      try {
        const response = await api.get('/health')

        if (response.ok) {
          if (isMounted) {
            setIsConnected(true)
            setError(null)
            setRetryCount(0)
          }
          return
        }

        throw new Error(`健康检查失败: ${response.status}`)
      } catch (err) {
        if (!isMounted) return

        const errorMessage = err instanceof Error ? err.message : '未知错误'
        setError(errorMessage)
        setIsConnected(false)

        if (currentRetryCount < maxRetries) {
          currentRetryCount += 1
          setRetryCount(currentRetryCount)
          timeoutId = setTimeout(checkBackendHealth, retryInterval)
        } else {
          setError(`连接失败：已重试 ${maxRetries} 次`)
        }
      }
    }

    checkBackendHealth()

    return () => {
      isMounted = false
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [maxRetries, retryInterval])

  return {
    isConnected,
    retryCount,
    error,
  }
}
