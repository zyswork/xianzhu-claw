//! 双层心跳：程序化状态监控 + LLM 智能心跳

use std::path::PathBuf;

use super::{store, types::*};
use tauri::Manager;

/// 第一层：程序化状态监控
pub async fn health_check(
    pool: &sqlx::SqlitePool,
    app_handle: &tauri::AppHandle,
) -> HealthReport {
    let stuck = store::timeout_stuck_runs(pool, STUCK_RUN_THRESHOLD_SECS).await.unwrap_or(0);
    let high_fail = store::high_fail_jobs(pool, 3).await.unwrap_or_default();
    let auto_disabled = store::auto_disabled_jobs(pool).await.unwrap_or_default();
    let failure_rate = store::recent_failure_rate(pool, 3600).await.unwrap_or(0.0);

    let report = HealthReport {
        scheduler_alive: true,
        stuck_runs: if stuck > 0 {
            vec![format!("{} 个 stuck run 已超时", stuck)]
        } else {
            vec![]
        },
        high_fail_jobs: high_fail,
        auto_disabled_jobs: auto_disabled,
        recent_failure_rate: failure_rate,
    };

    if report.has_issues() {
        log::warn!("心跳检测到问题: stuck={}, fail={}, disabled={}",
            report.stuck_runs.len(), report.high_fail_jobs.len(),
            report.auto_disabled_jobs.len());
        let _ = app_handle.emit_all("heartbeat-alert", &report);
    }

    report
}

