# OpenClaw 文档

欢迎来到 OpenClaw 文档中心。OpenClaw 是一个企业级开源协作平台，提供本地桌面应用、Web 前端和企业后台系统。

## 快速导航

### 🚀 快速开始
- [安装指南](guides/installation.md) - 安装和配置 OpenClaw
- [基础操作](guides/basic-operations.md) - 学习基本功能
- [入门教程](guides/getting-started.md) - 第一次使用指南

### 📖 用户指南
- [完整用户指南](USER_GUIDE.md) - 详细的功能说明
- [故障排除](TROUBLESHOOTING.md) - 常见问题解决方案

### ⚡ 性能优化
- [启动基准](performance/startup-baseline.md) - 应用启动性能数据
- [内存优化](performance/memory-optimization.md) - 内存使用优化指南
- [包体积优化](performance/bundle-optimization.md) - 减小应用体积
- [运行时优化](performance/runtime-optimization.md) - 运行时性能优化

### 📊 审查报告
- [执行摘要](docs/REVIEW_EXECUTIVE_SUMMARY.md) - 项目审查概览
- [最终审查报告](docs/FINAL_REVIEW_REPORT.md) - 详细审查结果
- [Tauri 集成审查](docs/TAURI_FRONTEND_INTEGRATION_REVIEW.md) - 前端集成分析

## 项目结构

```
my-openclaw/
├── local-app/          # 本地桌面应用（Rust + Tauri）
├── frontend/           # Web 前端（React + Vite + TypeScript）
├── admin-backend/      # 企业后台（Node.js + Express + TypeScript）
├── docs/               # 文档
├── tests/              # 测试
└── mkdocs.yml          # MkDocs 配置
```

## 主要特性

- **跨平台支持** - 支持 Windows、macOS 和 Linux
- **实时协作** - 多用户实时协作功能
- **企业级安全** - 完整的权限管理和数据加密
- **高性能** - 优化的启动速度和内存占用
- **开源** - 完全开源，欢迎贡献

## 系统要求

### 本地应用
- Rust 1.70+
- Node.js 18+
- npm 或 yarn

### Web 前端
- Node.js 18+
- npm 或 yarn

### 企业后台
- Node.js 18+
- npm 或 yarn
- PostgreSQL 12+（可选）

## 快速开始

### 安装本地应用
```bash
cd local-app
cargo build --release
```

### 启动 Web 前端
```bash
cd frontend
npm install
npm run dev
```

### 启动企业后台
```bash
cd admin-backend
npm install
npm run dev
```

## 获取帮助

- 📧 [提交问题](https://github.com/openclaw/openclaw/issues)
- 💬 [讨论区](https://github.com/openclaw/openclaw/discussions)
- 📚 [完整文档](guides/getting-started.md)

## 许可证

MIT License - 详见项目根目录的 LICENSE 文件

## 贡献指南

我们欢迎所有形式的贡献！请查看 [贡献指南](CONTRIBUTING.md) 了解如何参与项目。

---

**最后更新**: 2024 年 3 月 15 日
