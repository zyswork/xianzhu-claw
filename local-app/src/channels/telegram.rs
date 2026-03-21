//! Telegram Bot 本地轮询
//!
//! 在桌面端直接轮询 Telegram API，消息本地处理（零延迟）。
//! 参考 OpenClaw：Telegram 轮询始终在能力最强的端执行。

use std::sync::Arc;
use crate::agent::Orchestrator;

/// Telegram Bot 配置
pub struct TelegramConfig {
    pub bot_token: String,
}

/// 启动 Telegram 长轮询（后台 tokio task）
pub async fn start_polling(
    config: TelegramConfig,
    pool: sqlx::SqlitePool,
    orchestrator: Arc<Orchestrator>,
    app_handle: tauri::AppHandle,
) {
    let token = config.bot_token.clone();
    log::info!("Telegram: 启动本地轮询 (token: {}...)", &token[..token.len().min(15)]);

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        let mut offset: i64 = 0;

        log::info!("Telegram: 轮询 loop 已进入");

        loop {
            let url = format!(
                "https://api.telegram.org/bot{}/getUpdates?offset={}&timeout=30",
                token, offset
            );

            match client.get(&url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    match resp.json::<serde_json::Value>().await {
                        Ok(data) => {
                            if data["ok"].as_bool() != Some(true) {
                                log::warn!("Telegram: API 返回错误: {}", data);
                                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                                continue;
                            }
                            if let Some(updates) = data["result"].as_array() {
                                if !updates.is_empty() {
                                    log::info!("Telegram: 收到 {} 条更新", updates.len());
                                }
                                for update in updates {
                                    offset = update["update_id"].as_i64().unwrap_or(0) + 1;
                                    // 并发处理：不阻塞轮询 loop
                                    let t = token.clone();
                                    let p = pool.clone();
                                    let o = orchestrator.clone();
                                    let h = app_handle.clone();
                                    let u = update.clone();
                                    tokio::spawn(async move {
                                        handle_update(&t, &u, &p, &o, &h).await;
                                    });
                                }
                            } else {
                                log::warn!("Telegram: 响应缺少 result 字段: {}", &data.to_string()[..data.to_string().len().min(200)]);
                            }
                        }
                        Err(e) => {
                            log::warn!("Telegram: JSON 解析失败 (status={}): {}", status, e);
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Telegram: 轮询请求失败: {}，10秒后重试", e);
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                }
            }
        }
    });
}

