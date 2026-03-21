//! 集成测试 — 端到端验证核心流程
//!
//! 使用内存 SQLite + Mock LLM 测试完整的 Agent 流程。

mod mock_llm;

use mock_llm::{MockLlmServer, MockResponse};

/// 辅助：创建内存 SQLite 连接池 + 初始化 schema
async fn setup_db() -> sqlx::SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .connect("sqlite::memory:")
        .await
        .unwrap();
    // 手动初始化所有表（不依赖 main 模块）
    sqlx::query("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT NOT NULL, model TEXT NOT NULL, temperature REAL, max_tokens INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, config TEXT, workspace_path TEXT, config_version INTEGER DEFAULT 1)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, memory_type TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 1)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(content, agent_id UNINDEXED, memory_id UNINDEXED)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, content TEXT NOT NULL, embedding BLOB NOT NULL, created_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New Session', created_at INTEGER NOT NULL, last_message_at INTEGER, summary TEXT)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT NOT NULL, user_message TEXT NOT NULL, agent_response TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, metadata TEXT, session_id TEXT)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_calls_json TEXT, tool_call_id TEXT, tool_name TEXT, seq INTEGER NOT NULL, created_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS response_cache (cache_key TEXT PRIMARY KEY, model TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 1)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS token_usage (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS embedding_cache (content_hash TEXT PRIMARY KEY, embedding BLOB NOT NULL, model TEXT NOT NULL, accessed_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS tool_audit_log (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments TEXT NOT NULL, result TEXT, success INTEGER NOT NULL DEFAULT 1, policy_decision TEXT NOT NULL, policy_source TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();

    pool
}

/// 辅助：创建测试 Agent
async fn create_test_agent(pool: &sqlx::SqlitePool) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO agents (id, name, system_prompt, model, temperature, max_tokens, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id).bind("TestBot").bind("你是测试助手").bind("gpt-4o-mini")
    .bind(0.7).bind(2048).bind(now).bind(now)
    .execute(pool).await.unwrap();
    id
}

/// 辅助：创建测试会话
async fn create_test_session(pool: &sqlx::SqlitePool, agent_id: &str) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query(
        "INSERT INTO chat_sessions (id, agent_id, title, created_at) VALUES (?, ?, ?, ?)"
    )
    .bind(&id).bind(agent_id).bind("Test Session").bind(now)
    .execute(pool).await.unwrap();
    id
}

// ─── 测试用例 ──────────────────────────────────────────

#[tokio::test]
async fn test_mock_llm_basic() {
    let mut server = MockLlmServer::new();
    server.expect_response(MockResponse::text("你好！我是测试助手。"));

    let resp = server.next_response();
    assert_eq!(resp.content, "你好！我是测试助手。");
    assert_eq!(resp.stop_reason, "stop");
    assert!(resp.tool_calls.is_empty());
}

#[tokio::test]
async fn test_mock_llm_tool_call_flow() {
    let mut server = MockLlmServer::new();

    // 第一轮：LLM 决定调用工具
    server.expect_response(
        MockResponse::text("")
            .with_tool_call("calculator", serde_json::json!({"expression": "2+2"}))
    );
    // 第二轮：LLM 返回最终回复
    server.expect_response(MockResponse::text("计算结果是 4。"));

    let r1 = server.next_response();
    assert_eq!(r1.tool_calls.len(), 1);
    assert_eq!(r1.stop_reason, "tool_calls");

    let r2 = server.next_response();
    assert_eq!(r2.content, "计算结果是 4。");
}

#[tokio::test]
async fn test_db_session_lifecycle() {
    let pool = setup_db().await;
    let agent_id = create_test_agent(&pool).await;
    let session_id = create_test_session(&pool, &agent_id).await;

    // 保存消息
    let msg = serde_json::json!({"role": "user", "content": "hello"});
    let row_id = sqlx::query_scalar::<_, String>(
        "SELECT ? as id"
    ).bind(uuid::Uuid::new_v4().to_string())
    .fetch_one(&pool).await.unwrap();

    sqlx::query(
        "INSERT INTO chat_messages (id, session_id, agent_id, role, content, seq, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)"
    )
    .bind(&row_id).bind(&session_id).bind(&agent_id).bind("user").bind("hello")
    .bind(chrono::Utc::now().timestamp_millis())
    .execute(&pool).await.unwrap();

    // 查询
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_messages WHERE session_id = ?")
        .bind(&session_id).fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1);
}

