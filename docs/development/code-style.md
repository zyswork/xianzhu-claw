# 代码风格指南

本指南定义了 OpenClaw 项目的代码风格和最佳实践。

## 目录

- [通用规范](#通用规范)
- [TypeScript 规范](#typescript-规范)
- [React 规范](#react-规范)
- [后台 API 规范](#后台-api-规范)
- [数据库规范](#数据库规范)
- [测试规范](#测试规范)
- [文档规范](#文档规范)
- [工具配置](#工具配置)

## 通用规范

### 文件和目录

- 使用小写字母和连字符命名文件：`user-service.ts`
- 目录名使用小写字母：`src/models/`
- 每个文件只导出一个主要的类或函数
- 相关的文件放在同一目录

### 命名规范

```typescript
// 常量：全大写，用下划线分隔
const MAX_RETRY_COUNT = 3;
const API_TIMEOUT = 5000;

// 变量和函数：驼峰式
const userName = "John";
function getUserById(id: string) {}

// 类和接口：帕斯卡式
class UserService {}
interface IUser {}

// 枚举：帕斯卡式
enum UserRole {
  Admin = "admin",
  User = "user",
}

// 私有属性：下划线前缀
class Service {
  private _cache: Map<string, any>;
}
```

### 注释规范

```typescript
// 单行注释
const count = 0; // 计数器

/**
 * 多行注释 - 函数/类文档
 *
 * @param id - 用户 ID
 * @returns 用户对象
 * @throws {Error} 用户不存在时抛出错误
 */
function getUser(id: string): User {
  // 实现
}

// TODO: 待实现的功能
// FIXME: 需要修复的问题
// NOTE: 重要说明
// HACK: 临时解决方案
```

### 代码格式

- 使用 2 个空格缩进
- 行长度不超过 100 个字符
- 使用分号结尾
- 使用单引号（字符串）
- 在操作符周围添加空格

```typescript
// 好
const result = a + b;
const message = 'Hello World';
if (condition) {
  doSomething();
}

// 不好
const result=a+b;
const message = "Hello World";
if(condition){doSomething();}
```

## TypeScript 规范

### 类型定义

```typescript
// 使用接口定义对象类型
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

// 使用类型别名定义联合类型
type UserRole = 'admin' | 'user' | 'guest';

// 避免使用 any
// 不好
function process(data: any) {}

// 好
function process(data: User) {}

// 使用泛型提高代码复用性
interface Response<T> {
  code: number;
  message: string;
  data: T;
}
```

### 类型检查

```typescript
// 使用严格的类型检查
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}

// 显式指定返回类型
function getUserName(id: string): string {
  return 'John';
}

// 避免类型断言，除非必要
// 不好
const user = data as User;

// 好
const user: User = data;
```

### 错误处理

```typescript
// 使用自定义错误类
class AppError extends Error {
  constructor(
    public code: string,
    public statusCode: number,
    message: string
  ) {
    super(message);
  }
}

// 使用 try-catch 处理异步错误
async function fetchUser(id: string): Promise<User> {
  try {
    const response = await api.get(`/users/${id}`);
    return response.data;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('FETCH_ERROR', 500, 'Failed to fetch user');
  }
}
```

## React 规范

### 组件结构

```typescript
// 函数式组件
interface UserCardProps {
  user: User;
  onDelete?: (id: string) => void;
}

export const UserCard: React.FC<UserCardProps> = ({ user, onDelete }) => {
  // Hooks
  const [isLoading, setIsLoading] = React.useState(false);

  // 事件处理
  const handleDelete = () => {
    onDelete?.(user.id);
  };

  // 渲染
  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <p>{user.email}</p>
      <button onClick={handleDelete}>删除</button>
    </div>
  );
};
```

### Hooks 使用

```typescript
// 自定义 Hook
function useUser(id: string) {
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const data = await api.getUser(id);
        setUser(data);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [id]);

  return { user, loading, error };
}

// 使用自定义 Hook
function UserProfile({ userId }: { userId: string }) {
  const { user, loading, error } = useUser(userId);

  if (loading) return <div>加载中...</div>;
  if (error) return <div>错误: {error.message}</div>;
  if (!user) return <div>用户不存在</div>;

  return <div>{user.name}</div>;
}
```

### 状态管理

```typescript
// 使用 Zustand 管理全局状态
import { create } from 'zustand';

interface AuthStore {
  user: User | null;
  token: string | null;
  login: (user: User, token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  login: (user, token) => set({ user, token }),
  logout: () => set({ user: null, token: null }),
}));

// 在组件中使用
function LoginPage() {
  const { login } = useAuthStore();

  const handleLogin = async (credentials) => {
    const { user, token } = await api.login(credentials);
    login(user, token);
  };

  return <form onSubmit={handleLogin}>...</form>;
}
```

### 样式

```typescript
// 使用 CSS 模块或 CSS-in-JS
// 避免内联样式
// 不好
<div style={{ color: 'red', fontSize: '16px' }}>Text</div>

// 好
<div className="error-text">Text</div>

// CSS 模块
import styles from './UserCard.module.css';

export const UserCard = () => (
  <div className={styles.card}>
    <h3 className={styles.title}>用户卡片</h3>
  </div>
);
```

## 后台 API 规范

### 路由定义

```typescript
// 使用 Express Router
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';

const router = Router();

// GET 请求
router.get('/users/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: '服务器错误' });
  }
});

// POST 请求
router.post('/users', authenticate, validate('createUser'), async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (error) {
    res.status(400).json({ error: '创建失败' });
  }
});

export default router;
```

### 中间件

```typescript
// 认证中间件
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: '未授权' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    (req as any).user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: '令牌无效' });
  }
};

// 验证中间件
export const validate = (schema: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = validators[schema].validate(req.body);

    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    req.body = value;
    next();
  };
};
```

### 错误处理

```typescript
// 统一的错误响应格式
interface ErrorResponse {
  code: string;
  message: string;
  details?: any;
}

// 错误处理中间件
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(error);

  if (error instanceof ValidationError) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: error.message,
      details: error.details,
    });
  }

  if (error instanceof AuthError) {
    return res.status(401).json({
      code: 'AUTH_ERROR',
      message: error.message,
    });
  }

  res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
  });
});
```

## 数据库规范

### 模型定义

```typescript
// 定义数据模型
interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  enterpriseId: string;
  role: 'admin' | 'user';
  createdAt: Date;
  updatedAt: Date;
}

// 数据库操作
class UserModel {
  async findById(id: string): Promise<User | null> {
    const sql = 'SELECT * FROM users WHERE id = ?';
    const row = await db.get(sql, [id]);
    return row || null;
  }

  async create(data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const id = generateId();
    const now = new Date();
    const sql = `
      INSERT INTO users (id, username, email, passwordHash, enterpriseId, role, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.run(sql, [id, data.username, data.email, data.passwordHash, data.enterpriseId, data.role, now, now]);
    return { id, ...data, createdAt: now, updatedAt: now };
  }
}
```

### SQL 规范

```sql
-- 使用大写关键字
SELECT id, name, email FROM users WHERE id = ?;

-- 使用有意义的别名
SELECT u.id, u.name, e.name AS enterprise_name
FROM users u
JOIN enterprises e ON u.enterprise_id = e.id;

-- 避免 SELECT *
-- 不好
SELECT * FROM users;

-- 好
SELECT id, name, email FROM users;
```

## 测试规范

### 单元测试

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService();
  });

  it('应该创建用户', async () => {
    const user = await service.create({
      username: 'john',
      email: 'john@example.com',
    });

    expect(user).toBeDefined();
    expect(user.username).toBe('john');
  });

  it('应该抛出错误当用户已存在', async () => {
    await service.create({ username: 'john', email: 'john@example.com' });

    expect(() => service.create({ username: 'john', email: 'john2@example.com' }))
      .rejects.toThrow('用户已存在');
  });
});
```

### 集成测试

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app';

describe('User API', () => {
  it('应该创建用户', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({
        username: 'john',
        email: 'john@example.com',
        password: 'password123',
      });

    expect(response.status).toBe(201);
    expect(response.body.username).toBe('john');
  });
});
```

## 文档规范

### JSDoc 注释

```typescript
/**
 * 获取用户信息
 *
 * @param id - 用户 ID
 * @returns 用户对象
 * @throws {Error} 用户不存在时抛出错误
 *
 * @example
 * const user = await getUser('123');
 * console.log(user.name);
 */
async function getUser(id: string): Promise<User> {
  // 实现
}
```

### README 文档

- 清晰的项目描述
- 安装和使用说明
- API 文档
- 贡献指南
- 许可证信息

## 工具配置

### ESLint 配置

```json
{
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "semi": ["error", "always"],
    "quotes": ["error", "single"],
    "indent": ["error", 2],
    "no-console": ["warn"],
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error"]
  }
}
```

### Prettier 配置

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

---

最后更新：2026-03-15
