# 贡献指南

感谢你对 OpenClaw 项目的兴趣！本指南将帮助你了解如何为项目做出贡献。

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发流程](#开发流程)
- [提交 PR](#提交-pr)
- [代码审查](#代码审查)
- [常见问题](#常见问题)

## 行为准则

我们致力于为所有贡献者提供一个包容、尊重的环境。请遵守以下原则：

- 尊重他人的观点和经验
- 接受建设性的批评
- 专注于对项目最有利的讨论
- 对其他社区成员表示同情

任何违反这些原则的行为将不被容忍。

## 如何贡献

### 报告 Bug

如果你发现了 bug，请创建一个 Issue：

1. 检查是否已有相同的 Issue
2. 提供清晰的标题和描述
3. 包含复现步骤
4. 提供环境信息（OS、Node 版本等）
5. 附加错误日志或截图

**Issue 模板：**
```
## 描述
简要描述 bug

## 复现步骤
1. ...
2. ...
3. ...

## 预期行为
应该发生什么

## 实际行为
实际发生了什么

## 环境
- OS:
- Node 版本:
- npm 版本:
```

### 提出功能建议

如果你有功能建议，请创建一个 Issue：

1. 使用清晰的标题
2. 提供详细的描述
3. 解释为什么这个功能有用
4. 列出可能的实现方式

**功能建议模板：**
```
## 功能描述
描述你想要的功能

## 使用场景
这个功能解决什么问题

## 建议的实现
如何实现这个功能

## 替代方案
是否有其他方式实现
```

### 改进文档

文档改进总是受欢迎的：

1. 修复拼写或语法错误
2. 澄清不清楚的部分
3. 添加缺失的信息
4. 改进代码示例

## 开发流程

### 1. Fork 仓库

```bash
# 在 GitHub 上 fork 项目
# 然后克隆你的 fork
git clone https://github.com/your-username/my-openclaw.git
cd my-openclaw
```

### 2. 创建功能分支

```bash
# 更新主分支
git checkout main
git pull upstream main

# 创建功能分支
git checkout -b feature/your-feature-name
```

**分支命名规范：**
- `feature/` - 新功能
- `fix/` - Bug 修复
- `docs/` - 文档更新
- `refactor/` - 代码重构
- `test/` - 测试相关
- `perf/` - 性能优化

### 3. 开发和测试

```bash
# 安装依赖
npm install --workspaces

# 启动开发服务器
cd admin-backend && npm run dev  # 终端 1
cd frontend && npm run dev       # 终端 2

# 运行测试
npm test

# 检查代码质量
npm run lint
```

### 4. 提交更改

```bash
# 查看更改
git status

# 暂存更改
git add .

# 提交更改
git commit -m "type: description"
```

**提交消息规范：**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型：**
- `feat` - 新功能
- `fix` - Bug 修复
- `docs` - 文档更新
- `style` - 代码风格（不影响功能）
- `refactor` - 代码重构
- `perf` - 性能优化
- `test` - 测试相关
- `chore` - 构建、依赖等

**示例：**
```
feat(auth): 添加 JWT 令牌刷新功能

- 实现令牌刷新端点
- 添加刷新令牌存储
- 更新认证中间件

Closes #123
```

### 5. 推送更改

```bash
# 推送到你的 fork
git push origin feature/your-feature-name
```

## 提交 PR

### PR 检查清单

在提交 PR 前，请确保：

- [ ] 代码遵循项目的代码风格
- [ ] 所有测试通过
- [ ] 添加了新功能的测试
- [ ] 更新了相关文档
- [ ] 提交消息清晰明确
- [ ] 没有未解决的冲突

### PR 模板

```markdown
## 描述
简要描述你的更改

## 相关 Issue
Closes #123

## 更改类型
- [ ] Bug 修复
- [ ] 新功能
- [ ] 破坏性变更
- [ ] 文档更新

## 测试
描述你如何测试这些更改

## 截图（如适用）
添加截图或 GIF

## 检查清单
- [ ] 代码遵循风格指南
- [ ] 自我审查了代码
- [ ] 添加了必要的注释
- [ ] 更新了文档
- [ ] 没有新的警告
- [ ] 添加了测试
- [ ] 测试通过
```

## 代码审查

### 审查流程

1. 至少一名维护者审查 PR
2. 提出改进建议
3. 作者进行修改
4. 重新审查
5. 合并到主分支

### 审查标准

- 代码质量和可读性
- 测试覆盖率
- 文档完整性
- 性能影响
- 安全性考虑
- 向后兼容性

### 处理审查反馈

- 认真考虑所有反馈
- 提出问题或讨论
- 进行必要的修改
- 标记为已解决

## 常见问题

### Q: 如何同步我的 fork��

A:
```bash
# 添加上游仓库
git remote add upstream https://github.com/original/my-openclaw.git

# 获取上游更新
git fetch upstream

# 重新基于上游主分支
git rebase upstream/main

# 推送到你的 fork
git push origin main --force
```

### Q: 如何处理合并冲突？

A:
```bash
# 查看冲突
git status

# 手动解决冲突
# 编辑冲突文件，移除冲突标记

# 标记为已解决
git add .

# 继续合并
git rebase --continue
```

### Q: 我的 PR 被拒绝了怎么办？

A: 这很正常。请：
1. 理解拒绝的原因
2. 讨论改进方案
3. 进行必要的修改
4. 重新提交

### Q: 如何运行特定的测试？

A:
```bash
# 后台
cd admin-backend
npm test -- --grep "test-name"

# 前端
cd frontend
npm test -- --grep "test-name"
```

### Q: 如何调试测试？

A:
```bash
# 使用 Node 调试器
node --inspect-brk ./node_modules/.bin/vitest run

# 或使用 VS Code 调试
# 在 .vscode/launch.json 中配置调试器
```

### Q: 代码风格检查失败怎么办？

A:
```bash
# 自动修复
npm run lint -- --fix

# 或手动修复
# 查看 .eslintrc 配置
```

## 开发工具推荐

### VS Code 扩展

- ESLint
- Prettier
- TypeScript Vue Plugin
- REST Client
- SQLite

### 命令行工具

- `git` - 版本控制
- `node` - JavaScript 运行时
- `npm` - 包管理器
- `cargo` - Rust 包管理器

## 资源

- [项目 README](../README.md)
- [开发者指南](../DEVELOPER_GUIDE.md)
- [架构设计](./architecture.md)
- [代码风格](./code-style.md)

## 获取帮助

- 查看现有 Issues 和 Discussions
- 提出新的 Issue
- 联系维护者
- 查看项目文档

## 许可证

通过贡献代码，你同意你的贡献将在 MIT 许可证下发布。

---

感谢你的贡献！🎉

最后更新：2026-03-15
