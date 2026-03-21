# OpenClaw

企业级开源协作平台。

## 📚 文档

完整的文档可在 [OpenClaw 文档网站](docs/index.md) 查看。

使用 MkDocs 构建文档网站：

```bash
# 安装依赖
pip install mkdocs mkdocs-material pymdown-extensions

# 本地预览
mkdocs serve

# 构建静态网站
mkdocs build
```

## 项目结构

- `local-app/` - 本地桌面应用（Rust + Tauri）
- `frontend/` - Web 前端（React + Vite + TypeScript）
- `admin-backend/` - 企业后台（Node.js + Express + TypeScript）
- `docs/` - 文档和 MkDocs 配置
- `tests/` - 测试
- `mkdocs.yml` - MkDocs 配置文件

## 快速开始

### 本地应用
```bash
cd local-app
cargo build --release
```

### 前端
```bash
cd frontend
npm install
npm run dev
```

### 后台
```bash
cd admin-backend
npm install
npm run dev
```

## 主要特性

- ✅ 跨平台支持（Windows、macOS、Linux）
- ✅ 实时协作功能
- ✅ 企业级安全和权限管理
- ✅ 高性能优化
- ✅ 完全开源

## 系统要求

- Rust 1.70+
- Node.js 18+
- Python 3.8+（用于文档构建）

## 许可证

MIT
