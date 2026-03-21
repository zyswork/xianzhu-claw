//! 内置模型提供商实现
//!
//! Phase 1: 包装现有 LlmClient，通过 ModelProvider trait 统一调用。
//! Phase 2: 逐步把 LlmClient 的 provider-specific 逻辑提取到各自的实现中。

pub mod openai_compat;
pub mod anthropic;
pub mod ollama;

use super::provider_trait::{ModelProvider, ProviderRegistry};

/// 创建包含所有内置 provider 的注册表
pub fn create_default_registry() -> ProviderRegistry {
    let mut registry = ProviderRegistry::new();
    registry.register(Box::new(openai_compat::OpenAiCompatProvider::new()));
    registry.register(Box::new(anthropic::AnthropicProvider::new()));
    registry.register(Box::new(ollama::OllamaProvider::new()));
    registry
}
