//! 智能路由 — 基于消息复杂度自动选择模型
//!
//! 分析用户消息的多个维度，评估复杂度分数，
//! 简单问题用便宜模型，复杂问题用强模型。
//! 借鉴 IronClaw 的 13 维复杂度评分策略。

/// 复杂度评分结果
#[derive(Debug, Clone)]
pub struct ComplexityScore {
    /// 总分（0.0 ~ 1.0）
    pub score: f64,
    /// 推荐模型层级
    pub tier: ModelTier,
    /// 各维度得分明细
    pub dimensions: Vec<(String, f64)>,
}

/// 模型层级
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ModelTier {
    /// 简单任务（闲聊、翻译、简单问答）→ 便宜快速模型
    Light,
    /// 中等任务（代码生成、分析、多步推理）→ 标准模型
    Standard,
    /// 复杂任务（架构设计、长文创作、数学证明）→ 最强模型
    Heavy,
}

/// 模型路由配置
#[derive(Debug, Clone)]
pub struct RouterConfig {
    /// Light 层级模型（如 gpt-4o-mini, claude-haiku）
    pub light_model: Option<String>,
    /// Standard 层级模型（Agent 默认模型）
    pub standard_model: String,
    /// Heavy 层级模型（如 gpt-4o, claude-sonnet）
    pub heavy_model: Option<String>,
    /// Light 阈值（低于此分数用 Light 模型）
    pub light_threshold: f64,
    /// Heavy 阈值（高于此分数用 Heavy 模型）
    pub heavy_threshold: f64,
}

impl RouterConfig {
    /// 从 Agent 配置 JSON 解析路由配置
    pub fn from_agent_config(default_model: &str, config_json: Option<&str>) -> Self {
        let mut cfg = Self {
            light_model: None,
            standard_model: default_model.to_string(),
            heavy_model: None,
            light_threshold: 0.3,
            heavy_threshold: 0.7,
        };

        if let Some(json_str) = config_json {
            if let Ok(config) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(router) = config.get("router") {
                    if let Some(m) = router.get("lightModel").and_then(|v| v.as_str()) {
                        cfg.light_model = Some(m.to_string());
                    }
                    if let Some(m) = router.get("heavyModel").and_then(|v| v.as_str()) {
                        cfg.heavy_model = Some(m.to_string());
                    }
                    if let Some(t) = router.get("lightThreshold").and_then(|v| v.as_f64()) {
                        cfg.light_threshold = t;
                    }
                    if let Some(t) = router.get("heavyThreshold").and_then(|v| v.as_f64()) {
                        cfg.heavy_threshold = t;
                    }
                }
            }
        }

        cfg
    }

    /// 是否配置了路由（有 light 或 heavy 模型）
    pub fn is_enabled(&self) -> bool {
        self.light_model.is_some() || self.heavy_model.is_some()
    }
}

