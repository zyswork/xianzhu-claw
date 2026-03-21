# 常见问题和解决方案

本文档列出 OpenClaw 系统中的常见问题及其解决方案。

## 安装和启动问题

### 问题：npm install 失败

**错误信息**：
```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

**原因**：
- Node.js 版本不兼容
- 依赖版本冲突
- npm 缓存损坏

**解决方案**：

1. **检查 Node.js 版本**
   ```bash
   node --version
   # 需要 Node.js 16.x 或更高版本
   ```

2. **清理 npm 缓存**
   ```bash
   npm cache clean --force
   ```

3. **删除 node_modules 和 package-lock.json**
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

4. **使用 --legacy-peer-deps 标志**
   ```bash
   npm install --legacy-peer-deps
   ```

### 问题：应用启动失败

**错误信息**：
```
Error: listen EADDRINUSE :::3000
```

**原因**：
- 端口已被占用
- 之前的进程未正确关闭

**解决方案**：

1. **查找占用端口的进程**
   ```bash
   lsof -i :3000
   ```

2. **杀死进程**
   ```bash
   kill -9 <PID>
   ```

3. **使用不同的端口**
   ```bash
   PORT=3001 npm start
   ```

### 问题：环境变量未加载

**症状**：
- 应用无法连接到数据库
- API 密钥未识别
- 配置值为 undefined

**解决方案**：

1. **检查 .env 文件**
   ```bash
   ls -la .env
   cat .env
   ```

2. **验证环境变量**
   ```bash
   echo $DATABASE_URL
   echo $API_KEY
   ```

3. **重新加载环境**
   ```bash
   source .env
   npm start
   ```

4. **检查 .env 文件格式**
   ```
   # 正确格式
   DATABASE_URL=postgresql://user:pass@localhost/db
   API_KEY=your-api-key-here

   # 避免空格
   # 错误：DATABASE_URL = postgresql://...
   ```

## 数据库问题

### 问题：数据库连接失败

**错误信息**：
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**原因**：
- 数据库服务未运行
- 连接字符串错误
- 防火墙阻止连接

**解决方案**：

1. **检查数据库服务状态**
   ```bash
   # PostgreSQL
   pg_isready -h localhost -p 5432

   # MySQL
   mysqladmin -u root ping
   ```

2. **启动数据库服务**
   ```bash
   # macOS
   brew services start postgresql

   # Linux
   sudo systemctl start postgresql
   ```

3. **验证连接字符串**
   ```bash
   # 检查 .env 中的 DATABASE_URL
   cat .env | grep DATABASE_URL
   ```

4. **测试连接**
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```

### 问题：数据库迁移失败

**错误信息**：
```
Error: Migration failed: relation "users" already exists
```

**原因**：
- 迁移已部分执行
- 数据库状态不一致

**解决方案**：

1. **检查迁移状态**
   ```bash
   npm run migrate:status
   ```

2. **回滚迁移**
   ```bash
   npm run migrate:rollback
   ```

3. **重新运行迁移**
   ```bash
   npm run migrate:up
   ```

4. **手动检查数据库**
   ```bash
   psql $DATABASE_URL -c "\dt"  # 列出所有表
   ```

### 问题：查询性能缓慢

**症状**：
- 数据库查询耗时长
- 应用响应缓慢

**解决方案**：

1. **分析查询性能**
   ```sql
   EXPLAIN ANALYZE SELECT * FROM users WHERE id = 1;
   ```

2. **添加索引**
   ```sql
   CREATE INDEX idx_users_id ON users(id);
   ```

3. **检查查询日志**
   ```bash
   # 启用慢查询日志
   # 在 PostgreSQL 配置中设置 log_min_duration_statement
   ```

4. **优化查询**
   - 避免 SELECT *
   - 使用 JOIN 而不是多个查询
   - 添加适当的 WHERE 条件

## 认证和授权问题

### 问题：登录失败

**错误信息**：
```
Error: Invalid credentials
```

