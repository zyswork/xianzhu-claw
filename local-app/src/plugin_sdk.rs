//! 插件 SDK
//!
//! 参考 OpenClaw 的 plugin-sdk 和 IronClaw 的 trait 系统。
//! 定义插件注册接口：Channel / Provider / Tool / Hook。
//!
//! 当前阶段：定义接口。后续支持 WASM 插件加载。

use async_trait::async_trait;

/// 插件能力类型
#[derive(Debug, Clone, PartialEq)]
pub enum PluginCapability {
    /// 消息渠道（如 Telegram, 飞书）
    Channel,
    /// LLM 提供商
    Provider,
    /// 工具
    Tool,
    /// 生命周期钩子
    Hook,
}

/// 插件元数据
#[derive(Debug, Clone)]
pub struct PluginMeta {
    /// 插件 ID（唯一标识）
    pub id: String,
    /// 显示名称
    pub name: String,
    /// 版本
    pub version: String,
    /// 描述
    pub description: String,
    /// 提供的能力
    pub capabilities: Vec<PluginCapability>,
}

/// 插件 trait — 所有插件的基础接口
#[async_trait]
pub trait Plugin: Send + Sync {
    /// 元数据
    fn meta(&self) -> &PluginMeta;

    /// 初始化（加载配置、建立连接）
    async fn init(&self) -> Result<(), String> { Ok(()) }

    /// 关闭（清理资源）
    async fn shutdown(&self) -> Result<(), String> { Ok(()) }
}

/// 插件注册表
pub struct PluginRegistry {
    plugins: Vec<Box<dyn Plugin>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self { plugins: Vec::new() }
    }

    /// 注册插件
    pub fn register(&mut self, plugin: Box<dyn Plugin>) {
        let meta = plugin.meta();
        log::info!("注册插件: {} v{} (capabilities={:?})", meta.name, meta.version, meta.capabilities);

        // 去重
        if self.plugins.iter().any(|p| p.meta().id == meta.id) {
            log::warn!("插件 {} 已存在，覆盖", meta.id);
            self.plugins.retain(|p| p.meta().id != meta.id);
        }

        self.plugins.push(plugin);
    }

    /// 获取所有插件
    pub fn all(&self) -> &[Box<dyn Plugin>] {
        &self.plugins
    }

    /// 按能力筛选
    pub fn with_capability(&self, cap: &PluginCapability) -> Vec<&dyn Plugin> {
        self.plugins.iter()
            .filter(|p| p.meta().capabilities.contains(cap))
            .map(|p| p.as_ref())
            .collect()
    }

    /// 按 ID 查找
    pub fn get(&self, id: &str) -> Option<&dyn Plugin> {
        self.plugins.iter()
            .find(|p| p.meta().id == id)
            .map(|p| p.as_ref())
    }

    /// 初始化所有插件
    pub async fn init_all(&self) -> Vec<(String, Result<(), String>)> {
        let mut results = Vec::new();
        for plugin in &self.plugins {
            let id = plugin.meta().id.clone();
            let result = plugin.init().await;
            if let Err(ref e) = result {
                log::error!("插件 {} 初始化失败: {}", id, e);
            }
            results.push((id, result));
        }
        results
    }
}
