//! 插件清单定义
//!
//! 描述一个插件的元数据、类型、配置项。

use serde::{Deserialize, Serialize};

/// 插件类型
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginType {
    /// 消息渠道（Telegram/Discord/Slack/飞书）
    Channel,
    /// LLM 提供商（OpenAI/Anthropic/Ollama）
    ModelProvider,
    /// 记忆后端（SQLite/LanceDB）
    MemoryBackend,
    /// 嵌入模型（OpenAI/Aliyun/Local）
    Embedding,
    /// 功能扩展（TTS/语音/设备配对）
    Feature,
}

impl std::fmt::Display for PluginType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Channel => write!(f, "渠道"),
            Self::ModelProvider => write!(f, "模型提供商"),
            Self::MemoryBackend => write!(f, "记忆后端"),
            Self::Embedding => write!(f, "嵌入模型"),
            Self::Feature => write!(f, "功能扩展"),
        }
    }
}

/// 插件配置字段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigField {
    pub key: String,
    pub label: String,
    #[serde(default = "default_field_type")]
    pub field_type: String, // "text" | "password" | "select" | "boolean" | "number"
    #[serde(default)]
    pub required: bool,
    pub default: Option<String>,
    pub placeholder: Option<String>,
    /// select 类型的选项
    pub options: Option<Vec<String>>,
}

fn default_field_type() -> String {
    "text".to_string()
}

/// 插件清单
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// 唯一标识（如 "openai-provider"）
    pub id: String,
    /// 显示名称（如 "OpenAI"）
    pub name: String,
    /// 版本
    pub version: String,
    /// 描述
    pub description: String,
    /// 插件类型
    pub plugin_type: PluginType,
    /// 是否内置（内置插件不可卸载）
    pub builtin: bool,
    /// 配置项
    #[serde(default)]
    pub config_schema: Vec<ConfigField>,
    /// 依赖的其他插件 ID
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// 图标（emoji 或 URL）
    #[serde(default)]
    pub icon: String,
    /// 是否默认启用
    #[serde(default = "default_true")]
    pub default_enabled: bool,
    /// 实现状态: "active"(已实现) | "ready"(就绪可用) | "planned"(规划中)
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_status() -> String {
    "active".to_string()
}

fn default_true() -> bool {
    true
}

impl PluginManifest {
    /// 创建内置插件清单（简化构造）
    pub fn builtin(
        id: &str,
        name: &str,
        description: &str,
        plugin_type: PluginType,
        icon: &str,
    ) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            description: description.to_string(),
            plugin_type,
            builtin: true,
            config_schema: Vec::new(),
            dependencies: Vec::new(),
            icon: icon.to_string(),
            default_enabled: true,
            status: "active".to_string(),
        }
    }

    /// 添加配置字段
    pub fn with_config(mut self, fields: Vec<ConfigField>) -> Self {
        self.config_schema = fields;
        self
    }

    /// 设置状态
    pub fn with_status(mut self, status: &str) -> Self {
        self.status = status.to_string();
        self
    }
}