**原因**：
- 用户名或密码错误
- 用户账户被禁用
- 密码哈希不匹配

**解决方案**：

1. **验证用户存在**
   ```bash
   psql $DATABASE_URL -c "SELECT * FROM users WHERE email = 'user@example.com';"
   ```

2. **重置密码**
   ```bash
   npm run reset-password -- user@example.com
   ```

3. **检查用户状态**
   ```bash
   psql $DATABASE_URL -c "SELECT id, email, is_active FROM users WHERE email = 'user@example.com';"
   ```

### 问题：令牌过期

**错误信息**：
```
Error: Token expired
```

**原因**：
- JWT 令牌已过期
- 刷新令牌无效

**解决方案**：

1. **重新登录**
   - 清除浏览器 Cookie
   - 重新登录获取新令牌

2. **检查令牌过期时间**
   ```bash
   # 在应用日志中查看
   grep "Token expired" log/app_*.log
   ```

3. **调整令牌过期时间**
   - 编辑 `.env` 中的 `JWT_EXPIRY`
   - 重启应用

### 问题：权限被拒绝

**错误信息**：
```
Error: Access denied - insufficient permissions
```

**原因**：
- 用户角色不足
- 资源权限配置错误

**解决方案**：

1. **检查用户角色**
   ```bash
   psql $DATABASE_URL -c "SELECT * FROM user_roles WHERE user_id = 1;"
   ```

2. **分配正确的角色**
   ```bash
   npm run assign-role -- user@example.com admin
   ```

3. **验证资源权限**
   ```bash
   psql $DATABASE_URL -c "SELECT * FROM resource_permissions WHERE resource_id = 1;"
   ```

## API 问题

### 问题：API 返回 500 错误

**错误信息**：
```
Error: Internal Server Error
```

**原因**：
- 未捕获的异常
- 数据库错误
- 外部服务故障

**解决方案**：

1. **查看服务器日志**
   ```bash
   tail -100 log/error_*.log
   ```

2. **查找堆栈跟踪**
   ```bash
   grep -A 10 "Error:" log/error_*.log
   ```

3. **检查依赖服务**
   - 数据库连接
   - 外部 API
   - 缓存服务

### 问题：API 超时

**错误信息**：
```
Error: Request timeout after 30000ms
```

**原因**：
- 查询耗时过长
- 外部服务响应慢
- 网络延迟

**解决方案**：

1. **增加超时时间**
   ```bash
   # 在 .env 中设置
   REQUEST_TIMEOUT=60000
   ```

2. **优化查询**
   - 添加数据库索引
   - 减少数据量
   - 使用缓存

3. **检查网络**
   ```bash
   ping api.example.com
   curl -w "@curl-format.txt" -o /dev/null -s https://api.example.com
   ```

### 问题：CORS 错误

**错误信息**：
```
Error: Access to XMLHttpRequest blocked by CORS policy
```

**原因**：
- 跨域请求被阻止
- CORS 配置不正确

**解决方案**：

1. **检查 CORS 配置**
   ```bash
   grep -r "CORS" config/
   ```

2. **添加允许的源**
   ```javascript
   // 在服务器配置中
   app.use(cors({
     origin: ['http://localhost:3000', 'https://example.com'],
     credentials: true
   }));
   ```

3. **验证请求头**
   ```bash
   curl -H "Origin: http://localhost:3000" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        -X OPTIONS http://localhost:3001/api/resource
   ```

## 前端问题

### 问题：页面加载缓慢

**症状**：
- 首屏加载时间长
- 白屏时间长

**解决方案**：

1. **检查网络**
   - 打开浏览器开发者工具
   - 查看 Network 标签
   - 识别慢加载的资源

2. **优化资源**
   - 压缩 JavaScript 和 CSS
   - 使用代码分割
   - 启用 gzip 压缩

3. **检查应用性能**
   ```bash
   npm run build
   npm run analyze  # 分析包大小
   ```

### 问题：样式未应用

