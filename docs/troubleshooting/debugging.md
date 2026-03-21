# 调试技巧和工具

本文档介绍 OpenClaw 系统的调试技巧和工具使用方法。

## 调试工具

### Node.js 调试器

**启动调试模式**：
```bash
node --inspect app.js
```

**使用 Chrome DevTools**：
1. 打开 Chrome 浏览器
2. 访问 `chrome://inspect`
3. 点击 "inspect" 按钮
4. 在 DevTools 中调试

**使用 VS Code 调试**：

在 `.vscode/launch.json` 中配置：
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Launch Program",
      "program": "${workspaceFolder}/app.js",
      "restart": true,
      "console": "integratedTerminal"
    }
  ]
}
```

然后按 F5 启动调试。

### 浏览器开发者工具

**打开开发者工具**：
- Windows/Linux: `F12` 或 `Ctrl+Shift+I`
- macOS: `Cmd+Option+I`

**主要标签**：

1. **Console** - 查看日志和错误
   ```javascript
   console.log('调试信息');
   console.error('错误信息');
   console.warn('警告信息');
   ```

2. **Network** - 监控网络请求
   - 查看请求/响应
   - 检查状态码
   - 分析加载时间

3. **Performance** - 性能分析
   - 记录性能指标
   - 识别瓶颈
   - 优化建议

4. **Application** - 查看存储
   - LocalStorage
   - SessionStorage
   - Cookies
   - IndexedDB

### 日志库

**使用 Winston 日志库**：

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'log/app.log' })
  ]
});

// 使用日志
logger.info('应用启动');
logger.error('发生错误', { error: err });
logger.warn('警告信息');
```

**日志级别**：
- `error` - 错误
- `warn` - 警告
- `info` - 信息
- `http` - HTTP 请求
- `debug` - 调试信息

## 调试技巧

### 1. 添加调试语句

**使用 console.log**：
```javascript
function processData(data) {
  console.log('输入数据:', data);
  const result = data.map(item => item * 2);
  console.log('处理结果:', result);
  return result;
}
```

**使用条件日志**：
```javascript
const DEBUG = process.env.DEBUG === 'true';

function debugLog(...args) {
  if (DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

debugLog('这是调试信息');
```

### 2. 使用断点

**在 VS Code 中设置断点**：
1. 点击代码行号左侧
2. 红点表示断点已设置
3. 启动调试模式
4. 代码执行到断点时暂停

**条件断点**：
```javascript
// 右键点击断点，添加条件
// 例如：i > 5
for (let i = 0; i < 10; i++) {
  console.log(i);  // 在 i > 5 时暂停
}
```

### 3. 调试异步代码

**使用 async/await**：
```javascript
async function fetchData() {
  try {
    const response = await fetch('/api/data');
    const data = await response.json();
    console.log('数据:', data);
    return data;
  } catch (error) {
    console.error('获取数据失败:', error);
  }
}
```

**使用 Promise.then()**：
```javascript
fetch('/api/data')
  .then(response => {
    console.log('响应状态:', response.status);
    return response.json();
  })
  .then(data => {
    console.log('数据:', data);
  })
  .catch(error => {
    console.error('错误:', error);
  });
```

### 4. 调试 React 组件

**使用 React DevTools**：
1. 安装 React DevTools 浏览器扩展
2. 打开开发者工具
3. 切换到 "Components" 标签
4. 检查组件树和 props

**添加调试日志**：
```javascript
function MyComponent({ data }) {
  console.log('组件挂载，props:', data);

  useEffect(() => {
    console.log('数据变化:', data);
  }, [data]);

  return <div>{data}</div>;
}
```

**使用 debugger 语句**：
```javascript
function MyComponent() {
  debugger;  // 代码执行到此处时暂停
  return <div>内容</div>;
}
```

### 5. 调试网络请求

**使用 curl 测试 API**：
```bash
# GET 请求
curl http://localhost:3000/api/users

# POST 请求
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com"}'

# 添加认证头
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/protected

# 显示响应头
curl -i http://localhost:3000/api/users

# 显示详细信息
curl -v http://localhost:3000/api/users
```

**使用 Postman**：
1. 下载并安装 Postman
2. 创建请求
3. 设置 URL、方法、头部、body
4. 发送请求并查看响应

**检查网络流量**：
```bash
# 使用 tcpdump 捕获网络包
sudo tcpdump -i lo0 -n 'tcp port 3000'

# 使用 Wireshark 图形化分析
wireshark
```

### 6. 调试数据库

**连接到数据库**：
```bash
# PostgreSQL
psql $DATABASE_URL

# MySQL
mysql -u root -p database_name
```

**常用 SQL 调试命令**：
```sql
-- 查看表结构
\d users;

-- 查看所有表
\dt;

-- 执行查询并显示执行计划
EXPLAIN ANALYZE SELECT * FROM users WHERE id = 1;

-- 查看慢查询日志
SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;

-- 查看活跃连接
SELECT * FROM pg_stat_activity;
```

**使用 DBeaver**：
1. 下载并安装 DBeaver
2. 创建数据库连接
3. 浏览表和数据
4. 执行 SQL 查询
5. 分析查询性能

