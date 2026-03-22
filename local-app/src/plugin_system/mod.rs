//! 插件系统
//!
//! 统一管理渠道、模型提供商、记忆后端等可扩展组件。
//! Phase 1: Trait 抽象 + 内置插件注册（不做动态加载）

pub mod manifest;
pub mod registry;
pub mod provider_trait;
pub mod providers;

pub use registry::PluginRegistry;
pub use provider_trait::{ProviderRegistry, CallConfig};
pub use providers::create_default_registry;
