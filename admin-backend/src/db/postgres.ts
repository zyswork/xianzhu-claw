import { Pool, PoolClient } from 'pg'

/**
 * PostgreSQL 连接池模块
 * 提供数据库连接管理和生命周期控制
 */

// 验证必需的环境变量
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME']
const missingVars = requiredEnvVars.filter(v => !process.env[v])
if (missingVars.length > 0) {
  throw new Error(`缺少必需的环境变量: ${missingVars.join(', ')}`)
}

// 创建连接池
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// 错误处理
pool.on('error', (err: Error) => {
  console.error('连接池错误:', err.message)
})

// 优雅关闭
const gracefulShutdown = async (signal: string) => {
  console.log(`收到 ${signal} 信号，正在关闭连接池...`)

  // 设置关闭超时保护（10 秒）
  const shutdownTimeout = setTimeout(() => {
    console.error('连接池关闭超时，强制退出')
    process.exit(1)
  }, 10000)

  try {
    await pool.end()
    clearTimeout(shutdownTimeout)
    console.log('连接池已关闭')
    process.exit(0)
  } catch (err) {
    console.error('连接池关闭失败:', err)
    clearTimeout(shutdownTimeout)
    process.exit(1)
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

export default pool
export type { Pool, PoolClient }
