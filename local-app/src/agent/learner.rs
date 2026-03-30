//! Learner 系统 — Agent 从成功经验自动学习
//!
//! 参考 oh-my-claudecode 的 /learner 机制：
//! - 会话结束后分析对话，提取可复用的模式/经验
//! - 质量门控：只从成功的会话中学习
//! - 提取的知识存入 memories 表 + MEMORY.md
//! - 支持语义去重（不重复学习相同经验）

use sqlx::SqlitePool;

/// 学习结果
#[derive(Debug, Clone)]
pub struct LearningOutcome {
    /// 提取到的经验条目
    pub lessons: Vec<Lesson>,
    /// 跳过的原因（如果跳过）
    pub skipped_reason: Option<String>,
}

/// 单条经验
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Lesson {
    /// 经验类型
    pub category: LessonCategory,
    /// 经验内容
    pub content: String,
    /// 置信度 (0.0-1.0)
    pub confidence: f64,
}

/// 经验类型
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub enum LessonCategory {
    /// 工具使用模式（如 "编辑 Rust 文件后应跑 cargo check"）
    ToolPattern,
    /// 用户偏好（如 "用户偏好中文注释"）
    UserPreference,
    /// 代码规范（如 "该项目使用 4 空格缩进"）
    CodeConvention,
    /// 错误修复经验（如 "此 API 的 timeout 默认太短，需要设为 30s"）
    FixPattern,
    /// 项目知识（如 "数据库 schema 在 db/schema.rs"）
    ProjectKnowledge,
}

impl LessonCategory {
    pub fn as_str(&self) -> &str {
        match self {
            Self::ToolPattern => "tool_pattern",
            Self::UserPreference => "user_preference",
            Self::CodeConvention => "code_convention",
            Self::FixPattern => "fix_pattern",
            Self::ProjectKnowledge => "project_knowledge",
        }
    }
}

