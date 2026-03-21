//! 飞书 Bot 渠道
//!
//! 通过飞书 WebSocket 长连接接收消息，REST API 发送回复。
//! 桌面端无需公网 IP，适合 Tauri 应用。
//!
//! 流程：
//! 1. 用 app_id + app_secret 获取 tenant_access_token
//! 2. 用 token 获取 WebSocket endpoint
//! 3. 连接 WebSocket，接收事件
//! 4. 处理 im.message.receive_v1 事件
//! 5. 调用 orchestrator 处理消息
//! 6. 通过 REST API 发送回复

use std::sync::Arc;
use crate::agent::Orchestrator;

/// 飞书 Bot 配置
pub struct FeishuConfig {
    pub app_id: String,
    pub app_secret: String,
}

/// 飞书 API 基地址
const FEISHU_BASE: &str = "https://open.feishu.cn/open-apis";

/// 启动飞书长连接（后台 tokio task）
pub async fn start_feishu(
    config: FeishuConfig,
    pool: sqlx::SqlitePool,
    orchestrator: Arc<Orchestrator>,
    app_handle: tauri::AppHandle,
) {
    let app_id = config.app_id.clone();
    let app_secret = config.app_secret.clone();
    log::info!("飞书: 启动连接 (app_id: {}...)", &app_id[..app_id.len().min(10)]);

    tokio::spawn(async move {
        loop {
            match run_feishu_loop(&app_id, &app_secret, &pool, &orchestrator, &app_handle).await {
                Ok(_) => log::info!("飞书: 连接正常关闭，5秒后重连"),
                Err(e) => log::warn!("飞书: 连接异常: {}，10秒后重连", e),
            }
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        }
    });
}

/// 飞书连接主循环
async fn run_feishu_loop(
    app_id: &str,
    app_secret: &str,
    pool: &sqlx::SqlitePool,
    orchestrator: &Arc<Orchestrator>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    // 1. 获取 tenant_access_token
    let token = get_tenant_token(&client, app_id, app_secret).await?;
    log::info!("飞书: tenant_access_token 获取成功");

    // 2. 尝试 WebSocket 模式
    let ws_result = try_websocket_mode(&client, app_id, app_secret, &token, pool, orchestrator, app_handle).await;

    match ws_result {
        Ok(_) => Ok(()),
        Err(e) => {
            log::warn!("飞书: WebSocket 模式失败 ({}), 降级为轮询模式", e);
            // 降级：定时拉取消息（飞书不支持长轮询，但可以用定时检查）
            polling_fallback(&client, &token, pool, orchestrator, app_handle).await
        }
    }
}

/// 获取 tenant_access_token
async fn get_tenant_token(
    client: &reqwest::Client,
    app_id: &str,
    app_secret: &str,
) -> Result<String, String> {
    let resp = client.post(format!("{}/auth/v3/tenant_access_token/internal", FEISHU_BASE))
        .json(&serde_json::json!({
            "app_id": app_id,
            "app_secret": app_secret
        }))
        .send().await
        .map_err(|e| format!("获取 token 失败: {}", e))?;

    let data: serde_json::Value = resp.json().await
        .map_err(|e| format!("解析 token 响应失败: {}", e))?;

    if data["code"].as_i64() != Some(0) {
        return Err(format!("飞书 token 错误: {}", data["msg"].as_str().unwrap_or("unknown")));
    }

    data["tenant_access_token"].as_str()
        .map(|s| s.to_string())
        .ok_or("token 字段缺失".to_string())
}

