//! 知识蒸馏 — 从高频记忆提取行为规则
//!
//! 定期分析高优先级/高访问量的记忆，提取通用规则，
//! 追加到 STANDING_ORDERS.md（让 Agent 行为持续优化）。

use sqlx::SqlitePool;

/// 蒸馏结果
#[derive(Debug, Clone)]
pub struct DistillationResult {
    /// 提取到的规则
    pub rules: Vec<String>,
    /// 分析的记忆数
    pub analyzed_count: usize,
}

/// 从记忆中蒸馏规则
///
/// 分析条件：
/// - 高优先级（>= 2）或高访问量（>= 3）的记忆
/// - learned 类型优先
/// - 至少有 5 条合格记忆才蒸馏
pub async fn distill_rules(
    pool: &SqlitePool,
    agent_id: &str,
) -> DistillationResult {
    // 查询高价值记忆
    let memories: Vec<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT content, COALESCE(category, ''), COALESCE(priority, 1), COALESCE(access_count, 0) FROM memories WHERE agent_id = ? AND (priority >= 2 OR access_count >= 3) ORDER BY access_count DESC, priority DESC LIMIT 50"
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if memories.len() < 5 {
        return DistillationResult { rules: vec![], analyzed_count: memories.len() };
    }

    let mut rules = Vec::new();

    // 从用户偏好记忆中提取规则
    let preferences: Vec<&str> = memories.iter()
        .filter(|(_, cat, _, _)| cat == "user_preference")
        .map(|(content, _, _, _)| content.as_str())
        .collect();
    if preferences.len() >= 2 {
        // 有多条用户偏好 → 合并为规则
        let combined: String = preferences.iter().take(5)
            .map(|p| format!("- {}", p.replace("用户偏好: ", "")))
            .collect::<Vec<_>>()
            .join("\n");
        rules.push(format!("### 用户偏好\n{}", combined));
    }

    // 从代码规范记忆中提取
    let conventions: Vec<&str> = memories.iter()
        .filter(|(_, cat, _, _)| cat == "code_convention")
        .map(|(content, _, _, _)| content.as_str())
        .collect();
    if !conventions.is_empty() {
        let combined: String = conventions.iter().take(5)
            .map(|c| format!("- {}", c))
            .collect::<Vec<_>>()
            .join("\n");
        rules.push(format!("### 代码规范\n{}", combined));
    }

    // 从修复经验中提取"避免"规则
    let fixes: Vec<&str> = memories.iter()
        .filter(|(_, cat, _, _)| cat == "fix_pattern")
        .map(|(content, _, _, _)| content.as_str())
        .collect();
    if fixes.len() >= 2 {
        let combined: String = fixes.iter().take(3)
            .map(|f| format!("- {}", f))
            .collect::<Vec<_>>()
            .join("\n");
        rules.push(format!("### 常见问题\n{}", combined));
    }

    // 从工具模式中提取最佳实践
    let patterns: Vec<&str> = memories.iter()
        .filter(|(_, cat, _, _)| cat == "tool_pattern")
        .filter(|(_, _, _, access)| *access >= 3) // 只取高频工具模式
        .map(|(content, _, _, _)| content.as_str())
        .collect();
    if !patterns.is_empty() {
        let combined: String = patterns.iter().take(3)
            .map(|p| format!("- {}", p))
            .collect::<Vec<_>>()
            .join("\n");
        rules.push(format!("### 工具最佳实践\n{}", combined));
    }

    DistillationResult { rules, analyzed_count: memories.len() }
}

/// 将蒸馏的规则追加到 STANDING_ORDERS.md
pub fn append_to_standing_orders(workspace_path: &str, rules: &[String]) -> Result<(), String> {
    let path = std::path::Path::new(workspace_path).join("STANDING_ORDERS.md");
    let mut content = std::fs::read_to_string(&path).unwrap_or_default();

    let marker = "## Auto-Learned Rules";
    // 如果已有 auto-learned section，替换它
    if let Some(pos) = content.find(marker) {
        content.truncate(pos);
    }

    content.push_str(&format!("\n{}\n", marker));
    content.push_str(&format!("> 自动从经验中蒸馏，更新于 {}\n\n", chrono::Utc::now().format("%Y-%m-%d")));
    for rule in rules {
        content.push_str(rule);
        content.push_str("\n\n");
    }

    std::fs::write(&path, &content)
        .map_err(|e| format!("写入 STANDING_ORDERS.md 失败: {}", e))?;

    log::info!("distillation: 已更新 STANDING_ORDERS.md ({} 条规则)", rules.len());
    Ok(())
}
