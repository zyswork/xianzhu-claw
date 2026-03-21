# 环境变量配置指南

本指南详细说明 OpenClaw 的所有环境变量配置。

## 配置概览

OpenClaw 使用环境变量管理配置，支持以下方式：

1. `.env` 文件（本地开发）
2. 系统环境变量（生产环境）
3. Docker 环境变量（容器部署）
4. Kubernetes ConfigMap（K8s 部署）

## 后端配置

### 基础配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `NODE_ENV` | string | `development` | 运行环境：`development`、`production`、`test` |
| `PORT` | number | `3000` | 服务器监听端口 |
| `LOG_LEVEL` | string | `info` | 日志级别：`debug`、`info`、`warn`、`error` |
| `LOG_DIR` | string | `./logs` | 日志输出目录 |

### JWT 配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `JWT_SECRET` | string | 无 | JWT 签名密钥（**必须设置**） |
| `JWT_EXPIRES_IN` | string | `7d` | Token 过期时间 |
| `JWT_ALGORITHM` | string | `HS256` | JWT 算法 |

**生成安全的 JWT_SECRET：**

```bash
# 使用 OpenSSL
openssl rand -base64 32

# 使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 使用 Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### 数据库配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `DATABASE_URL` | string | `sqlite:./data/openclaw.db` | 数据库连接字符串 |
| `DATABASE_POOL_MIN` | number | `2` | 连接池最小连接数 |
| `DATABASE_POOL_MAX` | number | `10` | 连接池最大连接数 |
| `DATABASE_TIMEOUT` | number | `5000` | 数据库操作超时（毫秒） |

**数据库连接字符串示例：**

```bash
# SQLite（本地开发）
DATABASE_URL=sqlite:./data/openclaw.db

# SQLite（绝对路径）
DATABASE_URL=sqlite:/var/lib/openclaw/data/openclaw.db

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/openclaw

# PostgreSQL（SSL）
DATABASE_URL=postgresql://user:password@localhost:5432/openclaw?sslmode=require
```

### API 配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `API_BASE_URL` | string | `http://localhost:3000` | API 基础 URL |
| `FRONTEND_URL` | string | `http://localhost:5173` | 前端 URL |
| `CORS_ORIGIN` | string | `http://localhost:5173` | CORS 允许的源 |
| `CORS_CREDENTIALS` | boolean | `true` | 是否允许跨域凭证 |
| `CORS_MAX_AGE` | number | `86400` | CORS 预检请求缓存时间（秒） |

**CORS_ORIGIN 配置示例：**

```bash
# 单个源
CORS_ORIGIN=https://example.com

# 多个源（逗号分隔）
CORS_ORIGIN=https://example.com,https://app.example.com,https://admin.example.com

# 允许所有源（仅开发环境）
CORS_ORIGIN=*
```

### 性能配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `NODE_OPTIONS` | string | 无 | Node.js 运行时选项 |
| `REQUEST_TIMEOUT` | number | `30000` | 请求超时（毫秒） |
| `BODY_SIZE_LIMIT` | string | `10mb` | 请求体大小限制 |
| `COMPRESSION_LEVEL` | number | `6` | Gzip 压缩级别（0-9） |

**NODE_OPTIONS 示例：**

```bash
# 增加堆内存
NODE_OPTIONS=--max-old-space-size=4096

# 启用垃圾回收日志
NODE_OPTIONS=--trace-gc

# 多个选项
NODE_OPTIONS="--max-old-space-size=4096 --trace-gc"
```

### 安全配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `RATE_LIMIT_WINDOW` | number | `900000` | 速率限制时间窗口（毫秒） |
| `RATE_LIMIT_MAX_REQUESTS` | number | `100` | 时间窗口内最大请求数 |
| `HELMET_ENABLED` | boolean | `true` | 是否启用 Helmet 安全头 |
| `HTTPS_ONLY` | boolean | `false` | 是否仅允许 HTTPS |

### 监控配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `METRICS_ENABLED` | boolean | `true` | 是否启用指标收集 |
| `METRICS_PORT` | number | `9090` | Prometheus 指标端口 |
| `TRACING_ENABLED` | boolean | `false` | 是否启用分布式追踪 |
| `TRACING_SAMPLE_RATE` | number | `0.1` | 追踪采样率（0-1） |

## 前端配置

### 构建配置

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `VITE_API_BASE_URL` | string | `http://localhost:3000` | API 基础 URL |
| `VITE_APP_TITLE` | string | `OpenClaw` | 应用标题 |
| `VITE_APP_VERSION` | string | `0.1.0` | 应用版本 |

**注意：** Vite 环境变量必须以 `VITE_` 前缀开头。

### 环境文件示例

```bash
# .env（所有环境）
VITE_APP_TITLE=OpenClaw

# .env.development（开发环境）
VITE_API_BASE_URL=http://localhost:3000

# .env.production（生产环境）
VITE_API_BASE_URL=https://api.example.com
```