/// 第二层：LLM 智能心跳
pub async fn llm_heartbeat(
    pool: &sqlx::SqlitePool,
    orchestrator: &crate::agent::Orchestrator,
    workspace_dir: &PathBuf,
    config: &HeartbeatConfig,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    // quiet hours 检查
    if is_quiet_hour(config) {
        log::debug!("LLM 心跳：当前为静默时段，跳过");
        return Ok(());
    }

    // 读取 HEARTBEAT.md
    let heartbeat_path = workspace_dir.join("HEARTBEAT.md");
    let checklist = if heartbeat_path.exists() {
        tokio::fs::read_to_string(&heartbeat_path).await.unwrap_or_default()
    } else {
        return Ok(()); // 无检查清单，跳过
    };

    // 跳过空文件
    let has_tasks = checklist.lines().any(|line| line.trim_start().starts_with("- "));
    if !has_tasks {
        return Ok(());
    }

    // 获取当前健康报告
    let report = health_check(pool, app_handle).await;

    // 构造 prompt（引导 Agent 执行外部动作）
    let prompt = format!(
        "你正在执行定期心跳检查。以下是当前系统状态和你的检查清单。\n\n\
         ## 系统状态\n\
         - 调度器: {}\n\
         - 最近1h失败率: {:.1}%\n\
         - 连续失败任务: {}\n\
         - 自动禁用任务: {}\n\n\
         ## 你的检查清单\n{}\n\n\
         ## 你可以执行的操作\n\
         1. **检查并报告** — 逐项检查清单，报告异常\n\
         2. **搜索信息** — 如果清单要求关注某个主题，使用 web_search 获取最新信息\n\
         3. **通知协作者** — 如果发现重要问题，可以通过 delegate_task 通知相关 Agent\n\
         4. **记录发现** — 将重要发现写入记忆 (memory_write)\n\n\
         ## 规则\n\
         - 如果一切正常，仅回复 HEARTBEAT_OK\n\
         - 如果发现问题，简洁描述并执行对应操作\n\
         - 最多执行 3 个工具调用，避免过度消耗",
        if report.scheduler_alive { "运行中" } else { "异常" },
        report.recent_failure_rate * 100.0,
        if report.high_fail_jobs.is_empty() { "无".to_string() }
            else { report.high_fail_jobs.join(", ") },
        if report.auto_disabled_jobs.is_empty() { "无".to_string() }
            else { report.auto_disabled_jobs.join(", ") },
        checklist,
    );

    // 查找可用的 agent（使用第一个 agent 或 default）
    let agents = orchestrator.list_agents().await.unwrap_or_default();
    let agent = match agents.first() {
        Some(a) => a,
        None => {
            log::warn!("LLM 心跳：无可用 Agent，跳过");
            return Ok(());
        }
    };

    // 复用心跳 session（避免会话列表膨胀）
    let hb_title = "[heartbeat]";
    let session_id: String = {
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM chat_sessions WHERE agent_id = ? AND title = ? LIMIT 1"
        )
        .bind(&agent.id).bind(hb_title)
        .fetch_optional(pool).await.ok().flatten();

        if let Some((id,)) = existing {
            let _ = sqlx::query("UPDATE chat_sessions SET last_message_at = ? WHERE id = ?")
                .bind(chrono::Utc::now().timestamp_millis()).bind(&id)
                .execute(pool).await;
            id
        } else {
            let s = crate::memory::conversation::create_session(
                pool, &agent.id, hb_title
            ).await.map_err(|e| format!("创建心跳 session 失败: {}", e))?;
            s.id
        }
    };

    // 获取 provider
    let (api_type, api_key, base_url) = load_provider(pool, &agent.model).await?;
    let base_url_opt = if base_url.is_empty() { None } else { Some(base_url.as_str()) };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let output_handle = tokio::spawn(async move {
        let mut output = String::new();
        while let Some(token) = rx.recv().await {
            output.push_str(&token);
        }
        output
    });

    orchestrator.send_message_stream(
        &agent.id, &session_id, &prompt,
        &api_key, &api_type, base_url_opt, tx, None,
    ).await?;

    let output = output_handle.await.unwrap_or_default();

    // HEARTBEAT_OK 抑制
    if config.suppress_ok && output.trim().contains("HEARTBEAT_OK") {
        log::info!("LLM 心跳: 一切正常");
        return Ok(());
    }

    // 有问题，通知前端
    log::warn!("LLM 心跳发现问题: {}", &output[..output.len().min(200)]);
    let _ = app_handle.emit_all("heartbeat-llm-alert", &serde_json::json!({
        "message": output,
        "timestamp": chrono::Utc::now().timestamp(),
    }));

    // 触发自省循环
    let wp: Option<String> = sqlx::query_scalar("SELECT workspace_path FROM agents WHERE id = ?")
        .bind(&agent.id).fetch_optional(pool).await.ok().flatten();
    if let Some(wp) = wp {
        let wp_path = PathBuf::from(&wp);
        match consciousness_loop(pool, &agent.id, &wp_path).await {
            Ok(_) => log::info!("自省循环完成"),
            Err(e) => log::warn!("自省循环失败: {}", e),
        }
    }

    Ok(())
}

/// 检查是否在静默时段
fn is_quiet_hour(config: &HeartbeatConfig) -> bool {
    let (start, end) = match (config.quiet_hours_start, config.quiet_hours_end) {
        (Some(s), Some(e)) => (s, e),
        _ => return false,
    };

    let tz: chrono_tz::Tz = config.timezone.parse().unwrap_or(chrono_tz::Asia::Shanghai);
    let local_hour = chrono::Utc::now().with_timezone(&tz).format("%H")
        .to_string().parse::<u8>().unwrap_or(0);

    if start > end {
        // 跨午夜：如 23:00 - 07:00
        local_hour >= start || local_hour < end
    } else {
        local_hour >= start && local_hour < end
    }
}

