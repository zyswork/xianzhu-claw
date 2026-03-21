//! 工具调用分发器
//!
//! 解析 LLM 响应中的工具调用，格式化工具结果
//! 支持 OpenAI/Anthropic 原生格式和国产模型 XML 格式

use super::tools::ParsedToolCall;
use serde_json::Value;

/// 工具调用分发器特征
pub trait ToolDispatcher: Send + Sync {
    /// 从 LLM 响应中解析工具调用
    fn parse_tool_calls(&self, response: &Value) -> Vec<ParsedToolCall>;

    /// 格式化工具执行结果为 LLM 可理解的消息
    fn format_tool_result(&self, call_id: &str, name: &str, result: &str) -> Value;
}

// ─── NativeDispatcher ───────────────────────────────────────

/// 原生 API 分发器（OpenAI / Anthropic）
pub struct NativeDispatcher {
    provider: String,
}

impl NativeDispatcher {
    pub fn new(provider: &str) -> Self {
        Self {
            provider: provider.to_string(),
        }
    }

    /// 解析 OpenAI 格式的工具调用
    /// choices[0].message.tool_calls[]: { id, function: { name, arguments } }
    fn parse_openai(&self, response: &Value) -> Vec<ParsedToolCall> {
        let mut calls = Vec::new();
        if let Some(tool_calls) = response
            .pointer("/choices/0/message/tool_calls")
            .and_then(|v| v.as_array())
        {
            for tc in tool_calls {
                let id = tc["id"].as_str().unwrap_or("").to_string();
                let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                let arguments = serde_json::from_str(args_str).unwrap_or(Value::Object(Default::default()));
                if !name.is_empty() {
                    calls.push(ParsedToolCall { id, name, arguments });
                }
            }
        }
        calls
    }

    /// 解析 Anthropic 格式的工具调用
    /// content[]: { type: "tool_use", id, name, input }
    fn parse_anthropic(&self, response: &Value) -> Vec<ParsedToolCall> {
        let mut calls = Vec::new();
        if let Some(content) = response.get("content").and_then(|v| v.as_array()) {
            for block in content {
                if block["type"].as_str() == Some("tool_use") {
                    let id = block["id"].as_str().unwrap_or("").to_string();
                    let name = block["name"].as_str().unwrap_or("").to_string();
                    let arguments = block["input"].clone();
                    if !name.is_empty() {
                        calls.push(ParsedToolCall { id, name, arguments });
                    }
                }
            }
        }
        calls
    }
}

impl ToolDispatcher for NativeDispatcher {
    fn parse_tool_calls(&self, response: &Value) -> Vec<ParsedToolCall> {
        match self.provider.as_str() {
            "anthropic" => self.parse_anthropic(response),
            _ => self.parse_openai(response),
        }
    }

    fn format_tool_result(&self, call_id: &str, name: &str, result: &str) -> Value {
        match self.provider.as_str() {
            "anthropic" => serde_json::json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": result
                }]
            }),
            _ => serde_json::json!({
                "role": "tool",
                "tool_call_id": call_id,
                "name": name,
                "content": result
            }),
        }
    }
}

// ─── XmlDispatcher ──────────────────────────────────────────

/// XML 格式分发器（国产模型如 DeepSeek、Qwen 等）
///
/// 解析格式：
/// ```xml
/// <tool_call><name>calculator</name><arguments>{"expression":"1+1"}</arguments></tool_call>
/// ```
/// 自动剥离 `<think>...</think>` 块
pub struct XmlDispatcher;

impl XmlDispatcher {
    pub fn new() -> Self {
        Self
    }

    /// 从文本中剥离 <think>...</think> 块
    fn strip_think_blocks(text: &str) -> String {
        let mut result = String::new();
        let mut remaining = text;
        while let Some(start) = remaining.find("<think>") {
            result.push_str(&remaining[..start]);
            if let Some(end) = remaining[start..].find("</think>") {
                remaining = &remaining[start + end + 8..];
            } else {
                // 未闭合的 think 块，丢弃剩余
                return result;
            }
        }
        result.push_str(remaining);
        result
    }

    /// 从文本中提取所有 <tool_call>...</tool_call> 块
    fn extract_tool_calls(text: &str) -> Vec<ParsedToolCall> {
        let mut calls = Vec::new();
        let mut remaining = text;
        let mut idx = 0;

        while let Some(start) = remaining.find("<tool_call>") {
            if let Some(end) = remaining[start..].find("</tool_call>") {
                let block = &remaining[start + 11..start + end];
                if let Some(call) = Self::parse_single_xml(block, idx) {
                    calls.push(call);
                    idx += 1;
                }
                remaining = &remaining[start + end + 12..];
            } else {
                break;
            }
        }
        calls
    }

    /// 解析单个 tool_call XML 块
    fn parse_single_xml(block: &str, idx: usize) -> Option<ParsedToolCall> {
        let name = Self::extract_xml_tag(block, "name")?;
        let args_str = Self::extract_xml_tag(block, "arguments").unwrap_or_default();
        let arguments = serde_json::from_str(&args_str)
            .unwrap_or(Value::Object(Default::default()));

        Some(ParsedToolCall {
            id: format!("xml_call_{}", idx),
            name,
            arguments,
        })
    }

