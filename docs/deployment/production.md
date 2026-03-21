# 生产环境部署指南

本指南详细说明如何在生产环境中手动部署 OpenClaw。

## 前置条件

- 服务器访问权限（SSH）
- 已安装 Node.js 18.x+ 和 npm 9.x+
- 已安装 Git
- 已配置 SSL/TLS 证书
- 已配置域名 DNS 解析

## 部署检查清单

### 预部署检查

- [ ] 服务器系统更新：`sudo apt update && sudo apt upgrade -y`
- [ ] 防火墙配置：允许 80、443、3000 端口
- [ ] 磁盘空间充足：至少 20 GB 可用空间
- [ ] 内存充足：至少 4 GB 可用内存
- [ ] 时间同步：`timedatectl status`
- [ ] 备份现有数据（如有）

### 安全检查

- [ ] 更改默认 SSH 端口
- [ ] 禁用 root 登录
- [ ] 配置 SSH 密钥认证
- [ ] 启用防火墙（UFW 或 firewalld）
- [ ] 配置 fail2ban 防暴力破解
- [ ] 启用 SELinux 或 AppArmor

## 部署步骤

### 1. 系统准备

```bash
# 更新系统
sudo apt update
sudo apt upgrade -y

# 安装必要工具
sudo apt install -y curl wget git build-essential

# 安装 Node.js（使用 NodeSource 仓库）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node --version
npm --version
```

### 2. 创建应用用户

```bash
# 创建专用用户
sudo useradd -m -s /bin/bash openclaw

# 创建应用目录
sudo mkdir -p /opt/openclaw
sudo chown openclaw:openclaw /opt/openclaw

# 创建日志目录
sudo mkdir -p /var/log/openclaw
sudo chown openclaw:openclaw /var/log/openclaw

# 创建数据目录
sudo mkdir -p /var/lib/openclaw/data
sudo chown openclaw:openclaw /var/lib/openclaw/data
```

### 3. 克隆和配置应用

```bash
# 切换到应用用户
sudo su - openclaw

# 克隆仓库
cd /opt/openclaw
git clone https://github.com/openclaw/openclaw.git .
cd my-openclaw

# 安装依赖
npm install --production

# 构建应用
npm run build
```

### 4. 环境配置

```bash
# 创建生产环境配置
cat > admin-backend/.env << 'EOF'
# 环境
NODE_ENV=production
PORT=3000

# JWT 配置（必须更改！）
JWT_SECRET=$(openssl rand -base64 32)

# 数据库
DATABASE_URL=sqlite:/var/lib/openclaw/data/openclaw.db

# API 配置
API_BASE_URL=https://api.your-domain.com
FRONTEND_URL=https://your-domain.com

# 日志
LOG_LEVEL=info
LOG_DIR=/var/log/openclaw

# CORS 配置
CORS_ORIGIN=https://your-domain.com

# 性能
NODE_OPTIONS=--max-old-space-size=2048
EOF

# 设置权限
chmod 600 admin-backend/.env
```

### 5. 配置 Systemd 服务

```bash
# 创建后端服务文件
sudo tee /etc/systemd/system/openclaw-backend.service > /dev/null << 'EOF'
[Unit]
Description=OpenClaw Backend API
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/opt/openclaw/my-openclaw/admin-backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"
Environment="PORT=3000"

[Install]
WantedBy=multi-user.target
EOF

# 创建前端服务文件（使用 Nginx）
sudo tee /etc/systemd/system/openclaw-frontend.service > /dev/null << 'EOF'
[Unit]
Description=OpenClaw Frontend Web Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/sbin/nginx -g "daemon off;"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 重新加载 systemd
sudo systemctl daemon-reload
```

### 6. 配置 Nginx 反向代理

