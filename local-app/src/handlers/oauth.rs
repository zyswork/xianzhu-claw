//! OAuth 认证相关命令
//!
//! 支持 Google (Gemini) 和 OpenAI 的 OAuth PKCE 认证流程。
//! 包含启动授权、交换令牌、刷新令牌三个 Tauri 命令。

use std::sync::Arc;
use std::collections::HashMap;
use tauri::State;

use crate::AppState;
use super::helpers::{load_providers, save_providers};

// ─── 全局待处理 OAuth 流程存储 ────────────────────────────────

static PENDING_FLOWS: std::sync::OnceLock<std::sync::Mutex<HashMap<String, PendingOAuth>>> =
    std::sync::OnceLock::new();

struct PendingOAuth {
    provider: String,
    code_verifier: String,
    #[allow(dead_code)]
    created_at: i64,
}

fn pending_flows() -> &'static std::sync::Mutex<HashMap<String, PendingOAuth>> {
    PENDING_FLOWS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

// ─── OAuth Provider 预设配置 ──────────────────────────────────

struct OAuthPreset {
    name: &'static str,
    api_type: &'static str,
    authorize_url: &'static str,
    token_url: &'static str,
    client_id: &'static str,
    base_url: &'static str,
    scopes: &'static str,
    models: Vec<(&'static str, &'static str)>,
}

fn get_oauth_presets() -> Vec<OAuthPreset> {
    vec![
        OAuthPreset {
            name: "Google (Gemini)",
            api_type: "openai",
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            client_id: "936733940271-mr6960s18vmk8fgl1rcvnsdpn0dpbhb1.apps.googleusercontent.com",
            base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
            scopes: "https://www.googleapis.com/auth/generative-language",
            models: vec![
                ("gemini-2.5-flash", "Gemini 2.5 Flash"),
                ("gemini-2.5-pro", "Gemini 2.5 Pro"),
            ],
        },
        OAuthPreset {
            name: "OpenAI",
            api_type: "openai",
            authorize_url: "https://auth.openai.com/authorize",
            token_url: "https://auth.openai.com/oauth/token",
            client_id: "app_BYhDWa2GTIZMP2qReNz7lt7l",
            base_url: "",
            scopes: "openid offline_access",
            models: vec![
                ("gpt-4o", "GPT-4o"),
                ("gpt-4o-mini", "GPT-4o Mini"),
                ("o3-mini", "o3-mini"),
            ],
        },
    ]
}

fn find_preset(provider: &str) -> Option<OAuthPreset> {
    get_oauth_presets()
        .into_iter()
        .find(|p| p.name.to_lowercase().contains(&provider.to_lowercase()))
}

// ─── PKCE 辅助函数 ───────────────────────────────────────────

/// Base64 URL 安全编码（无填充）
fn base64_url_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// 生成 PKCE code_verifier（32 字节随机数据 → base64url）
fn generate_code_verifier() -> String {
    // 使用 uuid 生成随机字节（两个 UUID = 32 字节）
    let u1 = uuid::Uuid::new_v4();
    let u2 = uuid::Uuid::new_v4();
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(u1.as_bytes());
    bytes.extend_from_slice(u2.as_bytes());
    base64_url_encode(&bytes)
}

/// 生成 PKCE code_challenge = SHA256(verifier) base64url
fn generate_code_challenge(verifier: &str) -> String {
    use sha2::{Sha256, Digest};
    let hash = Sha256::digest(verifier.as_bytes());
    base64_url_encode(&hash)
}

/// 生成随机 state 参数（32 hex 字符）
fn generate_state() -> String {
    let u = uuid::Uuid::new_v4();
    hex::encode(u.as_bytes())
}

// ─── 默认 OAuth 回调端口 ─────────────────────────────────────

const DEFAULT_OAUTH_PORT: u16 = 19985;

// ─── Tauri Commands ──────────────────────────────────────────

/// 启动 OAuth 授权流程
///
/// 生成 PKCE 参数，构建授权 URL，打开浏览器
#[tauri::command]
pub async fn start_oauth_flow(
    provider: String,
) -> Result<serde_json::Value, String> {
    let preset = find_preset(&provider)
        .ok_or_else(|| format!("未知的 OAuth 提供商: {}", provider))?;

    // 生成 PKCE 参数
    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state = generate_state();

    // 保存到全局待处理流程
    {
        let mut flows = pending_flows().lock().map_err(|e| format!("锁定失败: {}", e))?;
        flows.insert(state.clone(), PendingOAuth {
            provider: provider.clone(),
            code_verifier,
            created_at: chrono::Utc::now().timestamp(),
        });
        // 清理超过 10 分钟的过期流程
        let cutoff = chrono::Utc::now().timestamp() - 600;
        flows.retain(|_, v| v.created_at > cutoff);
    }

    // 构建回调 URI
    let redirect_uri = format!("http://localhost:{}/oauth/callback", DEFAULT_OAUTH_PORT);

    // 构建授权 URL
    let mut params = vec![
        ("client_id", preset.client_id.to_string()),
        ("redirect_uri", redirect_uri),
        ("response_type", "code".to_string()),
        ("scope", preset.scopes.to_string()),
        ("state", state.clone()),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256".to_string()),
    ];

    // Google 特有参数
    if provider.to_lowercase().contains("google") {
        params.push(("access_type", "offline".to_string()));
        params.push(("prompt", "consent".to_string()));
    }

    let url = format!(
        "{}?{}",
        preset.authorize_url,
        params.iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&")
    );

    // 打开浏览器（macOS 使用 open 命令）
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
    }

    Ok(serde_json::json!({
        "state": state,
        "authorizeUrl": url,
    }))
}