## 配置文件示例

### 开发环境 (.env.development)

```bash
# 环境
NODE_ENV=development
PORT=3000

# JWT
JWT_SECRET=dev-secret-key-change-in-production

# 数据库
DATABASE_URL=sqlite:./data/openclaw.db

# API
API_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173

# 日志
LOG_LEVEL=debug
LOG_DIR=./logs

# 前端
VITE_API_BASE_URL=http://localhost:3000
VITE_APP_TITLE=OpenClaw Dev
```

### 生产环境 (.env.production)

```bash
# 环境
NODE_ENV=production
PORT=3000

# JWT（使用强密钥）
JWT_SECRET=your-secure-random-secret-here-min-32-chars

# 数据库
DATABASE_URL=postgresql://user:password@db.example.com:5432/openclaw
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20

# API
API_BASE_URL=https://api.example.com
FRONTEND_URL=https://example.com
CORS_ORIGIN=https://example.com

# 日志
LOG_LEVEL=info
LOG_DIR=/var/log/openclaw

# 性能
NODE_OPTIONS=--max-old-space-size=4096
REQUEST_TIMEOUT=30000
COMPRESSION_LEVEL=6

# 安全
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX_REQUESTS=100
HELMET_ENABLED=true
HTTPS_ONLY=true

# 监控
METRICS_ENABLED=true
METRICS_PORT=9090

# 前端
VITE_API_BASE_URL=https://api.example.com
VITE_APP_TITLE=OpenClaw
```

### Docker 环境 (.env.docker)

```bash
# 环境
NODE_ENV=production
PORT=3000

# JWT
JWT_SECRET=${JWT_SECRET}

# 数据库
DATABASE_URL=sqlite:/data/openclaw.db

# API
API_BASE_URL=http://backend:3000
FRONTEND_URL=http://frontend
CORS_ORIGIN=http://frontend

# 日志
LOG_LEVEL=info
LOG_DIR=/logs

# 前端
VITE_API_BASE_URL=/api
VITE_APP_TITLE=OpenClaw
```

## 配置验证

### 验证脚本

```bash
#!/bin/bash
# validate-config.sh

set -e

echo "验证环境配置..."

# 检查必需变量
required_vars=("JWT_SECRET" "DATABASE_URL" "API_BASE_URL" "FRONTEND_URL")

for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "错误：缺少必需变量 $var"
        exit 1
    fi
done

# 验证 JWT_SECRET 长度
if [ ${#JWT_SECRET} -lt 32 ]; then
    echo "警告：JWT_SECRET 长度小于 32 字符，建议增加安全性"
fi

# 验证 URL 格式
if ! [[ "$API_BASE_URL" =~ ^https?:// ]]; then
    echo "错误：API_BASE_URL 格式不正确"
    exit 1
fi

# 验证数据库连接
if [[ "$DATABASE_URL" == sqlite:* ]]; then
    db_path="${DATABASE_URL#sqlite:}"
    if [ ! -d "$(dirname "$db_path")" ]; then
        echo "错误：数据库目录不存在：$(dirname "$db_path")"
        exit 1
    fi
fi

echo "✓ 配置验证通过"
```

### 运行验证

```bash
chmod +x validate-config.sh
./validate-config.sh
```

## 配置最佳实践

### 安全建议

1. **不要提交 .env 文件到版本控制**
   ```bash
   echo ".env" >> .gitignore
   echo ".env.*.local" >> .gitignore
   ```

2. **使用 .env.example 作为模板**
   ```bash
   cp .env.example .env
   # 编辑 .env 填入实际值
   ```

3. **定期轮换 JWT_SECRET**
   ```bash
   # 生成新密钥
   openssl rand -base64 32

   # 更新环境变量
   JWT_SECRET=new-secret-key
   ```

4. **使用密钥管理服务**
   - AWS Secrets Manager
   - HashiCorp Vault
   - Azure Key Vault

### 性能建议

1. **根据服务器资源调整堆内存**
   ```bash
   # 4GB 服务器
   NODE_OPTIONS=--max-old-space-size=2048

   # 8GB 服务器
   NODE_OPTIONS=--max-old-space-size=4096
   ```

2. **调整数据库连接池**
   ```bash
   # 高并发场景
   DATABASE_POOL_MIN=10
   DATABASE_POOL_MAX=50
   ```

3. **启用压缩**
   ```bash
   COMPRESSION_LEVEL=6  # 平衡压缩率和 CPU 使用
   ```

## 故障排查

### 配置加载失败

```bash
# 检查 .env 文件
cat .env

# 检查环境变量
env | grep -E "^(NODE_|JWT_|DATABASE_|API_|CORS_)"

# 检查文件权限
ls -la .env
```

### 连接问题

```bash
# 测试数据库连接
npm run test:db

# 测试 API 连接
curl -v http://localhost:3000/health

# 检查 CORS 配置
curl -H "Origin: http://localhost:5173" -v http://localhost:3000/api/health
```
