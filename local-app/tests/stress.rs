//! 压力测试 — 并发和大数据量场景
//!
//! 验证在高并发、大上下文、长对话等极端场景下的稳定性。

mod mock_llm;

/// 辅助：快速创建内存 DB
async fn setup_db() -> sqlx::SqlitePool {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    // 最小 schema
    sqlx::query("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT, system_prompt TEXT, model TEXT, temperature REAL, max_tokens INTEGER, created_at INTEGER, updated_at INTEGER, config TEXT, workspace_path TEXT, config_version INTEGER DEFAULT 1)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_calls_json TEXT, tool_call_id TEXT, tool_name TEXT, seq INTEGER NOT NULL, created_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS chat_sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'Test', created_at INTEGER NOT NULL, last_message_at INTEGER, summary TEXT)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS response_cache (cache_key TEXT PRIMARY KEY, model TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, use_count INTEGER NOT NULL DEFAULT 1)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0)")
        .execute(&pool).await.unwrap();
    sqlx::query("CREATE TABLE IF NOT EXISTS token_usage (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, session_id TEXT, model TEXT NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0, cached_tokens INTEGER DEFAULT 0, created_at INTEGER NOT NULL)")
        .execute(&pool).await.unwrap();
    pool
}

#[tokio::test]
async fn stress_concurrent_message_writes() {
    let pool = setup_db().await;
    let now = chrono::Utc::now().timestamp_millis();

    // 创建 agent + session
    sqlx::query("INSERT INTO agents (id, name, system_prompt, model, created_at, updated_at) VALUES ('a1', 'bot', 'p', 'gpt-4', ?, ?)")
        .bind(now).bind(now).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO chat_sessions (id, agent_id, title, created_at) VALUES ('s1', 'a1', 'Stress', ?)")
        .bind(now).execute(&pool).await.unwrap();

    // 并发写入 100 条消息
    let mut handles = Vec::new();
    for i in 0..100 {
        let pool = pool.clone();
        handles.push(tokio::spawn(async move {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO chat_messages (id, session_id, agent_id, role, content, seq, created_at) VALUES (?, 's1', 'a1', 'user', ?, ?, ?)"
            )
            .bind(&id).bind(format!("message {}", i)).bind(i as i64).bind(now)
            .execute(&pool).await.unwrap();
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    // 验证全部写入
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_messages WHERE session_id = 's1'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 100);
}

#[tokio::test]
async fn stress_large_context() {
    let pool = setup_db().await;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query("INSERT INTO agents (id, name, system_prompt, model, created_at, updated_at) VALUES ('a2', 'bot', 'p', 'gpt-4', ?, ?)")
        .bind(now).bind(now).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO chat_sessions (id, agent_id, title, created_at) VALUES ('s2', 'a2', 'Large', ?)")
        .bind(now).execute(&pool).await.unwrap();

    // 写入 500 条消息（模拟超长对话）
    for i in 0..500 {
        let id = uuid::Uuid::new_v4().to_string();
        // 每条消息 ~500 字符
        let content = format!("这是第 {} 条消息。{}", i, "内容填充。".repeat(50));
        sqlx::query(
            "INSERT INTO chat_messages (id, session_id, agent_id, role, content, seq, created_at) VALUES (?, 's2', 'a2', ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(if i % 2 == 0 { "user" } else { "assistant" })
        .bind(&content)
        .bind(i as i64)
        .bind(now + i as i64)
        .execute(&pool).await.unwrap();
    }

    // 查询最近 40 条（应该很快）
    let start = std::time::Instant::now();
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT content FROM chat_messages WHERE session_id = 's2' ORDER BY seq DESC LIMIT 40"
    ).fetch_all(&pool).await.unwrap();
    let elapsed = start.elapsed();

    assert_eq!(rows.len(), 40);
    assert!(elapsed.as_millis() < 100, "查询 40 条应在 100ms 内，实际 {}ms", elapsed.as_millis());
}

#[tokio::test]
async fn stress_response_cache_eviction() {
    let pool = setup_db().await;
    let now = chrono::Utc::now().timestamp_millis();

    // 写入 1500 条缓存（超过 MAX 1000）
    for i in 0..1500 {
        sqlx::query("INSERT INTO response_cache (cache_key, model, response, created_at, last_used_at) VALUES (?, 'gpt-4', ?, ?, ?)")
            .bind(format!("key_{}", i))
            .bind(format!("response {}", i))
            .bind(now + i as i64)
            .bind(now + i as i64)
            .execute(&pool).await.unwrap();
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM response_cache")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1500);

    // LRU 淘汰到 1000
    let to_delete = count - 1000;
    sqlx::query("DELETE FROM response_cache WHERE cache_key IN (SELECT cache_key FROM response_cache ORDER BY last_used_at ASC LIMIT ?)")
        .bind(to_delete).execute(&pool).await.unwrap();

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM response_cache")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(count, 1000);
}

#[tokio::test]
async fn stress_concurrent_token_tracking() {
    let pool = setup_db().await;
    let now = chrono::Utc::now().timestamp_millis();

    sqlx::query("INSERT INTO agents (id, name, system_prompt, model, created_at, updated_at) VALUES ('a3', 'bot', 'p', 'gpt-4', ?, ?)")
        .bind(now).bind(now).execute(&pool).await.unwrap();

    // 并发写入 50 条 token 记录
    let mut handles = Vec::new();
    for i in 0..50 {
        let pool = pool.clone();
        handles.push(tokio::spawn(async move {
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().timestamp_millis();
            sqlx::query(
                "INSERT INTO token_usage (id, agent_id, model, input_tokens, output_tokens, total_tokens, cached_tokens, created_at) VALUES (?, 'a3', 'gpt-4', 100, 50, 150, 0, ?)"
            ).bind(&id).bind(now).execute(&pool).await.unwrap();
        }));
    }

    for h in handles { h.await.unwrap(); }

    let total: i64 = sqlx::query_scalar("SELECT SUM(total_tokens) FROM token_usage WHERE agent_id = 'a3'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(total, 150 * 50); // 7500
}
