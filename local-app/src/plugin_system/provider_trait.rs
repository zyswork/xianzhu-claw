//! 模型提供商 trait
//!
//! 定义 LLM 提供商的统一接口。所有 provider（OpenAI/Anthropic/Ollama 等）
//! 实现此 trait 后注册到 ProviderRegistry，即可被 orchestrator 使用。

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::agent::tools::ToolDefinition;

/// 模型提供商调用配置
#[derive(Debug, Clone)]
pub struct CallConfig {
    pub model: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
}

/// LLM 调用响应（与现有 LlmResponse 兼容）
pub use crate::agent::llm::LlmResponse;

/// 模型提供商 trait
///
/// 每个 LLM 提供商（OpenAI、Anthropic、Ollama 等）实现此 trait。
/// orchestrator 通过 ProviderRegistry 查找对应的 provider 进行调用。
#[async_trait]
pub trait ModelProvider: Send + Sync {
    /// 提供商唯一标识（"openai", "anthropic", "ollama"）
    fn id(&self) -> &str;

    /// 显示名称（"OpenAI", "Anthropic", "Ollama"）
    fn display_name(&self) -> &str;

    /// 支持的模型列表
    fn supported_models(&self) -> Vec<String>;

    /// 判断是否支持指定模型
    fn supports_model(&self, model: &str) -> bool {
        self.supported_models().iter().any(|m| model.starts_with(m) || m == model)
    }

    /// 流式调用 LLM
    ///
    /// 这是核心方法：发送消息到 LLM，流式返回 token。
    /// tx 用于实时推送 token 给前端。
    async fn call_stream(
        &self,
        config: &CallConfig,
        messages: &[serde_json::Value],
        system_prompt: Option<&str>,
        tools: Option<&[ToolDefinition]>,
        tx: mpsc::UnboundedSender<String>,
    ) -> Result<LlmResponse, String>;

    /// 健康检查
    async fn health_check(&self, config: &CallConfig) -> Result<bool, String> {
        // 默认实现：假设可用
        let _ = config;
        Ok(true)
    }
}

/// 模型提供商注册表
///
/// 管理所有已注册的 ModelProvider 实例。
/// orchestrator 通过 provider_id 或 model 名称查找对应的 provider。
pub struct ProviderRegistry {
    providers: Vec<Box<dyn ModelProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
        }
    }

    /// 注册一个 provider
    pub fn register(&mut self, provider: Box<dyn ModelProvider>) {
        log::info!("注册模型提供商: {} ({})", provider.display_name(), provider.id());
        self.providers.push(provider);
    }

    /// 按 ID 查找 provider
    pub fn get(&self, id: &str) -> Option<&dyn ModelProvider> {
        self.providers.iter().find(|p| p.id() == id).map(|p| p.as_ref())
    }

    /// 按模型名称查找 provider
    pub fn find_by_model(&self, model: &str) -> Option<&dyn ModelProvider> {
        self.providers.iter().find(|p| p.supports_model(model)).map(|p| p.as_ref())
    }

    /// 列出所有 provider ID
    pub fn list(&self) -> Vec<&str> {
        self.providers.iter().map(|p| p.id()).collect()
    }

    /// 列出所有支持的模型
    pub fn all_models(&self) -> Vec<(String, String)> {
        let mut models = Vec::new();
        for p in &self.providers {
            for m in p.supported_models() {
                models.push((m, p.id().to_string()));
            }
        }
        models
    }
}