/// 处理单条 Telegram 消息
async fn handle_update(
    token: &str,
    update: &serde_json::Value,
    pool: &sqlx::SqlitePool,
    orchestrator: &Arc<Orchestrator>,
    app_handle: &tauri::AppHandle,
) {
    let msg = match update.get("message") {
        Some(m) => m,
        None => return,
    };
    let text = match msg["text"].as_str() {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => return,
    };

    let chat_id = msg["chat"]["id"].as_i64().unwrap_or(0);
    let user_name = msg["from"]["first_name"].as_str().unwrap_or("User");

    log::info!("Telegram: [{}] {}: {}", chat_id, user_name, &text[..text.len().min(50)]);

    // 获取本地 Agent
    let agent = match orchestrator.list_agents().await {
        Ok(agents) => match agents.into_iter().next() {
            Some(a) => a,
            None => { log::warn!("Telegram: 无可用 Agent"); return; }
        },
        Err(_) => return,
    };

    // 获取或创建 session
    let session_title = format!("[Telegram] {}", user_name);
    let session_id = get_or_create_session(pool, &agent.id, chat_id, &session_title).await;

    // 发送 typing 状态
    send_typing(token, chat_id).await;

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
            // 检查模型是否在此 provider
            if let Some(models) = p["models"].as_array() {
                for m in models {
                    if m["id"].as_str() == Some(&agent.model) {
                        return Some((api_type, key.to_string(), base_url));
                    }
                }
            }
            // 有 key 就用第一个
            return Some((api_type, key.to_string(), base_url));
        }
        None
    });

    let (api_type, api_key, base_url) = match provider_info {
        Some(info) => info,
        None => {
            send_message(token, chat_id, "未配置 LLM Provider，请在桌面端设置中添加。").await;
            return;
        }
    };

    use tauri::Manager;

    // 直接推送用户消息到前端（不经过 DB 读取，像 OpenClaw 一样）
    let _ = app_handle.emit_all("chat-event", serde_json::json!({
        "type": "message",
        "sessionId": session_id,
        "role": "user",
        "content": text,
        "source": "telegram",
    }));

    // 推送"思考中"状态
    let _ = app_handle.emit_all("chat-event", serde_json::json!({
        "type": "thinking",
        "sessionId": session_id,
        "source": "telegram",
    }));

    // 调用本地 orchestrator
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // 收集输出 + 推送流式 token（带 session 标识，不会污染其他会话）
    let app_for_stream = app_handle.clone();
    let sid_for_stream = session_id.clone();
    let output_handle = tokio::spawn(async move {
        let mut output = String::new();
        while let Some(token) = rx.recv().await {
            output.push_str(&token);
            // 带 sessionId 的流式 token（前端只处理匹配的 session）
            let _ = app_for_stream.emit_all("chat-event", serde_json::json!({
                "type": "token",
                "sessionId": sid_for_stream,
                "content": output.clone(),
                "source": "telegram",
            }));
        }
        output
    });

    let base_url_opt = if base_url.is_empty() { None } else { Some(base_url.as_str()) };

    let result = orchestrator.send_message_stream(
        &agent.id, &session_id, &text,
        &api_key, &api_type, base_url_opt, tx, None,
    ).await;

    let response = output_handle.await.unwrap_or_default();

    let reply = match result {
        Ok(resp) => {
            let r = if resp.is_empty() { response.clone() } else { resp };
            if !r.is_empty() {
                send_message(token, chat_id, &r).await;
                log::info!("Telegram: 回复 [{}] {}字符", chat_id, r.len());
            }
            r
        }
        Err(e) => {
            log::error!("Telegram: 处理失败: {}", e);
            let err_msg = format!("处理出错: {}", &e[..e.len().min(100)]);
            send_message(token, chat_id, &err_msg).await;
            err_msg
        }
    };

    // 推送完整回复到前端（直接携带内容，不用读 DB）
    let _ = app_handle.emit_all("chat-event", serde_json::json!({
        "type": "done",
        "sessionId": session_id,
        "role": "assistant",
        "content": reply,
        "source": "telegram",
    }));
}

/// 获取或创建 Telegram session
async fn get_or_create_session(pool: &sqlx::SqlitePool, agent_id: &str, chat_id: i64, title: &str) -> String {
    let tag = format!("tg-{}", chat_id);

    // 先查有没有已存在的
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM chat_sessions WHERE title LIKE '%' || ? || '%' OR title = ? LIMIT 1"
    ).bind(&tag).bind(title).fetch_optional(pool).await.ok().flatten();

    if let Some((id,)) = existing {
        return id;
    }

    // 创建新 session
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let _ = sqlx::query(
        "INSERT INTO chat_sessions (id, agent_id, title, created_at) VALUES (?, ?, ?, ?)"
    ).bind(&id).bind(agent_id).bind(title).bind(now).execute(pool).await;

    id
}

/// 发送 typing 状态
async fn send_typing(token: &str, chat_id: i64) {
    let client = reqwest::Client::new();
    let _ = client.post(format!("https://api.telegram.org/bot{}/sendChatAction", token))
        .json(&serde_json::json!({"chat_id": chat_id, "action": "typing"}))
        .send().await;
}

/// 发送消息到 Telegram
async fn send_message(token: &str, chat_id: i64, text: &str) {
    let client = reqwest::Client::new();
    // 先尝试 Markdown 格式
    let resp = client.post(format!("https://api.telegram.org/bot{}/sendMessage", token))
        .json(&serde_json::json!({"chat_id": chat_id, "text": text, "parse_mode": "Markdown"}))
        .send().await;

    // Markdown 失败则降级纯文本
    if let Ok(r) = resp {
        if let Ok(body) = r.json::<serde_json::Value>().await {
            if body["ok"].as_bool() != Some(true) {
                let _ = client.post(format!("https://api.telegram.org/bot{}/sendMessage", token))
                    .json(&serde_json::json!({"chat_id": chat_id, "text": text}))
                    .send().await;
            }
        }
    }
}