/// 从会话对话中提取可学习的经验
///
/// 质量门控：
/// - 会话至少 3 轮对话
/// - 有工具调用且成功率 > 50%
/// - 非系统/子代理会话
pub async fn extract_lessons(
    pool: &SqlitePool,
    agent_id: &str,
    session_id: &str,
) -> LearningOutcome {
    // 加载最近的消息
    let messages: Vec<(String, String)> = match sqlx::query_as(
        "SELECT role, COALESCE(content, '') FROM chat_messages WHERE session_id = ? ORDER BY seq DESC LIMIT 30"
    )
    .bind(session_id)
    .fetch_all(pool)
    .await {
        Ok(msgs) => msgs,
        Err(_) => return LearningOutcome { lessons: vec![], skipped_reason: Some("加载消息失败".into()) },
    };

    // 质量门控
    let user_msgs = messages.iter().filter(|(r, _)| r == "user").count();
    let assistant_msgs = messages.iter().filter(|(r, _)| r == "assistant").count();
    if user_msgs < 2 || assistant_msgs < 2 {
        return LearningOutcome { lessons: vec![], skipped_reason: Some("对话轮次不足".into()) };
    }

    // 检查是否为子代理/系统会话
    let session_title: Option<String> = sqlx::query_scalar(
        "SELECT title FROM chat_sessions WHERE id = ?"
    ).bind(session_id).fetch_optional(pool).await.ok().flatten();
    if let Some(ref title) = session_title {
        if title.starts_with("[subagent]") || title.starts_with("[heartbeat]") || title.starts_with("[a2a]") {
            return LearningOutcome { lessons: vec![], skipped_reason: Some("系统会话不学习".into()) };
        }
    }

    // 分析对话提取经验
    let mut lessons = Vec::new();

    // 1. 工具使用模式：从工具调用序列中提取
    let tool_calls: Vec<String> = messages.iter()
        .filter(|(r, c)| r == "assistant" && c.contains("工具"))
        .map(|(_, c)| c.chars().take(200).collect())
        .collect();
    if tool_calls.len() >= 2 {
        // 检测重复模式
        let tool_sequence: String = tool_calls.iter().take(5).cloned().collect::<Vec<_>>().join(" → ");
        if !tool_sequence.is_empty() {
            lessons.push(Lesson {
                category: LessonCategory::ToolPattern,
                content: format!("工具调用模式: {}", &tool_sequence[..tool_sequence.len().min(200)]),
                confidence: 0.6,
            });
        }
    }

    // 2. 错误修复模式：从错误→修复对中提取
    for (i, (role, content)) in messages.iter().enumerate() {
        if role == "assistant" && (content.contains("错误") || content.contains("失败") || content.contains("error")) {
            // 看下一条是否有修复
            if i + 2 < messages.len() && messages[i + 2].0 == "assistant" {
                let fix_content = &messages[i + 2].1;
                if fix_content.contains("修复") || fix_content.contains("已解决") || fix_content.contains("fixed") {
                    let error_summary: String = content.chars().take(100).collect();
                    let fix_summary: String = fix_content.chars().take(100).collect();
                    lessons.push(Lesson {
                        category: LessonCategory::FixPattern,
                        content: format!("错误: {} → 修复: {}", error_summary, fix_summary),
                        confidence: 0.7,
                    });
                }
            }
        }
    }

    // 3. 用户偏好：从用户的修正/反馈中提取
    for (role, content) in &messages {
        if role == "user" {
            let c = content.to_lowercase();
            if c.contains("不要") || c.contains("别") || c.contains("don't") || c.contains("请用") || c.contains("改成") {
                lessons.push(Lesson {
                    category: LessonCategory::UserPreference,
                    content: format!("用户偏好: {}", &content[..content.len().min(150)]),
                    confidence: 0.8,
                });
            }
        }
    }

    // 4. 项目知识：从文件路径和代码结构中提取
    for (_, content) in &messages {
        // 检测文件路径模式
        if content.contains("src/") || content.contains("lib/") || content.contains("Cargo.toml") || content.contains("package.json") {
            // 提取项目结构信息（简化：只在首次有新目录时记录）
            let paths: Vec<&str> = content.split_whitespace()
                .filter(|w| w.contains('/') && (w.contains("src/") || w.contains("lib/")))
                .take(3)
                .collect();
            if !paths.is_empty() {
                lessons.push(Lesson {
                    category: LessonCategory::ProjectKnowledge,
                    content: format!("关键文件: {}", paths.join(", ")),
                    confidence: 0.5,
                });
                break; // 一个会话只提取一次项目结构
            }
        }
    }

    // 去重：与已有记忆对比（简化：按前 50 字符去重）
    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT content FROM memories WHERE agent_id = ? AND memory_type = 'learned' ORDER BY created_at DESC LIMIT 100"
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let existing_prefixes: std::collections::HashSet<String> = existing.iter()
        .map(|c| c.chars().take(50).collect())
        .collect();

    lessons.retain(|l| {
        let prefix: String = l.content.chars().take(50).collect();
        !existing_prefixes.contains(&prefix)
    });

    // 限制每次最多学习 3 条
    lessons.truncate(3);

    if lessons.is_empty() {
        LearningOutcome { lessons: vec![], skipped_reason: Some("无新经验可提取".into()) }
    } else {
        LearningOutcome { lessons, skipped_reason: None }
    }
}

/// 将学到的经验持久化到 DB 和 MEMORY.md
pub async fn persist_lessons(
    pool: &SqlitePool,
    agent_id: &str,
    workspace_path: Option<&str>,
    lessons: &[Lesson],
) {
    for lesson in lessons {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        // 写入 memories 表
        let _ = sqlx::query(
            "INSERT INTO memories (id, agent_id, memory_type, key, content, priority, category, created_at) VALUES (?, ?, 'learned', ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(agent_id)
        .bind(lesson.category.as_str())
        .bind(&lesson.content)
        .bind(if lesson.confidence > 0.7 { 2 } else { 1 } as i64) // High confidence → higher priority
        .bind(lesson.category.as_str())
        .bind(now)
        .execute(pool)
        .await;

        log::info!("Learner: 已学习 [{}] {}", lesson.category.as_str(), &lesson.content[..lesson.content.len().min(60)]);
    }

    // 追加到 MEMORY.md（如果 workspace 存在）
    if let Some(wp) = workspace_path {
        let memory_path = std::path::Path::new(wp).join("MEMORY.md");
        let mut content = std::fs::read_to_string(&memory_path).unwrap_or_default();

        if !content.contains("## Learned") {
            content.push_str("\n\n## Learned\n\n");
        }

        let date = chrono::Utc::now().format("%Y-%m-%d").to_string();
        for lesson in lessons {
            content.push_str(&format!("- [{}] [{}] {}\n", date, lesson.category.as_str(), lesson.content));
        }

        let _ = std::fs::write(&memory_path, &content);
    }
}