/// WebSocket 模式
async fn try_websocket_mode(
    client: &reqwest::Client,
    app_id: &str,
    app_secret: &str,
    _token: &str,
    pool: &sqlx::SqlitePool,
    orchestrator: &Arc<Orchestrator>,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    // 获取 WebSocket endpoint
    let resp = client.post("https://open.feishu.cn/callback/ws/endpoint")
        .json(&serde_json::json!({
            "AppID": app_id,
            "AppSecret": app_secret
        }))
        .send().await
        .map_err(|e| format!("获取 WS endpoint 失败: {}", e))?;

    let data: serde_json::Value = resp.json().await
        .map_err(|e| format!("解析 WS endpoint 响应失败: {}", e))?;

    if data["code"].as_i64() != Some(0) {
        return Err(format!("WS endpoint 错误: {}", data));
    }

    let ws_url = data["data"]["URL"].as_str()
        .ok_or("WS URL 缺失")?;

    log::info!("飞书: WebSocket 连接 {}", &ws_url[..ws_url.len().min(50)]);

    // 连接 WebSocket
    let (ws_stream, _) = tokio_tungstenite::connect_async(ws_url).await
        .map_err(|e| format!("WS 连接失败: {}", e))?;

    use tokio_tungstenite::tungstenite::Message as WsMsg;
    use futures_util::{StreamExt, SinkExt};

    let (mut write, mut read) = ws_stream.split();

    // 事件去重
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Ping 定时器
    let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(120));

    log::info!("飞书: WebSocket 已连接，等待事件...");

    loop {
        tokio::select! {
            _ = ping_interval.tick() => {
                let _ = write.send(WsMsg::Ping(vec![])).await;
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(WsMsg::Text(text))) => {
                        // JSON 事件
                        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                            handle_feishu_event(
                                &event, &mut seen_ids,
                                app_id, app_secret,
                                pool, orchestrator, app_handle,
                            ).await;
                        }
                    }
                    Some(Ok(WsMsg::Binary(data))) => {
                        // Protobuf 帧（飞书 WS 有时用二进制）
                        // 尝试作为 JSON 解析
                        if let Ok(text) = String::from_utf8(data) {
                            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&text) {
                                handle_feishu_event(
                                    &event, &mut seen_ids,
                                    app_id, app_secret,
                                    pool, orchestrator, app_handle,
                                ).await;
                            }
                        }
                    }
                    Some(Ok(WsMsg::Close(_))) => {
                        log::info!("飞书: WebSocket 关闭");
                        break;
                    }
                    Some(Err(e)) => {
                        log::warn!("飞书: WebSocket 错误: {}", e);
                        break;
                    }
                    None => break,
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

/// 处理飞书事件
async fn handle_feishu_event(
    event: &serde_json::Value,
    seen_ids: &mut std::collections::HashSet<String>,
    app_id: &str,
    app_secret: &str,
    pool: &sqlx::SqlitePool,
    orchestrator: &Arc<Orchestrator>,
    app_handle: &tauri::AppHandle,
) {
    // URL 验证 challenge
    if let Some(challenge) = event["challenge"].as_str() {
        log::info!("飞书: 收到 challenge 验证");
        // WebSocket 模式不需要回复 challenge，只做日志
        let _ = challenge;
        return;
    }

    let event_type = event["header"]["event_type"].as_str().unwrap_or("");
    let event_id = event["header"]["event_id"].as_str().unwrap_or("");

    // 去重
    if !event_id.is_empty() {
        if seen_ids.contains(event_id) {
            return;
        }
        seen_ids.insert(event_id.to_string());
        // 保持集合大小
        if seen_ids.len() > 1000 {
            seen_ids.clear();
        }
    }

    // 只处理消息事件
    if event_type != "im.message.receive_v1" {
        log::info!("飞书: 忽略事件类型: {}", event_type);
        return;
    }

    let msg = &event["event"]["message"];
    let sender = &event["event"]["sender"];

    // 忽略 bot 自己的消息
    if sender["sender_type"].as_str() == Some("bot") {
        return;
    }

    let message_type = msg["message_type"].as_str().unwrap_or("");
    let chat_id = msg["chat_id"].as_str().unwrap_or("");
    let chat_type = msg["chat_type"].as_str().unwrap_or("p2p");
    let sender_id = sender["sender_id"]["open_id"].as_str().unwrap_or("unknown");

    // 提取文本内容
    let text = match message_type {
        "text" => {
            let content_str = msg["content"].as_str().unwrap_or("{}");
            let content: serde_json::Value = serde_json::from_str(content_str).unwrap_or_default();
            content["text"].as_str().unwrap_or("").to_string()
        }
        _ => {
            log::info!("飞书: 暂不支持的消息类型: {}", message_type);
            return;
        }
    };

    if text.trim().is_empty() {
        return;
    }

    // 群聊中需要 @ 才回复
    if chat_type == "group" {
        // 简单检查：如果消息里没有 @ mention，跳过
        let mentions = msg["mentions"].as_array();
        if mentions.map_or(true, |m| m.is_empty()) {
            return;
        }
    }

    // 清理 @ mention 文本
    let clean_text = text.replace("@_user_1", "").trim().to_string();
    if clean_text.is_empty() { return; }

    log::info!("飞书: [{}] {}: {}", chat_id, sender_id, &clean_text[..clean_text.len().min(50)]);

    // 获取本地 Agent
    let agent = match orchestrator.list_agents().await {
        Ok(agents) => match agents.into_iter().next() {
            Some(a) => a,
            None => { log::warn!("飞书: 无可用 Agent"); return; }
        },
        Err(_) => return,
    };

    // 获取或创建 session
    let session_title = format!("[飞书] {}", sender_id);
    let session_id = get_or_create_session(pool, &agent.id, chat_id, &session_title).await;

    // 查找 Provider
    let providers_json: Option<String> = sqlx::query_scalar(
        "SELECT value FROM settings WHERE key = 'providers'"
    ).fetch_optional(pool).await.ok().flatten();

    let provider_info = providers_json.and_then(|pj| {
        let providers: Vec<serde_json::Value> = serde_json::from_str(&pj).ok()?;
        for p in &providers {
            if p["enabled"].as_bool() != Some(true) { continue; }
            let key = p["apiKey"].as_str().unwrap_or("");
            if key.is_empty() { continue; }
            let api_type = p["apiType"].as_str().unwrap_or("openai").to_string();
            let base_url = p["baseUrl"].as_str().unwrap_or("").to_string();
            return Some((api_type, key.to_string(), base_url));
        }
        None
    });

    let (api_type, api_key, base_url) = match provider_info {
        Some(info) => info,
        None => {
            send_feishu_message(app_id, app_secret, chat_id, "未配置 LLM Provider，请在桌面端设置中添加。").await;
            return;
        }
    };

    use tauri::Manager;
    // 推送用户消息到前端
    let _ = app_handle.emit_all("chat-event", serde_json::json!({
        "type": "message", "sessionId": session_id,
        "role": "user", "content": clean_text, "source": "feishu",
    }));

    // 调用 orchestrator
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let base_url_opt = if base_url.is_empty() { None } else { Some(base_url.as_str()) };

    let result = orchestrator.send_message_stream(
        &agent.id, &session_id, &clean_text,
        &api_key, &api_type, base_url_opt, tx, None,
    ).await;

    // 收集输出
    let mut output = String::new();
    while let Ok(token) = rx.try_recv() {
        output.push_str(&token);
    }

    let reply = match result {
        Ok(resp) => if resp.is_empty() { output } else { resp },
        Err(e) => format!("处理出错: {}", &e[..e.len().min(100)]),
    };

    if !reply.is_empty() {
        send_feishu_message(app_id, app_secret, chat_id, &reply).await;
        log::info!("飞书: 回复 [{}] {}字符", chat_id, reply.len());
    }

    // 推送回复到前端
    let _ = app_handle.emit_all("chat-event", serde_json::json!({
        "type": "done", "sessionId": session_id,
        "role": "assistant", "content": reply, "source": "feishu",
    }));
}

