# 故障排查指南

本指南帮助您诊断和解决 OpenClaw 系统中的常见问题。

## 快速导航

- [常见问题](./troubleshooting/common-issues.md) - 常见错误和解决方案
- [调试技巧](./troubleshooting/debugging.md) - 调试工具和技术
- [性能诊断](#性能诊断) - 性能问题排查
- [日志分析](#日志分析) - 日志查看和分析
- [获取支持](#获取支持) - 联系支持的方式

## 性能诊断

### 系统响应缓慢

**症状**：应用响应时间长，操作延迟明显

**诊断步骤**：

1. **检查系统资源**
   ```bash
   # 查看 CPU 和内存使用
   top -l 1 | head -20

   # 查看磁盘 I/O
   iostat -w 1
   ```

2. **检查应用日志**
   ```bash
   tail -f log/app_*.log
   ```

3. **分析性能指标**
   - 查看 `docs/performance/` 目录下的性能报告
   - 检查数据库查询时间
   - 监控网络延迟

**常见原因**：
- 数据库查询未优化
- 内存泄漏
- 磁盘空间不足
- 网络连接问题

### 高内存占用

**症状**：应用占用内存持续增长

**解决方案**：

1. 检查是否有内存泄漏
2. 重启应用服务
3. 清理临时文件和缓存
4. 检查日志文件大小

### 高 CPU 占用

**症状**：CPU 使用率持续高于 80%

**解决方案**：

1. 识别占用 CPU 的进程
2. 检查是否有死循环或无限递归
3. 优化算法或查询
4. 增加系统资源

## 日志分析

### 日志位置

所有日志文件存储在 `log/` 目录：

```
log/
├── app_YYYY-MM-DD.log          # 应用日志
├── error_YYYY-MM-DD.log        # 错误日志
├── performance_YYYY-MM-DD.log  # 性能日志
└── access_YYYY-MM-DD.log       # 访问日志
```

### 查看日志

**实时查看**：
```bash
tail -f log/app_*.log
```

**搜索特定错误**：
```bash
grep "ERROR" log/app_*.log
grep "Exception" log/error_*.log
```

**按时间范围查看**：
```bash
# 查看最近 100 行
tail -100 log/app_*.log

# 查看最近 1 小时的日志
find log/ -name "*.log" -mmin -60 -exec cat {} \;
```

### 日志级别

- **DEBUG** - 详细的调试信息
- **INFO** - 一般信息
- **WARN** - 警告信息
- **ERROR** - 错误信息
- **FATAL** - 致命错误

### 常见日志模式

**数据库连接错误**：
```
ERROR: Failed to connect to database
Connection refused at localhost:5432
```

**认证失败**：
```
WARN: Authentication failed for user: [username]
Invalid credentials provided
```

**API 超时**：
```
ERROR: Request timeout after 30000ms
Endpoint: /api/v1/resource
```

## 获取支持

### 收集诊断信息

遇到问题时，请收集以下信息以便快速解决：

1. **系统信息**
   ```bash
   uname -a
   node --version
   npm --version
   ```

2. **应用版本**
   ```bash
   cat package.json | grep version
   ```

3. **错误日志**
   ```bash
   # 收集最近的错误日志
   tail -200 log/error_*.log > error_report.log
   ```

4. **性能指标**
   - 内存使用情况
   - CPU 使用情况
   - 磁盘空间
   - 网络连接状态

### 提交问题报告

提交问题时，请包含：

1. **问题描述** - 清晰描述遇到的问题
2. **重现步骤** - 详细的重现步骤
3. **预期行为** - 应该发生什么
4. **实际行为** - 实际发生了什么
5. **环境信息** - 系统、版本、配置
6. **日志和错误** - 相关的日志输出
7. **截图或视频** - 如果适用

### 联系方式

- **文档**: 查看 `docs/` 目录
- **问题追踪**: 提交 GitHub Issue
- **讨论**: 使用项目讨论区
- **邮件**: 联系项目维护者

## 常见错误代码

| 代码 | 含义 | 解决方案 |
|------|------|---------|
| 400 | 请求错误 | 检查请求参数 |
| 401 | 未授权 | 检查认证凭据 |
| 403 | 禁止访问 | 检查权限设置 |
| 404 | 未找到 | 检查资源是否存在 |
| 500 | 服务器错误 | 查看服务器日志 |
| 503 | 服务不可用 | 检查服务状态 |

## 快速参考

### 重启服务

```bash
# 停止服务
npm run stop

# 启动服务
npm run start

# 重启服务
npm run restart
```

### 清理缓存

```bash
# 清理 npm 缓存
npm cache clean --force

# 清理构建文件
npm run clean

# 清理日志
rm -f log/*.log
```

### 检查依赖

```bash
# 检查依赖是否安装
npm ls

# 更新依赖
npm update

# 审计依赖安全性
npm audit
```

## 更多资源

- [常见问题详解](./troubleshooting/common-issues.md)
- [调试技巧和工具](./troubleshooting/debugging.md)
- [性能优化指南](./performance/)
- [API 文档](./README.md)
