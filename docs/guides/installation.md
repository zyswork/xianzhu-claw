# 安装指南

## 下载应用

1. 访问 [OpenClaw 官方网站](https://openclaw.example.com)
2. 点击"下载"按钮
3. 选择你的操作系统版本

## Windows 安装

1. 下载 `openclaw-setup.exe`
2. 双击运行安装程序
3. 按照安装向导完成安装
4. 安装完成后，应用会自动启动

## macOS 安装

1. 下载 `openclaw.dmg`
2. 双击打开 DMG 文件
3. 将 OpenClaw 拖到应用程序文件夹
4. 从应用程序文件夹启动 OpenClaw

## Linux 安装

### Ubuntu/Debian

```bash
# 下载 .deb 文件
wget https://releases.openclaw.example.com/openclaw-latest.deb

# 安装
sudo dpkg -i openclaw-latest.deb

# 启动
openclaw
```

### CentOS/RHEL

```bash
# 下载 .rpm 文件
wget https://releases.openclaw.example.com/openclaw-latest.rpm

# 安装
sudo rpm -i openclaw-latest.rpm

# 启动
openclaw
```

## 验证安装

安装完成后，应用应该自动启动。如果没有启动：

1. 打开应用菜单
2. 搜索 "OpenClaw"
3. 点击启动

## 卸载

### Windows
- 打开"控制面板" → "程序和功能"
- 找到 OpenClaw
- 点击"卸载"

### macOS
- 打开 Finder
- 进入应用程序文件夹
- 将 OpenClaw 拖到垃圾桶

### Linux
```bash
# Ubuntu/Debian
sudo apt-get remove openclaw

# CentOS/RHEL
sudo rpm -e openclaw
```
