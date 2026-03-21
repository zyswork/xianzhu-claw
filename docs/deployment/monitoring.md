# 监控和日志配置指南

本指南说明如何配置 OpenClaw 的监控、日志和告警系统。

## 监控架构

```
┌─────────────────────────────────────────────────┐
│           OpenClaw 应用                         │
│  ┌──────────────────────────────────────────┐  │
│  │ 应用指标 (Prometheus)                    │  │
│  │ 日志 (Loki)                              │  │
│  │ 追踪 (Jaeger)                            │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
         ↓              ↓              ↓
    ┌────────┐    ┌────────┐    ┌────────┐
    │Prometheus│  │  Loki  │    │ Jaeger │
    └────────┘    └────────┘    └────────┘
         ↓              ↓              ↓
    ┌──────────────────────────────────────┐
    │      Grafana (可视化)                │
    └──────────────────────────────────────┘
         ↓
    ┌──────────────────────────────────────┐
    │      AlertManager (告警)             │
    └──────────────────────────────────────┘
```

## 日志配置

### 后端日志配置

```javascript
// admin-backend/src/config/logger.ts
import winston from 'winston';
import path from 'path';

const logDir = process.env.LOG_DIR || './logs';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'openclaw-backend' },
  transports: [
    // 错误日志
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880,  // 5MB
      maxFiles: 5,
    }),
    // 组合日志
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,  // 5MB
      maxFiles: 5,
    }),
    // 控制台输出
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
      ),
    }),
  ],
});

export default logger;
```

### 日志轮转配置

```bash
# /etc/logrotate.d/openclaw
/var/log/openclaw/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 openclaw openclaw
    sharedscripts
    postrotate
        systemctl reload openclaw-backend > /dev/null 2>&1 || true
    endscript
}
```

### 日志级别

| 级别 | 用途 | 示例 |
|------|------|------|
| ERROR | 错误事件 | 数据库连接失败 |
| WARN | 警告事件 | 性能下降 |
| INFO | 信息事件 | 用户登录 |
| DEBUG | 调试信息 | 函数参数值 |

## Prometheus 监控

### 安装 Prometheus

```bash
# 下载
wget https://github.com/prometheus/prometheus/releases/download/v2.40.0/prometheus-2.40.0.linux-amd64.tar.gz
tar xzf prometheus-2.40.0.linux-amd64.tar.gz
sudo mv prometheus-2.40.0.linux-amd64 /opt/prometheus

# 创建用户
sudo useradd -r prometheus

# 设置权限
sudo chown -R prometheus:prometheus /opt/prometheus
```

### Prometheus 配置

```yaml
# /opt/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: 'openclaw-monitor'

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - localhost:9093

rule_files:
  - 'alert_rules.yml'

scrape_configs:
  # 后端 API
  - job_name: 'openclaw-backend'
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics'
    scrape_interval: 10s

  # Prometheus 自身
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
```

### 应用指标导出

```javascript
// admin-backend/src/middleware/metrics.ts
import promClient from 'prom-client';

// 创建指标
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求耗时',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'HTTP 请求总数',
  labelNames: ['method', 'route', 'status_code'],
});

const dbQueryDuration = new promClient.Histogram({
  name: 'db_query_duration_seconds',
  help: '数据库查询耗时',
  labelNames: ['query_type'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1],
});

// 中间件
export function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
    httpRequestTotal
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .inc();
  });

  next();
}

// 导出端点
export function metricsEndpoint(req, res) {
  res.set('Content-Type', promClient.register.contentType);
  res.end(promClient.register.metrics());
}
```

### 告警规则

```yaml
# /opt/prometheus/alert_rules.yml
groups:
  - name: openclaw
    interval: 30s
    rules:
      # 后端不可用
      - alert: BackendDown
        expr: up{job="openclaw-backend"} == 0
        for: 1m
        annotations:
          summary: "OpenClaw 后端不可用"
          description: "后端服务已离线超过 1 分钟"

      # 高错误率
      - alert: HighErrorRate
        expr: |
          (sum(rate(http_requests_total{status_code=~"5.."}[5m])) /
           sum(rate(http_requests_total[5m]))) > 0.05
        for: 5m
        annotations:
          summary: "高错误率告警"
          description: "错误率超过 5%"

      # 高响应时间
      - alert: HighResponseTime
        expr: |
          histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1
        for: 5m
        annotations:
          summary: "高响应时间告警"
          description: "P95 响应时间超过 1 秒"

      # 内存使用过高
      - alert: HighMemoryUsage
        expr: |
          (process_resident_memory_bytes / 1024 / 1024) > 1024
        for: 5m
        annotations:
          summary: "内存使用过高"
          description: "内存使用超过 1GB"

      # 数据库连接耗尽
      - alert: DatabaseConnectionPoolExhausted
        expr: |
          db_connection_pool_available < 2
        for: 1m
        annotations:
          summary: "数据库连接池耗尽"
          description: "可用连接数少于 2"
```

## Loki 日志聚合

### 安装 Loki

