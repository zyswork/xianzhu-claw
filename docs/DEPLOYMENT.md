# OpenClaw 生产环境部署指南

本文档提供 OpenClaw 企业级协作平台的完整部署指南，涵盖生产环境要求、部署方式、配置管理和运维监控。

## 快速导航

- [生产环境要求](#生产环境要求)
- [部署方式](#部署方式)
  - [手动部署](#手动部署)
  - [Docker 部署](#docker-部署)
  - [Kubernetes 部署](#kubernetes-部署)
- [环境配置](#环境配置)
- [性能调优](#性能调优)
- [监控和日志](#监控和日志)
- [故障排查](#故障排查)

## 生产环境要求

### 系统要求

| 组件 | 最低配置 | 推荐配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 存储 | 20 GB | 100 GB+ |
| 操作系统 | Ubuntu 20.04 LTS / CentOS 8 / macOS 12+ | Ubuntu 22.04 LTS |

### 软件依赖

| 软件 | 版本 | 用途 |
|------|------|------|
| Node.js | 18.x+ | 后端运行时 |
| npm | 9.x+ | 包管理器 |
| SQLite / PostgreSQL | 3.x+ / 14+ | 数据库 |
| Docker | 20.10+ | 容器化部署（可选） |
| Kubernetes | 1.24+ | 容器编排（可选） |

### 网络要求

- 后端 API 端口：3000（可配置）
- 前端 Web 端口：80/443（生产环境建议使用 HTTPS）
- 数据库端口：5432（PostgreSQL）或本地 SQLite
- 监控端口：9090（Prometheus）、3100（Loki）

### 安全要求

- [ ] 启用 HTTPS/TLS 加密
- [ ] 配置防火墙规则
- [ ] 设置强密码和 JWT 密钥
- [ ] 启用日志审计
- [ ] 定期备份数据库
- [ ] 配置 CORS 白名单
- [ ] 启用速率限制

## 部署方式

### 手动部署

详见 [手动部署指南](./deployment/production.md)

### Docker 部署

详见 [Docker 部署指南](./deployment/docker.md)

### Kubernetes 部署

详见 [Kubernetes 部署指南](./deployment/kubernetes.md)

## 环境配置

详见 [环境变量配置指南](./deployment/configuration.md)

## 性能调优

详见 [性能调优指南](./deployment/performance.md)

## 监控和日志

详见 [监控和日志配置指南](./deployment/monitoring.md)

## 故障排查

### 常见问题

#### 1. 后端无法启动

**症状**：`Error: listen EADDRINUSE :::3000`

**解决方案**：
```bash
# 检查端口占用
lsof -i :3000

# 杀死占用进程
kill -9 <PID>

# 或更改端口
PORT=3001 npm start
```

#### 2. 数据库连接失败

**症状**：`Error: ENOENT: no such file or directory, open './data/openclaw.db'`

**解决方案**：
```bash
# 创建数据目录
mkdir -p ./data

# 检查数据库文件权限
chmod 755 ./data
```

#### 3. CORS 错误

**症状**：浏览器控制台显示 `Access to XMLHttpRequest blocked by CORS policy`

**解决方案**：
```bash
# 检查 CORS_ORIGIN 配置
echo $CORS_ORIGIN

# 更新 .env 文件
CORS_ORIGIN=https://your-domain.com
```

#### 4. 内存溢出

**症状**：`JavaScript heap out of memory`

**解决方案**：
```bash
# 增加 Node.js 堆内存
NODE_OPTIONS="--max-old-space-size=4096" npm start
```

### 日志查看

```bash
# 查看后端日志
tail -f logs/backend_*.log

# 查看前端构建日志
tail -f logs/frontend_*.log

# 实时监控日志
journalctl -u openclaw-backend -f
```

### 性能诊断

```bash
# 检查系统资源
top -b -n 1 | head -20

# 检查磁盘使用
df -h

# 检查内存使用
free -h

# 检查网络连接
netstat -an | grep ESTABLISHED | wc -l
```

## 升级指南

### 版本升级步骤

1. **备份数据**
   ```bash
   cp -r ./data ./data.backup.$(date +%Y%m%d)
   ```

2. **停止服务**
   ```bash
   systemctl stop openclaw-backend
   systemctl stop openclaw-frontend
   ```

3. **更新代码**
   ```bash
   git pull origin main
   npm install
   npm run build
   ```

4. **运行迁移**
   ```bash
   npm run migrate
   ```

5. **启动服务**
   ```bash
   systemctl start openclaw-backend
   systemctl start openclaw-frontend
   ```

6. **验证升级**
   ```bash
   curl http://localhost:3000/health
   ```

## 备份和恢复

### 自动备份

```bash
# 创建备份脚本 backup.sh
#!/bin/bash
BACKUP_DIR="/backups/openclaw"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
cp -r ./data $BACKUP_DIR/data_$DATE
tar -czf $BACKUP_DIR/backup_$DATE.tar.gz $BACKUP_DIR/data_$DATE

# 保留最近 7 天的备份
find $BACKUP_DIR -name "backup_*.tar.gz" -mtime +7 -delete
```

### 恢复数据

```bash
# 停止服务
systemctl stop openclaw-backend

# 恢复备份
tar -xzf /backups/openclaw/backup_20240315_120000.tar.gz -C ./

# 启动服务
systemctl start openclaw-backend
```

## 支持和反馈

- 文档：https://docs.openclaw.io
- 问题报告：https://github.com/openclaw/openclaw/issues
- 讨论：https://github.com/openclaw/openclaw/discussions