/// 交换 OAuth 授权码获取令牌
///
/// 使用 PKCE code_verifier 交换 access_token，并保存为 provider
#[tauri::command]
pub async fn exchange_oauth_code(
    state: State<'_, Arc<AppState>>,
    code: String,
    oauth_state: String,
) -> Result<serde_json::Value, String> {
    // 查找并移除待处理流程
    let pending = {
        let mut flows = pending_flows().lock().map_err(|e| format!("锁定失败: {}", e))?;
        flows.remove(&oauth_state)
            .ok_or_else(|| "无效或过期的 OAuth state".to_string())?
    };

    let preset = find_preset(&pending.provider)
        .ok_or_else(|| format!("未知的 OAuth 提供商: {}", pending.provider))?;

    let redirect_uri = format!("http://localhost:{}/oauth/callback", DEFAULT_OAUTH_PORT);

    // 调用令牌端点
    let client = reqwest::Client::new();
    let token_response = client
        .post(preset.token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("client_id", preset.client_id),
            ("code_verifier", &pending.code_verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("令牌请求失败: {}", e))?;

    let status = token_response.status();
    let body: serde_json::Value = token_response.json().await
        .map_err(|e| format!("解析令牌响应失败: {}", e))?;

    if !status.is_success() {
        let error_desc = body["error_description"].as_str()
            .or_else(|| body["error"].as_str())
            .unwrap_or("未知错误");
        return Err(format!("令牌交换失败: {}", error_desc));
    }

    let access_token = body["access_token"].as_str()
        .ok_or("响应中缺少 access_token")?;
    let refresh_token = body["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = body["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    // 构建 provider ID
    let provider_id = format!("oauth-{}", pending.provider.to_lowercase().replace(' ', "-"));

    // 构建模型列表
    let model_array: Vec<serde_json::Value> = preset.models.iter()
        .map(|(mid, mname)| serde_json::json!({"id": mid, "name": mname}))
        .collect();

    // 加载现有 providers 并更新或添加
    let mut providers = load_providers(&state.db).await.unwrap_or_default();

    let oauth_info = serde_json::json!({
        "provider": pending.provider,
        "refreshToken": refresh_token,
        "expiresAt": expires_at,
        "tokenUrl": preset.token_url,
        "clientId": preset.client_id,
    });

    if let Some(existing) = providers.iter_mut().find(|p| p["id"].as_str() == Some(&provider_id)) {
        // 更新现有 provider
        existing["apiKey"] = serde_json::Value::String(access_token.to_string());
        existing["oauth"] = oauth_info;
    } else {
        // 创建新 provider
        let new_provider = serde_json::json!({
            "id": provider_id,
            "name": preset.name,
            "apiType": preset.api_type,
            "baseUrl": preset.base_url,
            "apiKey": access_token,
            "models": model_array,
            "enabled": true,
            "oauth": oauth_info,
        });
        providers.push(new_provider);
    }

    save_providers(&state.db, &providers).await
        .map_err(|e| format!("保存 provider 失败: {}", e))?;

    log::info!("OAuth 认证成功: provider={}", preset.name);

    Ok(serde_json::json!({
        "success": true,
        "provider": preset.name,
        "providerId": provider_id,
    }))
}

/// 刷新 OAuth 令牌
///
/// 使用 refresh_token 获取新的 access_token
#[tauri::command]
pub async fn refresh_oauth_token(
    state: State<'_, Arc<AppState>>,
    provider_id: String,
) -> Result<(), String> {
    let mut providers = load_providers(&state.db).await
        .map_err(|e| format!("加载 providers 失败: {}", e))?;

    let provider = providers.iter_mut()
        .find(|p| p["id"].as_str() == Some(&provider_id))
        .ok_or_else(|| format!("未找到 provider: {}", provider_id))?;

    let oauth = provider.get("oauth")
        .ok_or("该 provider 不是 OAuth 类型")?;

    let refresh_token = oauth["refreshToken"].as_str()
        .ok_or("缺少 refreshToken")?;
    let token_url = oauth["tokenUrl"].as_str()
        .ok_or("缺少 tokenUrl")?;
    let client_id = oauth["clientId"].as_str()
        .ok_or("缺少 clientId")?;

    // 调用令牌刷新端点
    let client = reqwest::Client::new();
    let token_response = client
        .post(token_url)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ])
        .send()
        .await
        .map_err(|e| format!("刷新令牌请求失败: {}", e))?;

    let status = token_response.status();
    let body: serde_json::Value = token_response.json().await
        .map_err(|e| format!("解析刷新响应失败: {}", e))?;

    if !status.is_success() {
        let error_desc = body["error_description"].as_str()
            .or_else(|| body["error"].as_str())
            .unwrap_or("未知错误");
        return Err(format!("刷新令牌失败: {}", error_desc));
    }

    let new_access_token = body["access_token"].as_str()
        .ok_or("刷新响应中缺少 access_token")?;
    let expires_in = body["expires_in"].as_i64().unwrap_or(3600);
    let new_expires_at = chrono::Utc::now().timestamp() + expires_in;

    // 更新 provider
    provider["apiKey"] = serde_json::Value::String(new_access_token.to_string());
    if let Some(oauth_mut) = provider.get_mut("oauth") {
        oauth_mut["expiresAt"] = serde_json::json!(new_expires_at);
        // 如果响应中有新的 refresh_token，也更新
        if let Some(new_rt) = body["refresh_token"].as_str() {
            oauth_mut["refreshToken"] = serde_json::Value::String(new_rt.to_string());
        }
    }

    save_providers(&state.db, &providers).await
        .map_err(|e| format!("保存更新后的 provider 失败: {}", e))?;

    log::info!("OAuth 令牌刷新成功: provider_id={}", provider_id);

    Ok(())
}