    /// 提取 XML 标签内容
    fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        let start = text.find(&open)? + open.len();
        let end = text[start..].find(&close)? + start;
        Some(text[start..end].trim().to_string())
    }
}

impl ToolDispatcher for XmlDispatcher {
    fn parse_tool_calls(&self, response: &Value) -> Vec<ParsedToolCall> {
        // 从响应文本中解析
        let text = if let Some(s) = response.as_str() {
            s.to_string()
        } else if let Some(s) = response.get("content").and_then(|v| v.as_str()) {
            s.to_string()
        } else if let Some(arr) = response.get("content").and_then(|v| v.as_array()) {
            // Anthropic 风格的 content 数组
            arr.iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        } else {
            return Vec::new();
        };

        let cleaned = Self::strip_think_blocks(&text);
        Self::extract_tool_calls(&cleaned)
    }

    fn format_tool_result(&self, _call_id: &str, name: &str, result: &str) -> Value {
        // XML 模式下作为 user 消息返回，内容用 XML 格式包裹
        serde_json::json!({
            "role": "user",
            "content": format!("<tool_result><name>{}</name><output>{}</output></tool_result>", name, result)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── NativeDispatcher OpenAI 测试 ───

    #[test]
    fn test_openai_parse_tool_calls() {
        let dispatcher = NativeDispatcher::new("openai");
        let response = serde_json::json!({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "call_abc123",
                        "type": "function",
                        "function": {
                            "name": "calculator",
                            "arguments": "{\"expression\":\"1+1\"}"
                        }
                    }]
                }
            }]
        });
        let calls = dispatcher.parse_tool_calls(&response);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_abc123");
        assert_eq!(calls[0].name, "calculator");
        assert_eq!(calls[0].arguments["expression"], "1+1");
    }

    #[test]
    fn test_openai_format_result() {
        let dispatcher = NativeDispatcher::new("openai");
        let result = dispatcher.format_tool_result("call_abc", "calculator", "42");
        assert_eq!(result["role"], "tool");
        assert_eq!(result["tool_call_id"], "call_abc");
        assert_eq!(result["content"], "42");
    }

    // ─── NativeDispatcher Anthropic 测试 ───

    #[test]
    fn test_anthropic_parse_tool_calls() {
        let dispatcher = NativeDispatcher::new("anthropic");
        let response = serde_json::json!({
            "content": [
                {"type": "text", "text": "让我计算一下"},
                {
                    "type": "tool_use",
                    "id": "toolu_01A",
                    "name": "calculator",
                    "input": {"expression": "2+3"}
                }
            ]
        });
        let calls = dispatcher.parse_tool_calls(&response);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "toolu_01A");
        assert_eq!(calls[0].name, "calculator");
        assert_eq!(calls[0].arguments["expression"], "2+3");
    }

    #[test]
    fn test_anthropic_format_result() {
        let dispatcher = NativeDispatcher::new("anthropic");
        let result = dispatcher.format_tool_result("toolu_01A", "calculator", "5");
        assert_eq!(result["role"], "user");
        let content = result["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "tool_result");
        assert_eq!(content[0]["tool_use_id"], "toolu_01A");
        assert_eq!(content[0]["content"], "5");
    }

    #[test]
    fn test_openai_empty_response() {
        let dispatcher = NativeDispatcher::new("openai");
        let response = serde_json::json!({"choices": [{"message": {"content": "hello"}}]});
        let calls = dispatcher.parse_tool_calls(&response);
        assert!(calls.is_empty());
    }

    // ─── XmlDispatcher 测试 ───

    #[test]
    fn test_xml_parse_tool_calls() {
        let dispatcher = XmlDispatcher::new();
        let text = r#"<tool_call><name>calculator</name><arguments>{"expression":"1+1"}</arguments></tool_call>"#;
        let response = Value::String(text.to_string());
        let calls = dispatcher.parse_tool_calls(&response);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "calculator");
        assert_eq!(calls[0].arguments["expression"], "1+1");
    }

    #[test]
    fn test_xml_strip_think_blocks() {
        let text = "<think>我需要计算</think>好的，让我帮你算<tool_call><name>calculator</name><arguments>{}</arguments></tool_call>";
        let cleaned = XmlDispatcher::strip_think_blocks(text);
        assert!(!cleaned.contains("<think>"));
        assert!(cleaned.contains("<tool_call>"));
    }

    #[test]
    fn test_xml_multiple_tool_calls() {
        let dispatcher = XmlDispatcher::new();
        let text = r#"<tool_call><name>calculator</name><arguments>{"expression":"1+1"}</arguments></tool_call>然后<tool_call><name>datetime</name><arguments>{}</arguments></tool_call>"#;
        let response = Value::String(text.to_string());
        let calls = dispatcher.parse_tool_calls(&response);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "calculator");
        assert_eq!(calls[1].name, "datetime");
    }

    #[test]
    fn test_xml_format_result() {
        let dispatcher = XmlDispatcher::new();
        let result = dispatcher.format_tool_result("", "calculator", "42");
        assert_eq!(result["role"], "user");
        let content = result["content"].as_str().unwrap();
        assert!(content.contains("<tool_result>"));
        assert!(content.contains("<name>calculator</name>"));
        assert!(content.contains("<output>42</output>"));
    }
}
