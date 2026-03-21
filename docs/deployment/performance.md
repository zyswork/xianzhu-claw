# 性能调优指南

本指南提供 OpenClaw 生产环境的性能调优建议。

## 性能调优检查清单

- [ ] 启用 Gzip 压缩
- [ ] 配置缓存策略
- [ ] 优化数据库连接池
- [ ] 启用 CDN
- [ ] 配置���载均衡
- [ ] 监控关键指标
- [ ] 定期性能测试

## 后端性能调优

### Node.js 运行时优化

```bash
# 增加堆内存
NODE_OPTIONS="--max-old-space-size=4096"

# 启用垃圾回收优化
NODE_OPTIONS="--max-old-space-size=4096 --gc-interval=100"

# 启用 V8 代码缓存
NODE_OPTIONS="--max-old-space-size=4096 --v8-code-cache-dir=/tmp/v8-cache"
```

### 数据库连接池优化

```javascript
// admin-backend/src/config/database.ts
const poolConfig = {
  min: 5,           // 最小连接数
  max: 20,          // 最大连接数
  idleTimeoutMillis: 30000,  // 空闲连接超时
  connectionTimeoutMillis: 2000,  // 连接超时
  statement_timeout: 30000,  // SQL 语句超时
};
```

### Express 中间件优化

```javascript
// 启用压缩
import compression from 'compression';
app.use(compression({
  level: 6,  // 压缩级别 0-9
  threshold: 1024,  // 最小压缩大小
}));

// 启用缓存
import cacheControl from 'express-cache-control';
app.use(cacheControl({
  maxAge: 3600,  // 1 小时
}));

// 限制请求体大小
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb' }));
```

### 连接池监控

```javascript
// 监控连接池状态
setInterval(() => {
  const poolStats = db.pool.status();
  console.log('连接池状态:', {
    idle: poolStats.idle,
    waiting: poolStats.waiting,
    total: poolStats.total,
  });
}, 60000);
```

## 前端性能调优

### 构建优化

```javascript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // 代码分割
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router': ['react-router-dom'],
          'state': ['zustand'],
        },
      },
    },
    // 压缩
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
    // 资源内联
    assetsInlineLimit: 4096,
    // 输出目录
    outDir: 'dist',
    // 清空输出目录
    emptyOutDir: true,
  },
  // 优化依赖
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'zustand'],
  },
});
```

### 缓存策略

```nginx
# Nginx 缓存配置
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

location ~* \.html$ {
    expires 1h;
    add_header Cache-Control "public, must-revalidate";
}

location / {
    expires -1;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

### 图片优化

```javascript
// 使用 WebP 格式
<picture>
  <source srcset="image.webp" type="image/webp">
  <img src="image.jpg" alt="description">
</picture>

// 响应式图片
<img
  srcset="image-small.jpg 480w, image-medium.jpg 768w, image-large.jpg 1200w"
  sizes="(max-width: 480px) 100vw, (max-width: 768px) 50vw, 33vw"
  src="image-medium.jpg"
  alt="description"
>
```

## 网络优化

### Gzip 压缩

```nginx
# Nginx 配置
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript
           application/json application/javascript application/xml+rss
           application/rss+xml font/truetype font/opentype
           application/vnd.ms-fontobject image/svg+xml;
gzip_min_length 1000;
gzip_disable "msie6";
```

### HTTP/2 推送

```nginx
# Nginx 配置
server {
    listen 443 ssl http2;

    # 推送关键资源
    location / {
        http2_push /css/style.css;
        http2_push /js/app.js;
    }
}
```

### CDN 配置

```nginx
# 添加 CDN 头
add_header X-CDN-Cache $upstream_cache_status;
add_header Cache-Control "public, max-age=3600";

# 缓存键配置
proxy_cache_key "$scheme$request_method$host$request_uri";
```

## 数据库优化

### 索引优化

```sql
-- 创建常用查询的索引
CREATE INDEX idx_user_email ON users(email);
CREATE INDEX idx_user_created_at ON users(created_at);
CREATE INDEX idx_post_user_id ON posts(user_id);
CREATE INDEX idx_post_created_at ON posts(created_at);

-- 复合索引
CREATE INDEX idx_post_user_created ON posts(user_id, created_at);
```

### 查询优化

```javascript
// 使用 SELECT 指定列
SELECT id, name, email FROM users;  // ✓ 好

// 避免 SELECT *
SELECT * FROM users;  // ✗ 不好

// 使用 LIMIT
SELECT * FROM posts LIMIT 10 OFFSET 0;  // ✓ 好

// 避免全表扫描
SELECT * FROM posts WHERE created_at > '2024-01-01';  // ✓ 好
```

### 连接池配置

```javascript
// 最优连接池大小 = (核心数 * 2) + 有效磁盘数
// 例如：4 核 CPU = (4 * 2) + 1 = 9 个连接

const poolConfig = {
  min: 5,
  max: 20,
  idleTimeoutMillis: 30000,
};
```

## 监控和分析

### 性能指标

| 指标 | 目标 | 工具 |
|------|------|------|
| 首屏加载时间 (FCP) | < 1.8s | Lighthouse |
| 最大内容绘制 (LCP) | < 2.5s | Lighthouse |
| 累积布局偏移 (CLS) | < 0.1 | Lighthouse |
| 首字节时间 (TTFB) | < 600ms | WebPageTest |
| API 响应时间 | < 200ms | New Relic |
| 数据库查询时间 | < 100ms | DataDog |

### 性能测试

```bash
# 使用 Apache Bench
ab -n 1000 -c 100 http://localhost:3000/api/health

# 使用 wrk
wrk -t12 -c400 -d30s http://localhost:3000/api/health

# 使用 k6
k6 run performance-test.js
```

### 性能测试脚本

```javascript
// performance-test.js (k6)
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m30s', target: 100 },
    { duration: '20s', target: 0 },
  ],
};

export default function () {
  const res = http.get('http://localhost:3000/api/health');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 200ms': (r) => r.timings.duration < 200,
  });
  sleep(1);
}
```

## 常见性能问题

### 问题 1：内存泄漏

**症状**：内存使用持续增长

**诊断：**
```bash
# 使用 clinic.js
npm install -g clinic
clinic doctor -- node dist/index.js
```

**解决方案：**
- 检查事件监听器是否正确移除
- 检查定时器是否正确清理
- 使用内存分析工具定位泄漏

### 问题 2：数据库连接耗尽

**症状**：`Error: connect ECONNREFUSED`

**解决方案：**
```javascript
// 检查连接池状态
console.log(db.pool.status());

// 增加连接池大小
const poolConfig = { max: 30 };

// 实现连接超时
db.query({ timeout: 5000 });
```

### 问题 3：CPU 使用率高

**症状**：CPU 占用 > 80%

**诊断：**
```bash
# 使用 Node.js 性能分析
node --prof dist/index.js
node --prof-process isolate-*.log > profile.txt
```

**解决方案：**
- 优化算法复杂度
- 使用缓存减少计算
- 启用 Worker Threads 处理 CPU 密集任务

## 性能基准

### 目标性能指标

| 指标 | 目标值 |
|------|--------|
| API 响应时间 (p50) | < 100ms |
| API 响应时间 (p95) | < 500ms |
| API 响应时间 (p99) | < 1000ms |
| 错误率 | < 0.1% |
| 可用性 | > 99.9% |
| 吞吐量 | > 1000 req/s |

### 性能测试结果示例

```
Requests/sec:   1250.50
Transfer/sec:   2.50MB
Latency (avg):  80ms
Latency (p95):  450ms
Latency (p99):  950ms
Error rate:     0.05%
```