/// 4 阶段自主意识循环
///
/// 1. Review Context: 回顾最近的对话和任务
/// 2. Exploration: 检查工作区变化
/// 3. Record & Share: 记录反思到 reflections.md
/// 4. Plan Ahead: 规划下一步行动
pub async fn consciousness_loop(
    pool: &sqlx::SqlitePool,
    agent_id: &str,
    workspace_dir: &std::path::PathBuf,
) -> Result<String, String> {
    let mut reflections = Vec::new();
    let now = chrono::Utc::now();

    // Phase 1: Review Context — 回顾最近对话
    let recent_sessions = crate::memory::conversation::list_sessions(pool, agent_id)
        .await.unwrap_or_default();
    let session_count = recent_sessions.len();
    reflections.push(format!("## 回顾\n- 当前有 {} 个对话会话", session_count));

    // 获取最近的记忆
    let memories = sqlx::query_as::<_, (String, String)>(
        "SELECT memory_type, content FROM memories WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 5"
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if !memories.is_empty() {
        reflections.push(format!("- 最近 {} 条记忆已回顾", memories.len()));
    }

    // Phase 2: Exploration — 检查工作区
    let soul_files = ["IDENTITY.md", "SOUL.md", "TOOLS.md", "MEMORY.md"];
    let mut existing_files = Vec::new();
    for f in &soul_files {
        let path = workspace_dir.join(f);
        if path.exists() {
            existing_files.push(*f);
        }
    }
    reflections.push(format!("\n## 探索\n- 工作区 Soul 文件: {:?}", existing_files));

    // 检查 skills 目录
    let skills_dir = workspace_dir.join("skills");
    let skill_count = if skills_dir.exists() {
        std::fs::read_dir(&skills_dir).map(|d| d.count()).unwrap_or(0)
    } else {
        0
    };
    reflections.push(format!("- 已安装 {} 个 Skills", skill_count));

    // Phase 3: Record & Share — 写入反思日志
    let reflection_content = format!(
        "# 反思日志 - {}\n\n{}\n\n## 状态\n- 时间: {}\n- 会话数: {}\n- 记忆数: {}\n- Skills: {}\n",
        now.format("%Y-%m-%d %H:%M"),
        reflections.join("\n"),
        now.format("%Y-%m-%d %H:%M:%S UTC"),
        session_count,
        memories.len(),
        skill_count,
    );

    let reflections_path = workspace_dir.join("reflections.md");
    // 追加模式写入
    let existing = if reflections_path.exists() {
        tokio::fs::read_to_string(&reflections_path).await.unwrap_or_default()
    } else {
        String::new()
    };
    let updated = format!("{}\n---\n\n{}", existing, reflection_content);
    tokio::fs::write(&reflections_path, &updated).await
        .map_err(|e| format!("写入反思日志失败: {}", e))?;

    // Phase 4: Plan Ahead — 简单规划
    reflections.push(format!("\n## 规划\n- 继续监控对话质量\n- 定期回顾记忆一致性"));

    log::info!("Agent {} 意识循环完成: {} 个会话, {} 条记忆", agent_id, session_count, memories.len());

    Ok(reflection_content)
}

/// 从 DB 加载 provider 配置（复用 runner 的逻辑）
async fn load_provider(pool: &sqlx::SqlitePool, model: &str) -> Result<(String, String, String), String> {
    let json_str = sqlx::query_scalar::<_, Option<String>>(
        "SELECT value FROM settings WHERE key = 'providers'"
    )
    .fetch_one(pool).await
    .map_err(|e| format!("查询 providers 失败: {}", e))?
    .unwrap_or_else(|| "[]".to_string());

    let providers: Vec<serde_json::Value> = serde_json::from_str(&json_str)
        .map_err(|e| format!("解析 providers 失败: {}", e))?;

    for p in &providers {
        if p["enabled"].as_bool() != Some(true) { continue; }
        if let Some(models) = p["models"].as_array() {
            for m in models {
                if m["id"].as_str() == Some(model) {
                    let api_type = p["apiType"].as_str().unwrap_or("openai").to_string();
                    let api_key = p["apiKey"].as_str().unwrap_or("").to_string();
                    let base_url = p["baseUrl"].as_str().unwrap_or("").to_string();
                    return Ok((api_type, api_key, base_url));
                }
            }
        }
    }
    Err(format!("未找到模型 {} 对应的供应商配置", model))
}