// ─── 供网关回调使用的公共函数 ─────────────────────────────────

/// 处理 OAuth 回调（供 gateway/api.rs 调用）
///
/// 从查询参数中提取 code 和 state，执行令牌交换，
/// 返回 (success, provider_name) 或错误信息
pub async fn handle_oauth_callback(
    pool: &sqlx::SqlitePool,
    code: &str,
    oauth_state: &str,
) -> Result<String, String> {
    // 查找并移除待处理流程
    let pending = {
        let mut flows = pending_flows().lock().map_err(|e| format!("锁定失败: {}", e))?;
        flows.remove(oauth_state)
            .ok_or_else(|| "无效或过期的 OAuth state".to_string())?
    };

    let preset = find_preset(&pending.provider)
        .ok_or_else(|| format!("未知的 OAuth 提供商: {}", pending.provider))?;

    let redirect_uri = format!("http://localhost:{}/oauth/callback", DEFAULT_OAUTH_PORT);

    // 调用令牌端点
    let client = reqwest::Client::new();
    let token_response = client
        .post(preset.token_url)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", &redirect_uri),
            ("client_id", preset.client_id),
            ("code_verifier", &pending.code_verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("令牌请求失败: {}", e))?;

    let status = token_response.status();
    let body: serde_json::Value = token_response.json().await
        .map_err(|e| format!("解析令牌响应失败: {}", e))?;

    if !status.is_success() {
        let error_desc = body["error_description"].as_str()
            .or_else(|| body["error"].as_str())
            .unwrap_or("未知错误");
        return Err(format!("令牌交换失败: {}", error_desc));
    }

    let access_token = body["access_token"].as_str()
        .ok_or("响应中缺少 access_token")?;
    let refresh_token = body["refresh_token"].as_str().map(|s| s.to_string());
    let expires_in = body["expires_in"].as_i64().unwrap_or(3600);
    let expires_at = chrono::Utc::now().timestamp() + expires_in;

    let provider_id = format!("oauth-{}", pending.provider.to_lowercase().replace(' ', "-"));

    let model_array: Vec<serde_json::Value> = preset.models.iter()
        .map(|(mid, mname)| serde_json::json!({"id": mid, "name": mname}))
        .collect();

    // 直接操作数据库加载/保存 providers
    let providers_json_str: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'providers'"
    ).fetch_optional(pool).await.ok().flatten();
    let mut providers: Vec<serde_json::Value> = providers_json_str
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let oauth_info = serde_json::json!({
        "provider": pending.provider,
        "refreshToken": refresh_token,
        "expiresAt": expires_at,
        "tokenUrl": preset.token_url,
        "clientId": preset.client_id,
    });

    if let Some(existing) = providers.iter_mut().find(|p| p["id"].as_str() == Some(&provider_id)) {
        existing["apiKey"] = serde_json::Value::String(access_token.to_string());
        existing["oauth"] = oauth_info;
    } else {
        providers.push(serde_json::json!({
            "id": provider_id,
            "name": preset.name,
            "apiType": preset.api_type,
            "baseUrl": preset.base_url,
            "apiKey": access_token,
            "models": model_array,
            "enabled": true,
            "oauth": oauth_info,
        }));
    }

    let providers_json = serde_json::to_string(&providers)
        .map_err(|e| format!("序列化 providers 失败: {}", e))?;
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('providers', ?)")
        .bind(&providers_json)
        .execute(pool)
        .await
        .map_err(|e| format!("保存 providers 失败: {}", e))?;

    log::info!("OAuth 回调处理成功: provider={}", preset.name);

    Ok(preset.name.to_string())
}