/// 发送飞书消息
async fn send_feishu_message(app_id: &str, app_secret: &str, chat_id: &str, text: &str) {
    let client = reqwest::Client::new();

    // 获取 token
    let token = match get_tenant_token(&client, app_id, app_secret).await {
        Ok(t) => t,
        Err(e) => { log::warn!("飞书: 发送消息失败（token）: {}", e); return; }
    };

    let body = serde_json::json!({
        "receive_id": chat_id,
        "msg_type": "text",
        "content": serde_json::json!({"text": text}).to_string(),
    });

    let resp = client.post(format!("{}/im/v1/messages?receive_id_type=chat_id", FEISHU_BASE))
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send().await;

    match resp {
        Ok(r) => {
            if let Ok(data) = r.json::<serde_json::Value>().await {
                if data["code"].as_i64() != Some(0) {
                    log::warn!("飞书: 发送消息失败: {}", data["msg"].as_str().unwrap_or("?"));
                }
            }
        }
        Err(e) => log::warn!("飞书: 发送消息请求失败: {}", e),
    }
}

/// 轮询降级模式（WebSocket 不可用时）
async fn polling_fallback(
    _client: &reqwest::Client,
    _token: &str,
    _pool: &sqlx::SqlitePool,
    _orchestrator: &Arc<Orchestrator>,
    _app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    log::info!("飞书: 轮询模式暂未实现，请确保 WebSocket 可用");
    // 飞书不像 Telegram 有 getUpdates，需要 webhook 或 WebSocket
    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
    Ok(())
}

/// 获取或创建飞书 session
async fn get_or_create_session(pool: &sqlx::SqlitePool, agent_id: &str, chat_id: &str, title: &str) -> String {
    let tag = format!("feishu-{}", chat_id);

    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM chat_sessions WHERE title LIKE '%' || ? || '%' OR title = ? LIMIT 1"
    ).bind(&tag).bind(title).fetch_optional(pool).await.ok().flatten();

    if let Some((id,)) = existing {
        return id;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query(
        "INSERT INTO chat_sessions (id, agent_id, title, created_at) VALUES (?, ?, ?, ?)"
    ).bind(&id).bind(agent_id).bind(title).bind(now).execute(pool).await;

    id
}
