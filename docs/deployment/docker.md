# Docker 部署指南

本指南说明如何使用 Docker 和 Docker Compose 部署 OpenClaw。

## 前置条件

- 已安装 Docker 20.10+
- 已安装 Docker Compose 2.0+
- 至少 4 GB 可用内存
- 至少 20 GB 可用磁盘空间

## 快速开始

### 1. 创建 Dockerfile

#### 后端 Dockerfile

```dockerfile
# admin-backend/Dockerfile
FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# 启动应用
CMD ["node", "dist/index.js"]
```

#### 前端 Dockerfile

```dockerfile
# frontend/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# 生产镜像
FROM nginx:alpine

# 复制 Nginx 配置
COPY nginx.conf /etc/nginx/nginx.conf

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 暴露端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

# 启动 Nginx
CMD ["nginx", "-g", "daemon off;"]
```

### 2. 创建 Nginx 配置

```nginx
# frontend/nginx.conf
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 20M;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript
               application/json application/javascript application/xml+rss
               application/rss+xml font/truetype font/opentype
               application/vnd.ms-fontobject image/svg+xml;

    server {
        listen 80;
        server_name _;

        # 健康检查端点
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }

        # 前端应用
        location / {
            root /usr/share/nginx/html;
            try_files $uri $uri/ /index.html;
            expires 1h;
            add_header Cache-Control "public, immutable";
        }

        # 后端 API 代理
        location /api/ {
            proxy_pass http://backend:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

### 3. 创建 Docker Compose 配置

```yaml
# docker-compose.yml
version: '3.8'

services:
  # 后端 API
  backend:
    build:
      context: ./admin-backend
      dockerfile: Dockerfile
    container_name: openclaw-backend
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      JWT_SECRET: ${JWT_SECRET:-change-me-in-production}
      DATABASE_URL: sqlite:/data/openclaw.db
      API_BASE_URL: ${API_BASE_URL:-http://localhost:3000}
      FRONTEND_URL: ${FRONTEND_URL:-http://localhost}
      LOG_LEVEL: info
      LOG_DIR: /logs
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost}
    volumes:
      - openclaw-data:/data
      - openclaw-logs:/logs
    networks:
      - openclaw-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s

  # 前端 Web
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: openclaw-frontend
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend
    volumes:
      - ./frontend/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    networks:
      - openclaw-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s

volumes:
  openclaw-data:
    driver: local
  openclaw-logs:
    driver: local

networks:
  openclaw-network:
    driver: bridge
```

### 4. 创建环境文件

```bash
# .env
NODE_ENV=production
JWT_SECRET=your-secure-random-secret-here
API_BASE_URL=https://api.your-domain.com
FRONTEND_URL=https://your-domain.com
CORS_ORIGIN=https://your-domain.com
LOG_LEVEL=info
```

### 5. 构建和启动

```bash
# 构建镜像
docker-compose build

# 启动容器
docker-compose up -d

# 查看日志
docker-compose logs -f

# 检查服务状态
docker-compose ps
```

## 生产部署

### 使用 Docker Stack（Swarm）

```bash
# 初始化 Swarm
docker swarm init

# 部署 Stack
docker stack deploy -c docker-compose.yml openclaw

# 查看服务
docker service ls

# 查看日志
docker service logs openclaw_backend
```

### 使用 Kubernetes

详见 [Kubernetes 部署指南](./kubernetes.md)

## 容器管理

### 常用命令

```bash
# 查看容器日志
docker-compose logs backend
docker-compose logs frontend

# 进入容器
docker-compose exec backend sh
docker-compose exec frontend sh

# 重启服务
docker-compose restart backend
docker-compose restart frontend

# 停止服务
docker-compose stop

# 启动服务
docker-compose start

# 删除容器
docker-compose down

# 删除所有数据
docker-compose down -v
```

### 数据备份

```bash
# 备份数据卷
docker run --rm -v openclaw-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/openclaw-data.tar.gz -C /data .

# 恢复数据卷
docker run --rm -v openclaw-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/openclaw-data.tar.gz -C /data
```

## 监控和日志

### 查看容器资源使用

```bash
# 实时监控
docker stats

# 查看容器详细信息
docker inspect openclaw-backend
```

### 日志管理

```bash
# 查看日志
docker logs openclaw-backend

# 跟踪日志
docker logs -f openclaw-backend

# 查看最后 100 行
docker logs --tail 100 openclaw-backend

# 查看特定时间范围的日志
docker logs --since 2024-03-15T10:00:00 openclaw-backend
```

### 配置日志驱动

```yaml
# docker-compose.yml 中的日志配置
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
        labels: "service=openclaw-backend"
```

## 性能优化

### 资源限制

```yaml
# docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

  frontend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

### 网络优化

```yaml
services:
  backend:
    networks:
      openclaw-network:
        ipv4_address: 172.20.0.2
```

## 故障排查

### 容器无法启动

```bash
# 查看启动日志
docker logs openclaw-backend

# 检查镜像
docker images

# 重新构建镜像
docker-compose build --no-cache
```

### 连接问题

```bash
# 检查网络
docker network ls
docker network inspect openclaw-network

# 测试容器间连接
docker-compose exec frontend ping backend
```

### 性能问题

```bash
# 查看资源使用
docker stats

# 查看进程
docker top openclaw-backend

# 检查磁盘使用
docker system df
```

## 清理和维护

```bash
# 删除未使用的镜像
docker image prune

# 删除未使用的容器
docker container prune

# 删除未使用的卷
docker volume prune

# 完整清理
docker system prune -a
```

## 安全最佳实践

- 使用非 root 用户运行容器
- 定期更新基础镜像
- 扫描镜像漏洞：`docker scan openclaw-backend`
- 使用私有镜像仓库
- 启用镜像签名验证
- 限制容器权限和资源
- 使用 secrets 管理敏感信息