/// 评估消息复杂度
pub fn score_complexity(message: &str, tool_count: usize, history_len: usize) -> ComplexityScore {
    let mut dims: Vec<(String, f64)> = Vec::new();
    let chars = message.chars().count();

    // 1. 消息长度（长消息通常更复杂）
    let length_score = (chars as f64 / 500.0).min(1.0);
    dims.push(("length".into(), length_score));

    // 2. 代码标记（含代码块、函数名等）
    let code_markers = ["```", "def ", "fn ", "class ", "import ", "function ", "const ", "let ", "var "];
    let code_score = if code_markers.iter().any(|m| message.contains(m)) { 0.8 } else { 0.0 };
    dims.push(("code".into(), code_score));

    // 3. 技术术语密度
    let tech_terms = ["算法", "架构", "数据库", "并发", "异步", "API", "性能", "优化",
        "algorithm", "architecture", "database", "concurrent", "async", "performance"];
    let tech_count = tech_terms.iter().filter(|t| message.contains(*t)).count();
    let tech_score = (tech_count as f64 / 3.0).min(1.0);
    dims.push(("technical".into(), tech_score));

    // 4. 多步指令（"首先...然后...最后"）
    let step_markers = ["首先", "然后", "接着", "最后", "第一", "第二", "step 1", "step 2", "first", "then", "finally"];
    let step_count = step_markers.iter().filter(|m| message.contains(*m)).count();
    let step_score = (step_count as f64 / 2.0).min(1.0);
    dims.push(("multi_step".into(), step_score));

    // 5. 创作/分析请求
    let creative_markers = ["写一篇", "分析", "设计", "比较", "评估", "总结",
        "write", "analyze", "design", "compare", "evaluate", "summarize"];
    let creative_score = if creative_markers.iter().any(|m| message.contains(m)) { 0.6 } else { 0.0 };
    dims.push(("creative".into(), creative_score));

    // 6. 数学/逻辑
    let math_markers = ["证明", "推导", "计算", "公式", "方程", "prove", "derive", "equation"];
    let math_score = if math_markers.iter().any(|m| message.contains(m)) { 0.9 } else { 0.0 };
    dims.push(("math".into(), math_score));

    // 7. 工具依赖程度
    let tool_score = if tool_count > 5 { 0.5 } else { tool_count as f64 / 10.0 };
    dims.push(("tools".into(), tool_score));

    // 8. 对话深度（长对话后续通常更复杂）
    let depth_score = (history_len as f64 / 20.0).min(0.5);
    dims.push(("depth".into(), depth_score));

    // 9. 问号数量（多问题 = 更复杂）
    let question_count = message.matches('？').count() + message.matches('?').count();
    let question_score = (question_count as f64 / 3.0).min(1.0);
    dims.push(("questions".into(), question_score));

    // 加权平均
    let weights = [0.10, 0.15, 0.15, 0.12, 0.10, 0.13, 0.08, 0.07, 0.10];
    let total: f64 = dims.iter().zip(weights.iter())
        .map(|((_, s), w)| s * w)
        .sum();

    let tier = if total < 0.3 {
        ModelTier::Light
    } else if total > 0.7 {
        ModelTier::Heavy
    } else {
        ModelTier::Standard
    };

    ComplexityScore { score: total, tier, dimensions: dims }
}

/// 根据复杂度选择模型
pub fn select_model(config: &RouterConfig, complexity: &ComplexityScore) -> String {
    match complexity.tier {
        ModelTier::Light => {
            if let Some(ref m) = config.light_model {
                if complexity.score < config.light_threshold {
                    log::info!("智能路由: score={:.2} → Light 模型 {}", complexity.score, m);
                    return m.clone();
                }
            }
            config.standard_model.clone()
        }
        ModelTier::Heavy => {
            if let Some(ref m) = config.heavy_model {
                if complexity.score > config.heavy_threshold {
                    log::info!("智能路由: score={:.2} → Heavy 模型 {}", complexity.score, m);
                    return m.clone();
                }
            }
            config.standard_model.clone()
        }
        ModelTier::Standard => {
            config.standard_model.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_message() {
        let score = score_complexity("你好", 0, 0);
        assert!(score.score < 0.3);
        assert_eq!(score.tier, ModelTier::Light);
    }

    #[test]
    fn test_complex_message() {
        let score = score_complexity(
            "请分析这个算法的时间复杂度，首先证明其正确性，然后推导最坏情况下的性能边界，最后给出优化建议",
            5, 10
        );
        assert!(score.score > 0.5);
    }

    #[test]
    fn test_code_message() {
        let score = score_complexity("```rust\nfn main() { println!(\"hello\"); }\n```\n请分析并优化这段代码的性能", 3, 5);
        assert!(score.score > 0.2); // 代码+性能关键词
    }

    #[test]
    fn test_select_model_light() {
        let config = RouterConfig {
            light_model: Some("gpt-4o-mini".into()),
            standard_model: "gpt-4o".into(),
            heavy_model: Some("claude-opus".into()),
            light_threshold: 0.3,
            heavy_threshold: 0.7,
        };
        let score = score_complexity("你好", 0, 0);
        let model = select_model(&config, &score);
        assert_eq!(model, "gpt-4o-mini");
    }

    #[test]
    fn test_select_model_no_router() {
        let config = RouterConfig {
            light_model: None,
            standard_model: "gpt-4o".into(),
            heavy_model: None,
            light_threshold: 0.3,
            heavy_threshold: 0.7,
        };
        let score = score_complexity("你好", 0, 0);
        let model = select_model(&config, &score);
        assert_eq!(model, "gpt-4o");
    }
}
