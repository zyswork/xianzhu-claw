//! 用户画像命令 — 昵称、简介、头像管理

use std::sync::Arc;
use tauri::State;

use crate::agent::workspace::{AgentWorkspace, SoulFile};
use crate::AppState;

/// 读取用户画像信息
#[tauri::command]
pub async fn get_user_profile(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let pool = state.db.pool();

    let nickname: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("profile.nickname")
        .fetch_optional(pool).await
        .map_err(|e| format!("读取昵称失败: {}", e))?;

    let bio: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("profile.bio")
        .fetch_optional(pool).await
        .map_err(|e| format!("读取简介失败: {}", e))?;

    let avatar_path: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("profile.avatar_path")
        .fetch_optional(pool).await
        .map_err(|e| format!("读取头像路径失败: {}", e))?;

    Ok(serde_json::json!({
        "nickname": nickname.unwrap_or_default(),
        "bio": bio.unwrap_or_default(),
        "avatarPath": avatar_path.unwrap_or_default(),
    }))
}

/// 保存用户画像（昵称、简介），并同步更新所有 Agent 的 USER.md
#[tauri::command]
pub async fn save_user_profile(
    state: State<'_, Arc<AppState>>,
    nickname: String,
    bio: String,
) -> Result<(), String> {
    let pool = state.db.pool();
    let now = chrono::Utc::now().timestamp_millis();

    // 保存到 settings
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind("profile.nickname").bind(&nickname).bind(now)
     .execute(pool).await
     .map_err(|e| format!("保存昵称失败: {}", e))?;

    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind("profile.bio").bind(&bio).bind(now)
     .execute(pool).await
     .map_err(|e| format!("保存简介失败: {}", e))?;

    // 同步更新所有 Agent 的 USER.md 中的 Name 行
    let agents = state.orchestrator.list_agents().await.unwrap_or_default();
    let name_re = regex::Regex::new(r"(?m)^- \*\*Name\*\*: .*$")
        .map_err(|e| format!("正则编译失败: {}", e))?;
    let new_name_line = format!("- **Name**: {}", nickname);

    let mut updated_count = 0u32;
    for agent in &agents {
        let ws = AgentWorkspace::new(&agent.id);
        let content = match ws.read(SoulFile::User.filename()) {
            Some(c) => c,
            None => continue, // USER.md 不存在，跳过
        };

        let new_content = if name_re.is_match(&content) {
            name_re.replace(&content, new_name_line.as_str()).to_string()
        } else {
            format!("{}\n{}", new_name_line, content)
        };

        if let Err(e) = ws.write_file(&SoulFile::User, &new_content) {
            log::warn!("更新 Agent {} 的 USER.md 失败: {}", agent.id, e);
            continue;
        }
        updated_count += 1;
    }

    log::info!("用户画像已保存，同步更新了 {} 个 Agent 的 USER.md", updated_count);
    Ok(())
}

/// 保存用户头像（base64 数据写入文件）
#[tauri::command]
pub async fn save_user_avatar(
    state: State<'_, Arc<AppState>>,
    base64_data: String,
) -> Result<String, String> {
    // 去除 data URI 前缀
    let raw = if let Some(pos) = base64_data.find(";base64,") {
        &base64_data[pos + 8..]
    } else {
        &base64_data
    };

    let bytes = decode_base64(raw)?;

    // 写入头像文件
    let avatar_dir = dirs::home_dir()
        .ok_or("无法获取 home 目录")?
        .join(".xianzhu/profile");
    std::fs::create_dir_all(&avatar_dir)
        .map_err(|e| format!("创建头像目录失败: {}", e))?;

    let avatar_path = avatar_dir.join("avatar.png");
    std::fs::write(&avatar_path, &bytes)
        .map_err(|e| format!("保存头像失败: {}", e))?;

    // 保存路径到 settings
    let pool = state.db.pool();
    let now = chrono::Utc::now().timestamp_millis();
    let path_str = avatar_path.to_string_lossy().to_string();
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind("profile.avatar_path").bind(&path_str).bind(now)
     .execute(pool).await
     .map_err(|e| format!("保存头像路径失败: {}", e))?;

    log::info!("用户头像已保存: {} ({} 字节)", path_str, bytes.len());
    Ok(path_str)
}

/// 读取用户头像（返回 data URI 或 None）
#[tauri::command]
pub async fn get_user_avatar(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<String>, String> {
    let pool = state.db.pool();

    let avatar_path: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("profile.avatar_path")
        .fetch_optional(pool).await
        .map_err(|e| format!("读取头像路径失败: {}", e))?;

    let path_str = match avatar_path {
        Some(p) if !p.is_empty() => p,
        _ => return Ok(None),
    };

    let path = std::path::Path::new(&path_str);
    if !path.exists() {
        return Ok(None);
    }

    let bytes = std::fs::read(path)
        .map_err(|e| format!("读取头像文件失败: {}", e))?;

    let encoded = encode_base64(&bytes);
    Ok(Some(format!("data:image/png;base64,{}", encoded)))
}

/// Base64 解码（内联实现，与 misc.rs 一致）
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &b) in table.iter().enumerate() {
        lookup[b as usize] = i as u8;
    }
    let input = input.trim_end_matches('=');
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let bytes = input.as_bytes();
    for chunk in bytes.chunks(4) {
        let mut buf = [0u8; 4];
        for (i, &b) in chunk.iter().enumerate() {
            let v = lookup[b as usize];
            if v == 255 {
                return Err(format!("无效 base64 字符: {}", b as char));
            }
            buf[i] = v;
        }
        out.push((buf[0] << 2) | (buf[1] >> 4));
        if chunk.len() > 2 {
            out.push((buf[1] << 4) | (buf[2] >> 2));
        }
        if chunk.len() > 3 {
            out.push((buf[2] << 6) | buf[3]);
        }
    }
    Ok(out)
}

/// Base64 编码（内联实现）
fn encode_base64(input: &[u8]) -> String {
    let table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(table[((triple >> 18) & 0x3F) as usize] as char);
        out.push(table[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(table[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(table[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}