```bash
# 安装 Nginx
sudo apt install -y nginx

# 创建 Nginx 配置
sudo tee /etc/nginx/sites-available/openclaw > /dev/null << 'EOF'
upstream backend {
    server localhost:3000;
    keepalive 64;
}

server {
    listen 80;
    server_name your-domain.com;

    # 重定向到 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 证书配置
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 日志
    access_log /var/log/nginx/openclaw_access.log;
    error_log /var/log/nginx/openclaw_error.log;

    # 前端静态文件
    location / {
        root /opt/openclaw/my-openclaw/frontend/dist;
        try_files $uri $uri/ /index.html;
        expires 1h;
        add_header Cache-Control "public, immutable";
    }

    # 后端 API
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查端点
    location /health {
        proxy_pass http://backend;
        access_log off;
    }
}
EOF

# 启用站点
sudo ln -sf /etc/nginx/sites-available/openclaw /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 测试 Nginx 配置
sudo nginx -t

# 启动 Nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

### 7. 配置 SSL 证书（Let's Encrypt）

```bash
# 安装 Certbot
sudo apt install -y certbot python3-certbot-nginx

# 获取证书
sudo certbot certonly --nginx -d your-domain.com

# 配置自动续期
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### 8. 启动服务

```bash
# 启动后端服务
sudo systemctl enable openclaw-backend
sudo systemctl start openclaw-backend

# 检查服务状态
sudo systemctl status openclaw-backend

# 查看日志
sudo journalctl -u openclaw-backend -f
```

### 9. 验证部署

```bash
# 检查后端健康状态
curl http://localhost:3000/health

# 检查前端访问
curl -I https://your-domain.com

# 检查 API 连接
curl -I https://your-domain.com/api/health

# 检查日志
sudo tail -f /var/log/openclaw/backend_*.log
```

## 生产环境优化

### 性能优化

```bash
# 启用 gzip 压缩（Nginx 配置）
gzip on;
gzip_types text/plain text/css text/javascript application/json;
gzip_min_length 1000;

# 启用缓存
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=api_cache:10m;
location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 10m;
}
```

### 监控配置

```bash
# 安装监控工具
sudo apt install -y htop iotop nethogs

# 配置日志轮转
sudo tee /etc/logrotate.d/openclaw > /dev/null << 'EOF'
/var/log/openclaw/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 openclaw openclaw
    sharedscripts
    postrotate
        systemctl reload openclaw-backend > /dev/null 2>&1 || true
    endscript
}
EOF
```

## 故障恢复

### 服务重启

```bash
# 重启后端
sudo systemctl restart openclaw-backend

# 重启前端
sudo systemctl restart openclaw-frontend

# 重启所有服务
sudo systemctl restart openclaw-backend openclaw-frontend nginx
```

### 日志诊断

```bash
# 查看系统日志
sudo journalctl -u openclaw-backend -n 100

# 查看应用日志
sudo tail -f /var/log/openclaw/backend_*.log

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/openclaw_error.log
```

### 数据恢复

```bash
# 备份当前数据
sudo cp -r /var/lib/openclaw/data /var/lib/openclaw/data.backup

# 恢复备份
sudo cp -r /var/lib/openclaw/data.backup/* /var/lib/openclaw/data/

# 重启服务
sudo systemctl restart openclaw-backend
```

## 安全加固

### 防火墙配置

```bash
# 启用 UFW
sudo ufw enable

# 允许 SSH
sudo ufw allow 22/tcp

# 允许 HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 拒绝其他端口
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

### 定期维护

```bash
# 每周检查日志
0 0 * * 0 /usr/bin/find /var/log/openclaw -name "*.log" -mtime +30 -delete

# 每月更新系统
0 2 1 * * /usr/bin/apt update && /usr/bin/apt upgrade -y

# 每天备份数据
0 3 * * * /opt/openclaw/backup.sh
```

## 常见问题

**Q: 如何更改 API 端口？**
A: 修改 `.env` 文件中的 `PORT` 变量，然后重启服务。

**Q: 如何启用 HTTPS？**
A: 使用 Let's Encrypt 和 Certbot 自动配置 SSL 证书。

**Q: 如何扩展存储空间？**
A: 停止服务，扩展磁盘，然后重启服务。

**Q: 如何监控性能？**
A: 使用 `top`、`htop` 或配置 Prometheus + Grafana。