#[tokio::test]
async fn test_response_cache() {
    let pool = setup_db().await;

    // 写缓存
    let now = chrono::Utc::now().timestamp_millis();
    sqlx::query("INSERT INTO response_cache (cache_key, model, response, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
        .bind("test_key").bind("gpt-4o").bind("cached response").bind(now).bind(now)
        .execute(&pool).await.unwrap();

    // 读缓存
    let cached: Option<(String,)> = sqlx::query_as("SELECT response FROM response_cache WHERE cache_key = ?")
        .bind("test_key").fetch_optional(&pool).await.unwrap();
    assert_eq!(cached.unwrap().0, "cached response");
}

#[tokio::test]
async fn test_token_usage_tracking() {
    let pool = setup_db().await;
    let agent_id = create_test_agent(&pool).await;
    let now = chrono::Utc::now().timestamp_millis();

    // 记录 usage
    for i in 0..3 {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO token_usage (id, agent_id, model, input_tokens, output_tokens, total_tokens, cached_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)"
        )
        .bind(&id).bind(&agent_id).bind("gpt-4o")
        .bind(100 * (i + 1)).bind(50 * (i + 1)).bind(150 * (i + 1))
        .bind(now)
        .execute(&pool).await.unwrap();
    }

    // 聚合查询
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(total_tokens), 0) FROM token_usage WHERE agent_id = ?"
    ).bind(&agent_id).fetch_one(&pool).await.unwrap();
    assert_eq!(total, 150 + 300 + 450); // 900
}

#[tokio::test]
async fn test_settings_crud() {
    let pool = setup_db().await;

    // 写
    sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0)")
        .bind("test_key").bind("test_value")
        .execute(&pool).await.unwrap();

    // 读
    let val: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("test_key").fetch_optional(&pool).await.unwrap();
    assert_eq!(val.unwrap(), "test_value");

    // 更新（UPSERT）
    sqlx::query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind("test_key").bind("updated_value")
        .execute(&pool).await.unwrap();

    let val: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind("test_key").fetch_one(&pool).await.unwrap();
    assert_eq!(val, "updated_value");
}

#[tokio::test]
async fn test_memory_priority_eviction() {
    let pool = setup_db().await;
    let agent_id = create_test_agent(&pool).await;
    let now = chrono::Utc::now().timestamp_millis();

    // 插入不同优先级的记忆
    for (i, priority) in [0, 1, 1, 2, 3].iter().enumerate() {
        let id = format!("mem_{}", i);
        sqlx::query("INSERT INTO memories (id, agent_id, memory_type, content, created_at, updated_at, priority) VALUES (?, ?, 'test', ?, ?, ?, ?)")
            .bind(&id).bind(&agent_id).bind(format!("memory {}", i)).bind(now + i as i64).bind(now).bind(priority)
            .execute(&pool).await.unwrap();
    }

    // 淘汰到 3 条（Low=0 和一个 Normal=1 应被淘汰，Critical=3 不淘汰）
    let deleted = sqlx::query(
        "DELETE FROM memories WHERE id IN (SELECT id FROM memories WHERE agent_id = ? AND COALESCE(priority, 1) < 3 ORDER BY priority ASC, created_at ASC LIMIT ?)"
    ).bind(&agent_id).bind(2i64).execute(&pool).await.unwrap();

    assert_eq!(deleted.rows_affected(), 2);

    // Critical 应该保留
    let remaining: Vec<(i32,)> = sqlx::query_as("SELECT priority FROM memories WHERE agent_id = ? ORDER BY priority DESC")
        .bind(&agent_id).fetch_all(&pool).await.unwrap();
    assert!(remaining.iter().any(|(p,)| *p == 3)); // Critical 保留
}