**症状**：
- CSS 样式不显示
- 页面布局混乱

**解决方案**：

1. **检查 CSS 文件**
   ```bash
   # 验证 CSS 文件是否存在
   ls -la src/styles/
   ```

2. **清理缓存**
   ```bash
   # 清理浏览器缓存
   # 或使用硬刷新：Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)
   ```

3. **检查导入**
   ```javascript
   // 确保 CSS 正确导入
   import './styles/main.css';
   ```

### 问题：组件未渲染

**症状**：
- 组件不显示
- 控制台有错误

**解决方案**：

1. **检查浏览器控制台**
   - 打开开发者工具
   - 查看 Console 标签
   - 查找错误信息

2. **检查组件代码**
   ```javascript
   // 确保组件正确导出
   export default MyComponent;
   ```

3. **验证路由**
   ```javascript
   // 检查路由配置
   <Route path="/page" component={MyComponent} />
   ```

## 构建和部署问题

### 问题：构建失败

**错误信息**：
```
Error: Build failed with 1 error
```

**原因**：
- TypeScript 类型错误
- 语法错误
- 缺少依赖

**解决方案**：

1. **检查构建日志**
   ```bash
   npm run build 2>&1 | tee build.log
   ```

2. **修复 TypeScript 错误**
   ```bash
   npm run type-check
   ```

3. **验证依赖**
   ```bash
   npm ls
   npm install
   ```

### 问题：部署失败

**症状**：
- 部署过程中断
- 应用无法启动

**解决方案**：

1. **检查部署日志**
   ```bash
   # 查看部署服务器日志
   tail -f /var/log/app.log
   ```

2. **验证环境变量**
   ```bash
   # 在部署服务器上
   env | grep -E "DATABASE|API|NODE"
   ```

3. **检查磁盘空间**
   ```bash
   df -h
   ```

## 性能问题

### 问题：内存泄漏

**症状**：
- 内存使用持续增长
- 应用变得越来越慢

**解决方案**：

1. **监控内存使用**
   ```bash
   node --inspect app.js
   # 在 Chrome DevTools 中打开 chrome://inspect
   ```

2. **查找泄漏**
   - 使用 Chrome DevTools Memory 标签
   - 记录堆快照
   - 比较快照找出泄漏

3. **修复泄漏**
   - 移除事件监听器
   - 清理定时器
   - 释放大对象引用

### 问题：CPU 占用高

**症状**：
- CPU 使用率持续高于 80%
- 系统响应缓慢

**解决方案**：

1. **识别热点**
   ```bash
   node --prof app.js
   node --prof-process isolate-*.log > profile.txt
   ```

2. **优化代码**
   - 避免死循环
   - 优化算法
   - 使用缓存

3. **增加资源**
   - 增加 CPU 核心
   - 使用负载均衡

## 网络问题

### 问题：连接超时

**错误信息**：
```
Error: Connection timeout
```

**原因**：
- 网络不稳定
- 防火墙阻止
- DNS 解析失败

**解决方案**：

1. **检查网络连接**
   ```bash
   ping 8.8.8.8
   ```

2. **检查 DNS**
   ```bash
   nslookup example.com
   ```

3. **检查防火墙**
   ```bash
   # macOS
   sudo pfctl -s all

   # Linux
   sudo iptables -L
   ```

### 问题：SSL 证书错误

**错误信息**：
```
Error: SSL certificate problem
```

**原因**：
- 证书过期
- 证书不受信任
- 域名不匹配

**解决方案**：

1. **检查证书**
   ```bash
   openssl s_client -connect example.com:443
   ```

2. **更新证书**
   - 从证书颁发机构获取新证书
   - 安装到服务器

3. **验证域名**
   - 确保证书与域名匹配

## 获取更多帮助

如果问题未在此列出，请：

1. 查看 [调试技巧](./debugging.md)
2. 检查应用日志
3. 搜索项目 Issue
4. 提交新 Issue 并包含诊断信息
