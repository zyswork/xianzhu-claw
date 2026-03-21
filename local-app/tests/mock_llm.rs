//! LLM Mock 层 — 不调真实 API 的测试辅助
//!
//! 提供可编程的 mock LLM 响应，用于集成测试。

use std::sync::{Arc, Mutex};

/// Mock 响应配置
#[derive(Debug, Clone)]
pub struct MockResponse {
    pub content: String,
    pub tool_calls: Vec<serde_json::Value>,
    pub stop_reason: String,
}

impl MockResponse {
    pub fn text(content: &str) -> Self {
        Self {
            content: content.to_string(),
            tool_calls: Vec::new(),
            stop_reason: "stop".to_string(),
        }
    }

    pub fn with_tool_call(mut self, name: &str, args: serde_json::Value) -> Self {
        self.tool_calls.push(serde_json::json!({
            "id": format!("call_mock_{}", self.tool_calls.len()),
            "type": "function",
            "function": {"name": name, "arguments": serde_json::to_string(&args).unwrap_or_default()}
        }));
        self.stop_reason = "tool_calls".to_string();
        self
    }
}

/// Mock LLM 服务器（用于测试）
///
/// 按顺序返回预设的响应，用完后返回默认响应
pub struct MockLlmServer {
    responses: Arc<Mutex<Vec<MockResponse>>>,
    default_response: MockResponse,
    /// 记录所有收到的请求
    pub requests: Arc<Mutex<Vec<serde_json::Value>>>,
}

impl MockLlmServer {
    pub fn new() -> Self {
        Self {
            responses: Arc::new(Mutex::new(Vec::new())),
            default_response: MockResponse::text("这是 mock 回复"),
            requests: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// 添加一个预设响应（按顺序消费）
    pub fn expect_response(&mut self, response: MockResponse) {
        self.responses.lock().unwrap().push(response);
    }

    /// 设置默认响应（预设用完后使用）
    pub fn set_default(&mut self, response: MockResponse) {
        self.default_response = response;
    }

    /// 获取下一个响应
    pub fn next_response(&self) -> MockResponse {
        let mut responses = self.responses.lock().unwrap();
        if !responses.is_empty() {
            responses.remove(0)
        } else {
            self.default_response.clone()
        }
    }

    /// 记录请求
    pub fn record_request(&self, request: serde_json::Value) {
        self.requests.lock().unwrap().push(request);
    }

    /// 获取所有请求记录
    pub fn get_requests(&self) -> Vec<serde_json::Value> {
        self.requests.lock().unwrap().clone()
    }

    /// 请求数量
    pub fn request_count(&self) -> usize {
        self.requests.lock().unwrap().len()
    }

    /// 生成 SSE 格式的响应（用于 mock HTTP server）
    pub fn to_sse_stream(response: &MockResponse) -> String {
        let mut sse = String::new();

        if !response.content.is_empty() {
            // 文本内容分 chunk 发送
            let chunks: Vec<&str> = response.content.as_bytes()
                .chunks(20)
                .map(|c| std::str::from_utf8(c).unwrap_or(""))
                .collect();
            for chunk in chunks {
                sse.push_str(&format!(
                    "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{}\"}},\"finish_reason\":null}}]}}\n\n",
                    chunk.replace('"', "\\\"").replace('\n', "\\n")
                ));
            }
        }

        if !response.tool_calls.is_empty() {
            for (i, tc) in response.tool_calls.iter().enumerate() {
                sse.push_str(&format!(
                    "data: {{\"choices\":[{{\"delta\":{{\"tool_calls\":[{{\"index\":{},\"id\":\"{}\",\"function\":{{\"name\":\"{}\",\"arguments\":\"{}\"}}}}]}},\"finish_reason\":null}}]}}\n\n",
                    i,
                    tc["id"].as_str().unwrap_or(""),
                    tc["function"]["name"].as_str().unwrap_or(""),
                    tc["function"]["arguments"].as_str().unwrap_or("{}").replace('"', "\\\""),
                ));
            }
        }

        // finish
        sse.push_str(&format!(
            "data: {{\"choices\":[{{\"delta\":{{}},\"finish_reason\":\"{}\"}}]}}\n\n",
            response.stop_reason
        ));
        sse.push_str("data: [DONE]\n\n");
        sse
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mock_server_sequential() {
        let mut server = MockLlmServer::new();
        server.expect_response(MockResponse::text("第一个回复"));
        server.expect_response(MockResponse::text("第二个回复"));

        assert_eq!(server.next_response().content, "第一个回复");
        assert_eq!(server.next_response().content, "第二个回复");
        // 预设用完，返回默认
        assert_eq!(server.next_response().content, "这是 mock 回复");
    }

    #[test]
    fn test_mock_tool_call() {
        let resp = MockResponse::text("")
            .with_tool_call("calculator", serde_json::json!({"expression": "1+1"}));
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.stop_reason, "tool_calls");
    }

    #[test]
    fn test_sse_stream_text() {
        let resp = MockResponse::text("hello");
        let sse = MockLlmServer::to_sse_stream(&resp);
        assert!(sse.contains("hello"));
        assert!(sse.contains("[DONE]"));
    }

    #[test]
    fn test_sse_stream_tool() {
        let resp = MockResponse::text("").with_tool_call("calc", serde_json::json!({}));
        let sse = MockLlmServer::to_sse_stream(&resp);
        assert!(sse.contains("calc"));
        assert!(sse.contains("tool_calls"));
    }

    #[test]
    fn test_request_recording() {
        let server = MockLlmServer::new();
        server.record_request(serde_json::json!({"model": "test"}));
        server.record_request(serde_json::json!({"model": "test2"}));
        assert_eq!(server.request_count(), 2);
    }
}
