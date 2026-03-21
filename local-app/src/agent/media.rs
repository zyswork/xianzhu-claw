//! 媒体理解管线
//!
//! 参考 OpenClaw 的 media-understanding 模块。
//! 将语音/图片/视频转为文本，注入 Agent 上下文。

use async_trait::async_trait;

/// 媒体理解 provider trait
#[async_trait]
pub trait MediaProvider: Send + Sync {
    /// provider 名称
    fn name(&self) -> &str;

    /// 支持的能力
    fn capabilities(&self) -> Vec<MediaCapability>;

    /// 语音转文字
    async fn transcribe_audio(&self, audio_data: &[u8], format: &str) -> Result<String, String> {
        let _ = (audio_data, format);
        Err("此 provider 不支持语音转文字".to_string())
    }

    /// 图片描述
    async fn describe_image(&self, image_url: &str, prompt: Option<&str>) -> Result<String, String> {
        let _ = (image_url, prompt);
        Err("此 provider 不支持图片描述".to_string())
    }
}

/// 媒体能力
#[derive(Debug, Clone, PartialEq)]
pub enum MediaCapability {
    AudioTranscription,
    ImageDescription,
    VideoDescription,
}

/// OpenAI Whisper 语音转文字
pub struct WhisperProvider {
    api_url: String,
    api_key: String,
    model: String,
}

impl WhisperProvider {
    pub fn new(api_key: &str) -> Self {
        Self {
            api_url: "https://api.openai.com/v1/audio/transcriptions".to_string(),
            api_key: api_key.to_string(),
            model: "whisper-1".to_string(),
        }
    }

    pub fn with_base_url(mut self, url: &str) -> Self {
        self.api_url = format!("{}/audio/transcriptions", url.trim_end_matches('/'));
        self
    }
}

#[async_trait]
impl MediaProvider for WhisperProvider {
    fn name(&self) -> &str { "whisper" }

    fn capabilities(&self) -> Vec<MediaCapability> {
        vec![MediaCapability::AudioTranscription]
    }

    async fn transcribe_audio(&self, audio_data: &[u8], format: &str) -> Result<String, String> {
        let client = reqwest::Client::new();

        // multipart/form-data 上传
        let part = reqwest::multipart::Part::bytes(audio_data.to_vec())
            .file_name(format!("audio.{}", format))
            .mime_str(&format!("audio/{}", format))
            .map_err(|e| format!("构建上传失败: {}", e))?;

        let form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .text("language", "zh")
            .part("file", part);

        let response = client
            .post(&self.api_url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Whisper API 请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Whisper API 错误 {}: {}", status, &body[..body.len().min(200)]));
        }

        let data: serde_json::Value = response.json().await
            .map_err(|e| format!("解析 Whisper 响应失败: {}", e))?;

        data["text"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Whisper 响应中无 text 字段".to_string())
    }
}

/// Vision 图片描述（使用 LLM vision 能力）
pub struct VisionDescriber {
    api_url: String,
    api_key: String,
    model: String,
}

impl VisionDescriber {
    pub fn new(api_key: &str, model: &str) -> Self {
        Self {
            api_url: "https://api.openai.com/v1/chat/completions".to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
        }
    }

    pub fn with_base_url(mut self, url: &str) -> Self {
        self.api_url = format!("{}/chat/completions", url.trim_end_matches('/'));
        self
    }
}

#[async_trait]
impl MediaProvider for VisionDescriber {
    fn name(&self) -> &str { "vision" }

    fn capabilities(&self) -> Vec<MediaCapability> {
        vec![MediaCapability::ImageDescription]
    }

    async fn describe_image(&self, image_url: &str, prompt: Option<&str>) -> Result<String, String> {
        let client = reqwest::Client::new();
        let user_prompt = prompt.unwrap_or("请详细描述这张图片的内容。");

        let body = serde_json::json!({
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": user_prompt},
                    {"type": "image_url", "image_url": {"url": image_url}}
                ]
            }],
            "max_tokens": 500,
        });

        let response = client
            .post(&self.api_url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Vision API 请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Vision API 错误 {}: {}", status, &body[..body.len().min(200)]));
        }

        let data: serde_json::Value = response.json().await
            .map_err(|e| format!("解析 Vision 响应失败: {}", e))?;

        data["choices"][0]["message"]["content"].as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "Vision 响应中无内容".to_string())
    }
}

/// 媒体理解管理器（管理多个 provider）
pub struct MediaManager {
    providers: Vec<Box<dyn MediaProvider>>,
}

impl MediaManager {
    pub fn new() -> Self {
        Self { providers: Vec::new() }
    }

    pub fn register(&mut self, provider: Box<dyn MediaProvider>) {
        log::info!("注册媒体 provider: {} (capabilities={:?})", provider.name(), provider.capabilities());
        self.providers.push(provider);
    }

    /// 转录语音
    pub async fn transcribe(&self, audio_data: &[u8], format: &str) -> Result<String, String> {
        for p in &self.providers {
            if p.capabilities().contains(&MediaCapability::AudioTranscription) {
                return p.transcribe_audio(audio_data, format).await;
            }
        }
        Err("没有可用的语音转文字 provider".to_string())
    }

    /// 描述图片
    pub async fn describe_image(&self, image_url: &str, prompt: Option<&str>) -> Result<String, String> {
        for p in &self.providers {
            if p.capabilities().contains(&MediaCapability::ImageDescription) {
                return p.describe_image(image_url, prompt).await;
            }
        }
        Err("没有可用的图片描述 provider".to_string())
    }

    pub fn has_capability(&self, cap: &MediaCapability) -> bool {
        self.providers.iter().any(|p| p.capabilities().contains(cap))
    }
}