## 常见调试场景

### 场景 1：变量值不符合预期

**问题**：变量的值与预期不符

**调试步骤**：
```javascript
function calculateTotal(items) {
  console.log('输入 items:', items);

  let total = 0;
  for (let item of items) {
    console.log('处理项目:', item);
    total += item.price;
    console.log('当前总计:', total);
  }

  console.log('最终总计:', total);
  return total;
}
```

### 场景 2：函数未被调用

**问题**：预期的函数没有执行

**调试步骤**：
```javascript
// 1. 检查函数是否存在
console.log('函数类型:', typeof myFunction);

// 2. 检查函数是否被正确调用
console.log('调用函数');
myFunction();
console.log('函数执行完成');

// 3. 检查条件是否满足
if (condition) {
  console.log('条件满足，调用函数');
  myFunction();
} else {
  console.log('条件不满足');
}
```

### 场景 3：异步操作未完成

**问题**：异步操作的结果未按预期返回

**调试步骤**：
```javascript
async function fetchAndProcess() {
  console.log('开始获取数据');

  try {
    const data = await fetchData();
    console.log('数据获取成功:', data);

    const result = await processData(data);
    console.log('数据处理成功:', result);

    return result;
  } catch (error) {
    console.error('操作失败:', error);
    throw error;
  }
}
```

### 场景 4：内存泄漏

**问题**：应用内存占用持续增长

**调试步骤**：

1. **启用堆快照**：
   ```bash
   node --inspect app.js
   ```

2. **在 Chrome DevTools 中**：
   - 打开 Memory 标签
   - 记录堆快照
   - 执行操作
   - 再次记录堆快照
   - 比较两个快照

3. **查找泄漏**：
   - 查看增长的对象
   - 检查是否有未释放的引用
   - 修复代码

### 场景 5：事件监听器问题

**问题**：事件监听器未触发或重复触发

**调试步骤**：
```javascript
// 检查监听器是否已注册
element.addEventListener('click', () => {
  console.log('点击事件触发');
});

// 检查事件冒泡
element.addEventListener('click', (event) => {
  console.log('事件目标:', event.target);
  console.log('事件阶段:', event.eventPhase);
  event.stopPropagation();  // 停止冒泡
});

// 移除监听器
element.removeEventListener('click', handler);
```

## 性能调试

### 测量执行时间

**使用 console.time**：
```javascript
console.time('操作耗时');

// 执行操作
for (let i = 0; i < 1000000; i++) {
  // 某些操作
}

console.timeEnd('操作耗时');
// 输出：操作耗时: 123.45ms
```

**使用 performance API**：
```javascript
const start = performance.now();

// 执行操作
processData();

const end = performance.now();
console.log(`执行时间: ${end - start}ms`);
```

### 分析函数性能

```javascript
function profileFunction(fn, iterations = 1000) {
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  const end = performance.now();
  const avgTime = (end - start) / iterations;

  console.log(`平均执行时间: ${avgTime.toFixed(4)}ms`);
}

profileFunction(() => {
  // 要测试的函数
  Math.sqrt(12345);
}, 10000);
```

### 内存使用分析

```javascript
// 获取内存使用情况
const memUsage = process.memoryUsage();
console.log('内存使用情况:');
console.log(`  RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
console.log(`  堆总大小: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
console.log(`  堆使用: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
console.log(`  外部: ${Math.round(memUsage.external / 1024 / 1024)}MB`);
```

## 调试最佳实践

1. **使用有意义的日志消息**
   - 包含上下文信息
   - 使用清晰的标签
   - 避免过度日志

2. **分离调试和生产代码**
   - 使用环境变量控制日志级别
   - 不要在生产环境中留下调试代码
   - 使用条件编译

3. **记录关键信息**
   - 函数入口和出口
   - 重要变量值
   - 错误和异常
   - 性能指标

4. **使用结构化日志**
   - 使用 JSON 格式
   - 包含时间戳
   - 添加日志级别
   - 便于分析和搜索

5. **定期清理日志**
   - 删除过期日志
   - 压缩日志文件
   - 归档重要日志

## 调试工具总结

| 工具 | 用途 | 平台 |
|------|------|------|
| Chrome DevTools | 浏览器调试 | 浏览器 |
| VS Code Debugger | 代码调试 | VS Code |
| Node Inspector | Node.js 调试 | Node.js |
| React DevTools | React 调试 | 浏览器 |
| Redux DevTools | Redux 调试 | 浏览器 |
| Postman | API 测试 | 桌面/Web |
| DBeaver | 数据库调试 | 桌面 |
| Wireshark | 网络分析 | 桌面 |
| Winston | 日志记录 | Node.js |
| Sentry | 错误追踪 | 云服务 |

## 更多资源

- [Node.js 调试指南](https://nodejs.org/en/docs/guides/debugging-getting-started/)
- [Chrome DevTools 文档](https://developer.chrome.com/docs/devtools/)
- [VS Code 调试文档](https://code.visualstudio.com/docs/editor/debugging)
- [React 调试工具](https://react-devtools-tutorial.vercel.app/)