```bash
# 下载
wget https://github.com/grafana/loki/releases/download/v2.8.0/loki-linux-amd64.zip
unzip loki-linux-amd64.zip
sudo mv loki-linux-amd64 /opt/loki

# 创建用户
sudo useradd -r loki

# 设置权限
sudo chown -R loki:loki /opt/loki
```

### Loki 配置

```yaml
# /opt/loki/loki-config.yaml
auth_enabled: false

ingester:
  chunk_idle_period: 3m
  max_chunk_age: 1h
  max_streams_per_user: 10000
  chunk_retain_period: 1m

limits_config:
  enforce_metric_name: false
  reject_old_samples: true
  reject_old_samples_max_age: 168h

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

server:
  http_listen_port: 3100
  log_level: info

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/boltdb-shipper-active
    cache_location: /loki/boltdb-shipper-cache
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks
```

### Promtail 配置（日志收集）

```yaml
# /opt/promtail/promtail-config.yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://localhost:3100/loki/api/v1/push

scrape_configs:
  - job_name: openclaw-backend
    static_configs:
      - targets:
          - localhost
        labels:
          job: openclaw-backend
          __path__: /var/log/openclaw/*.log
    pipeline_stages:
      - json:
          expressions:
            timestamp: timestamp
            level: level
            message: message
      - timestamp:
          source: timestamp
          format: '2006-01-02T15:04:05Z07:00'
      - labels:
          level:
          message:
```

## Grafana 仪表板

### 安装 Grafana

```bash
# 使用 apt
sudo apt-get install -y software-properties-common
sudo add-apt-repository "deb https://packages.grafana.com/oss/deb stable main"
sudo apt-get update
sudo apt-get install grafana-server

# 启动服务
sudo systemctl enable grafana-server
sudo systemctl start grafana-server
```

### 创建仪表板

访问 `http://localhost:3000`，默认用户名/密码：`admin/admin`

#### 添加数据源

1. Configuration → Data Sources
2. Add data source
3. 选择 Prometheus
4. URL: `http://localhost:9090`
5. Save & Test

#### 创建仪表板

```json
{
  "dashboard": {
    "title": "OpenClaw 监控",
    "panels": [
      {
        "title": "请求速率",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])"
          }
        ]
      },
      {
        "title": "错误率",
        "targets": [
          {
            "expr": "rate(http_requests_total{status_code=~\"5..\"}[5m])"
          }
        ]
      },
      {
        "title": "响应时间 (P95)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

## 分布式追踪（Jaeger）

### 安装 Jaeger

```bash
# Docker 方式
docker run -d --name jaeger \
  -e COLLECTOR_ZIPKIN_HOST_PORT=:9411 \
  -p 5775:5775/udp \
  -p 6831:6831/udp \
  -p 6832:6832/udp \
  -p 5778:5778 \
  -p 16686:16686 \
  -p 14268:14268 \
  -p 14250:14250 \
  -p 9411:9411 \
  jaegertracing/all-in-one:latest
```

### 应用集成

```javascript
// admin-backend/src/config/tracing.ts
import { initTracer } from 'jaeger-client';

const initJaeger = (serviceName) => {
  const config = {
    serviceName: serviceName,
    sampler: {
      type: 'const',
      param: 1,
    },
    reporter_loggers: true,
  };

  const options = {
    logger: console,
  };

  return initTracer(config, options);
};

export default initJaeger;
```

## 告警配置

### AlertManager 配置

```yaml
# /opt/alertmanager/alertmanager.yml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 12h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical'
      continue: true

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops@example.com'
        from: 'alertmanager@example.com'
        smarthost: 'smtp.example.com:587'
        auth_username: 'alertmanager@example.com'
        auth_password: 'password'

  - name: 'critical'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
        channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

## 监控最佳实践

### 关键指标

1. **可用性**
   - 服务正常运行时间
   - 错误率
   - 健康检查状态

2. **性能**
   - 响应时间（P50、P95、P99）
   - 吞吐量（RPS）
   - 数据库查询时间

3. **资源**
   - CPU 使用率
   - 内存使用率
   - 磁盘使用率
   - 网络 I/O

4. **业务**
   - 活跃用户数
   - 请求成功率
   - 转化率

### 告警策略

- 关键告警：立即通知（Slack、电话）
- 警告告警：邮件通知
- 信息告警：日志记录

### 定期审查

- 每周审查告警规则
- 每月审查性能指标
- 每季度审查监控架构

## 故障排查

### 常见问题

#### Prometheus 无法连接到应用

```bash
# 检查应用是否运行
curl http://localhost:3000/health

# 检查指标端点
curl http://localhost:3000/metrics

# 检查防火墙
sudo ufw allow 3000
```

#### Loki 日志未出现

```bash
# 检查 Promtail 状态
systemctl status promtail

# 检查日志文件权限
ls -la /var/log/openclaw/

# 查看 Promtail 日志
journalctl -u promtail -f
```

#### Grafana 仪表板为空

```bash
# 检查数据源连接
curl http://localhost:9090/api/v1/query?query=up

# 检查 Prometheus 数据
curl 'http://localhost:9090/api/v1/query?query=http_requests_total'
```
