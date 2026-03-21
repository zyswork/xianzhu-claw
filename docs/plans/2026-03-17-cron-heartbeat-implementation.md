# Cron + Heartbeat 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 my-openclaw 桌面应用添加定时任务调度和双层心跳机制。

**Architecture:** 中心调度循环 + DB 状态机 + Notify 唤醒。单个 tokio task 睡到最早 next_run_at，配合 Notify 即时响应。支持 Agent/Shell/MCP 三种任务类型，Guardrails 防护，missed job 追赶，双层心跳（程序化监控 + LLM 智能心跳）。

**Tech Stack:** Rust + sqlx(SQLite) + tokio + cron crate + chrono-tz + tokio-util(CancellationToken) + Tauri 1.5

---

## Task 1: 添加依赖

**Files:**
- Modify: `local-app/Cargo.toml`

**Step 1: 添加 cron/chrono-tz/tokio-util 依赖**

在 `[dependencies]` 末尾添加：
```toml
cron = "0.13"
chrono-tz = "0.10"
tokio-util = { version = "0.7", features = ["rt"] }
```

**Step 2: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 编译成功，无错误

**Step 3: Commit**

```bash
git add Cargo.toml Cargo.lock
git commit -m "chore: add cron/chrono-tz/tokio-util dependencies"
```

---

## Task 2: 类型定义（types.rs）

**Files:**
- Create: `local-app/src/scheduler/types.rs`

**Step 1: 创建 types.rs**

```rust
//! 定时任务类型定义

use serde::{Deserialize, Serialize};

/// 调度类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Schedule {
    /// cron 表达式（如 "0 9 * * *"）
    Cron { expr: String, tz: String },
    /// 固定间隔（秒）
    Every { secs: u64 },
    /// 一次性定时（unix 时间戳）
    At { ts: i64 },
}

/// 任务执行类型
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobType {
    Agent,
    Shell,
    McpTool,
}

impl std::fmt::Display for JobType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobType::Agent => write!(f, "agent"),
            JobType::Shell => write!(f, "shell"),
            JobType::McpTool => write!(f, "mcp_tool"),
        }
    }
}

impl std::str::FromStr for JobType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "agent" => Ok(JobType::Agent),
            "shell" => Ok(JobType::Shell),
            "mcp_tool" => Ok(JobType::McpTool),
            _ => Err(format!("未知任务类型: {}", s)),
        }
    }
}

/// 执行载荷
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActionPayload {
    Agent {
        prompt: String,
        #[serde(default = "default_session_strategy")]
        session_strategy: String, // "new" | "reuse"
    },
    Shell {
        command: String,
    },
    McpTool {
        server_name: String,
        tool_name: String,
        #[serde(default)]
        args: serde_json::Value,
    },
}

fn default_session_strategy() -> String {
    "new".to_string()
}

/// Guardrails 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guardrails {
    pub max_concurrent: u32,
    pub cooldown_secs: u32,
    pub max_daily_runs: Option<u32>,
    pub max_consecutive_failures: u32,
}

impl Default for Guardrails {
    fn default() -> Self {
        Self {
            max_concurrent: 1,
            cooldown_secs: 0,
            max_daily_runs: None,
            max_consecutive_failures: 5,
        }
    }
}

/// 重试配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub backoff_factor: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 0,
            base_delay_ms: 2000,
            backoff_factor: 2.0,
        }
    }
}

/// 定时任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJob {
    pub id: String,
    pub name: String,
    pub agent_id: Option<String>,
    pub job_type: JobType,
    pub schedule: Schedule,
    pub action_payload: ActionPayload,
    pub timeout_secs: u32,
    pub guardrails: Guardrails,
    pub retry: RetryConfig,
    pub misfire_policy: String,
    pub catch_up_limit: u32,
    pub enabled: bool,
    pub fail_streak: u32,
    pub runs_today: u32,
    pub next_run_at: Option<i64>,
    pub last_run_at: Option<i64>,
    pub delete_after_run: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 运行记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronRun {
    pub id: String,
    pub job_id: String,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub status: RunStatus,
    pub trigger_source: TriggerSource,
    pub attempt: u32,
    pub output: Option<String>,
    pub error: Option<String>,
}

/// 运行状态
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Success,
    Failed,
    Timeout,
    Cancelled,
}

impl std::fmt::Display for RunStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RunStatus::Queued => write!(f, "queued"),
            RunStatus::Running => write!(f, "running"),
            RunStatus::Success => write!(f, "success"),
            RunStatus::Failed => write!(f, "failed"),
            RunStatus::Timeout => write!(f, "timeout"),
            RunStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

impl std::str::FromStr for RunStatus {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "queued" => Ok(RunStatus::Queued),
            "running" => Ok(RunStatus::Running),
            "success" => Ok(RunStatus::Success),
            "failed" => Ok(RunStatus::Failed),
            "timeout" => Ok(RunStatus::Timeout),
            "cancelled" => Ok(RunStatus::Cancelled),
            _ => Err(format!("未知状态: {}", s)),
        }
    }
}

/// 触发来源
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerSource {
    Schedule,
    Manual,
    Retry,
    CatchUp,
    Heartbeat,
}

impl std::fmt::Display for TriggerSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TriggerSource::Schedule => write!(f, "schedule"),
            TriggerSource::Manual => write!(f, "manual"),
            TriggerSource::Retry => write!(f, "retry"),
            TriggerSource::CatchUp => write!(f, "catch_up"),
            TriggerSource::Heartbeat => write!(f, "heartbeat"),
        }
    }
}

/// 执行结果
pub struct ExecResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
}

/// 调度器状态（前端展示用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStatus {
    pub running: bool,
    pub total_jobs: u32,
    pub enabled_jobs: u32,
    pub running_runs: u32,
    pub recent_failure_rate: f64,
    pub last_tick_at: Option<i64>,
}

/// 心跳配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatConfig {
    pub enabled: bool,
    pub interval_secs: u64,
    pub quiet_hours_start: Option<u8>,
    pub quiet_hours_end: Option<u8>,
    pub timezone: String,
    pub suppress_ok: bool,
    pub max_failures: u32,
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_secs: 1800, // 30 分钟
            quiet_hours_start: None,
            quiet_hours_end: None,
            timezone: "Asia/Shanghai".to_string(),
            suppress_ok: true,
            max_failures: 3,
        }
    }
}

/// 健康报告
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub scheduler_alive: bool,
    pub stuck_runs: Vec<String>,
    pub high_fail_jobs: Vec<String>,
    pub auto_disabled_jobs: Vec<String>,
    pub recent_failure_rate: f64,
}

impl HealthReport {
    pub fn has_issues(&self) -> bool {
        !self.stuck_runs.is_empty()
            || !self.high_fail_jobs.is_empty()
            || !self.auto_disabled_jobs.is_empty()
            || self.recent_failure_rate > 0.5
    }
}

/// 输出截断常量
pub const MAX_OUTPUT_BYTES: usize = 16 * 1024;
pub const TRUNCATED_MARKER: &str = "\n...[truncated]";

/// Anti-spin 常量
pub const MIN_REFIRE_GAP_MS: u64 = 2000;
pub const MAX_TIMER_DELAY_SECS: u64 = 60;
pub const STUCK_RUN_THRESHOLD_SECS: i64 = 7200; // 2 小时
pub const RECOVERY_THRESHOLD_SECS: u64 = 90;

/// 截断输出
pub fn truncate_output(output: &str) -> (String, bool) {
    if output.len() <= MAX_OUTPUT_BYTES {
        (output.to_string(), false)
    } else {
        let boundary = MAX_OUTPUT_BYTES - TRUNCATED_MARKER.len();
        // 在 UTF-8 字符边界截断
        let boundary = output.floor_char_boundary(boundary);
        (format!("{}{}", &output[..boundary], TRUNCATED_MARKER), true)
    }
}
```

**Step 2: 创建 mod.rs 骨架**

创建 `local-app/src/scheduler/mod.rs`：
```rust
//! 定时任务调度器

pub mod types;

pub use types::*;
```

**Step 3: 在 main.rs 中声明模块**

在 `local-app/src/main.rs` 顶部的 `mod` 声明区域添加：
```rust
mod scheduler;
```

**Step 4: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 编译成功

**Step 5: Commit**

```bash
git add src/scheduler/
git commit -m "feat(scheduler): add type definitions"
```

---

## Task 3: DB Schema + Store（store.rs）

**Files:**
- Modify: `local-app/src/db/schema.rs`
- Create: `local-app/src/scheduler/store.rs`

**Step 1: 在 schema.rs 的 init_schema 末尾添加 cron 表**

在 `init_schema` 函数的最后一个 `sqlx::query` 之后、`Ok(())` 之前添加：

```rust
// 定时任务表
sqlx::query(
    "CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent_id TEXT,
        job_type TEXT NOT NULL CHECK(job_type IN ('agent','shell','mcp_tool')),
        schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('cron','every','at')),
        cron_expr TEXT,
        every_secs INTEGER,
        at_ts INTEGER,
        timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
        action_payload TEXT NOT NULL,
        timeout_secs INTEGER NOT NULL DEFAULT 300,
        max_concurrent INTEGER NOT NULL DEFAULT 1,
        cooldown_secs INTEGER NOT NULL DEFAULT 0,
        max_daily_runs INTEGER,
        max_consecutive_failures INTEGER NOT NULL DEFAULT 5,
        retry_max INTEGER NOT NULL DEFAULT 0,
        retry_base_delay_ms INTEGER NOT NULL DEFAULT 2000,
        retry_backoff_factor REAL NOT NULL DEFAULT 2.0,
        misfire_policy TEXT NOT NULL DEFAULT 'catch_up' CHECK(misfire_policy IN ('skip','catch_up')),
        catch_up_limit INTEGER NOT NULL DEFAULT 3,
        enabled INTEGER NOT NULL DEFAULT 1,
        fail_streak INTEGER NOT NULL DEFAULT 0,
        runs_today INTEGER NOT NULL DEFAULT 0,
        runs_today_date TEXT,
        next_run_at INTEGER,
        last_run_at INTEGER,
        delete_after_run INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )"
).execute(pool).await?;

sqlx::query(
    "CREATE TABLE IF NOT EXISTS cron_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('queued','running','success','failed','timeout','cancelled')),
        trigger_source TEXT NOT NULL CHECK(trigger_source IN ('schedule','manual','retry','catch_up','heartbeat')),
        attempt INTEGER NOT NULL DEFAULT 1,
        output TEXT,
        error TEXT,
        FOREIGN KEY(job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
    )"
).execute(pool).await?;

sqlx::query("CREATE INDEX IF NOT EXISTS idx_cron_jobs_due ON cron_jobs(enabled, next_run_at)")
    .execute(pool).await?;
sqlx::query("CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, started_at DESC)")
    .execute(pool).await?;
sqlx::query("CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status)")
    .execute(pool).await?;
```

**Step 2: 创建 store.rs — CRUD 操作**

store.rs 实现以下函数（全部 async，使用 sqlx）：

```rust
// 任务 CRUD
pub async fn add_job(pool: &SqlitePool, job: &CreateJobRequest) -> Result<CronJob, String>
pub async fn get_job(pool: &SqlitePool, job_id: &str) -> Result<CronJob, String>
pub async fn list_jobs(pool: &SqlitePool, filter: Option<&JobFilter>) -> Result<Vec<CronJob>, String>
pub async fn update_job(pool: &SqlitePool, job_id: &str, patch: &UpdateJobRequest) -> Result<CronJob, String>
pub async fn delete_job(pool: &SqlitePool, job_id: &str) -> Result<(), String>

// 调度相关
pub async fn earliest_next_run(pool: &SqlitePool) -> Result<Option<i64>, String>
pub async fn due_jobs(pool: &SqlitePool, now: i64) -> Result<Vec<CronJob>, String>
pub async fn update_next_run(pool: &SqlitePool, job_id: &str, next_run: i64, last_run: i64) -> Result<(), String>
pub async fn increment_fail_streak(pool: &SqlitePool, job_id: &str) -> Result<u32, String>
pub async fn reset_fail_streak(pool: &SqlitePool, job_id: &str) -> Result<(), String>
pub async fn disable_job(pool: &SqlitePool, job_id: &str) -> Result<(), String>
pub async fn count_running(pool: &SqlitePool, job_id: &str) -> Result<u32, String>
pub async fn reset_daily_counter(pool: &SqlitePool, job_id: &str, today: &str) -> Result<(), String>
pub async fn increment_daily_counter(pool: &SqlitePool, job_id: &str) -> Result<(), String>

// 运行记录
pub async fn record_run(pool: &SqlitePool, run: &CronRun) -> Result<(), String>
pub async fn update_run_status(pool: &SqlitePool, run_id: &str, status: RunStatus, output: Option<&str>, error: Option<&str>) -> Result<(), String>
pub async fn list_runs(pool: &SqlitePool, job_id: &str, limit: u32) -> Result<Vec<CronRun>, String>
pub async fn timeout_stuck_runs(pool: &SqlitePool, threshold_secs: i64) -> Result<u32, String>
pub async fn cancel_running_runs(pool: &SqlitePool) -> Result<(), String>

// 健康统计
pub async fn recent_failure_rate(pool: &SqlitePool, window_secs: i64) -> Result<f64, String>
pub async fn high_fail_jobs(pool: &SqlitePool, threshold: u32) -> Result<Vec<String>, String>
pub async fn auto_disabled_jobs(pool: &SqlitePool) -> Result<Vec<String>, String>
```

CronJob 从 DB row 的映射逻辑：将 schedule_kind/cron_expr/every_secs/at_ts 组装为 Schedule 枚举，将 action_payload JSON 反序列化为 ActionPayload 枚举，将 guardrails 字段组装为 Guardrails struct。

**Step 3: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 编译成功

**Step 4: Commit**

```bash
git add src/db/schema.rs src/scheduler/store.rs
git commit -m "feat(scheduler): add DB schema and store CRUD"
```


---

## Task 4: 调度计划器（planner.rs）

**Files:**
- Create: `local-app/src/scheduler/planner.rs`

**Step 1: 创建 planner.rs — next_run 计算**

```rust
//! 调度计划器：计算下次执行时间

use chrono::{DateTime, Utc, TimeZone};
use chrono_tz::Tz;
use cron::Schedule as CronSchedule;
use std::str::FromStr;

use super::types::Schedule;

/// 计算下次执行时间（返回 unix 时间戳）
pub fn next_run_after(schedule: &Schedule, after: i64) -> Result<Option<i64>, String> {
    match schedule {
        Schedule::Cron { expr, tz } => {
            let timezone: Tz = tz.parse()
                .map_err(|_| format!("无效时区: {}", tz))?;
            // cron crate 需要 7 字段格式（秒 分 时 日 月 周）
            let cron_expr = normalize_cron_expr(expr)?;
            let cron_schedule = CronSchedule::from_str(&cron_expr)
                .map_err(|e| format!("无效 cron 表达式 '{}': {}", expr, e))?;
            let after_dt = Utc.timestamp_opt(after, 0)
                .single()
                .ok_or("无效时间戳")?;
            // 在指定时区中计算下次执行
            let after_tz = after_dt.with_timezone(&timezone);
            let next = cron_schedule.after(&after_tz).next();
            Ok(next.map(|dt| dt.with_timezone(&Utc).timestamp()))
        }
        Schedule::Every { secs } => {
            Ok(Some(after + *secs as i64))
        }
        Schedule::At { ts } => {
            // 一次性：如果 ts > after 则返回 ts，否则 None（已过期）
            if *ts > after {
                Ok(Some(*ts))
            } else {
                Ok(None)
            }
        }
    }
}

/// 标准化 cron 表达式：5 字段 → 7 字段（补秒和年）
fn normalize_cron_expr(expr: &str) -> Result<String, String> {
    let parts: Vec<&str> = expr.trim().split_whitespace().collect();
    match parts.len() {
        5 => Ok(format!("0 {}", expr)),  // 补秒=0
        6 => Ok(expr.to_string()),        // 已有秒
        7 => Ok(expr.to_string()),        // 已有秒和年
        _ => Err(format!("cron 表达式字段数错误({}): {}", parts.len(), expr)),
    }
}

/// 验证调度配置
pub fn validate_schedule(schedule: &Schedule) -> Result<(), String> {
    match schedule {
        Schedule::Cron { expr, tz } => {
            let _: Tz = tz.parse()
                .map_err(|_| format!("无效时区: {}", tz))?;
            let normalized = normalize_cron_expr(expr)?;
            CronSchedule::from_str(&normalized)
                .map_err(|e| format!("无效 cron 表达式: {}", e))?;
            Ok(())
        }
        Schedule::Every { secs } => {
            if *secs < 60 {
                Err("间隔不能小于 60 秒".to_string())
            } else {
                Ok(())
            }
        }
        Schedule::At { ts } => {
            if *ts <= Utc::now().timestamp() {
                Err("一次性定时不能是过去的时间".to_string())
            } else {
                Ok(())
            }
        }
    }
}
```

**Step 2: 写测试**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cron_next_run() {
        let schedule = Schedule::Cron {
            expr: "0 9 * * *".to_string(),
            tz: "Asia/Shanghai".to_string(),
        };
        let now = Utc::now().timestamp();
        let next = next_run_after(&schedule, now).unwrap();
        assert!(next.is_some());
        assert!(next.unwrap() > now);
    }

    #[test]
    fn test_every_next_run() {
        let schedule = Schedule::Every { secs: 3600 };
        let now = 1000;
        let next = next_run_after(&schedule, now).unwrap();
        assert_eq!(next, Some(4600));
    }

    #[test]
    fn test_at_future() {
        let future_ts = Utc::now().timestamp() + 3600;
        let schedule = Schedule::At { ts: future_ts };
        let now = Utc::now().timestamp();
        let next = next_run_after(&schedule, now).unwrap();
        assert_eq!(next, Some(future_ts));
    }

    #[test]
    fn test_at_past() {
        let past_ts = Utc::now().timestamp() - 3600;
        let schedule = Schedule::At { ts: past_ts };
        let now = Utc::now().timestamp();
        let next = next_run_after(&schedule, now).unwrap();
        assert_eq!(next, None);
    }

    #[test]
    fn test_normalize_5_field() {
        let result = normalize_cron_expr("0 9 * * *").unwrap();
        assert_eq!(result, "0 0 9 * * *");
    }

    #[test]
    fn test_validate_every_too_short() {
        let schedule = Schedule::Every { secs: 10 };
        assert!(validate_schedule(&schedule).is_err());
    }
}
```

**Step 3: 运行测试**

Run: `cd local-app && cargo test planner -- --nocapture 2>&1 | tail -15`
Expected: 所有测试通过

**Step 4: Commit**

```bash
git add src/scheduler/planner.rs
git commit -m "feat(scheduler): add planner with cron/every/at scheduling"
```


---

## Task 5: 执行引擎（runner.rs）

**Files:**
- Create: `local-app/src/scheduler/runner.rs`

**Step 1: 创建 runner.rs**

```rust
//! 任务执行引擎：Shell / Agent / MCP，超时 + 重试 + 输出截断

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

use super::types::*;

/// 执行结果
pub enum ExecResult {
    Success { output: String },
    Failed { error: String },
    Timeout,
}

pub struct JobRunner {
    pool: sqlx::SqlitePool,
    orchestrator: Arc<crate::agent::Orchestrator>,
    app_handle: tauri::AppHandle,
}

impl JobRunner {
    pub fn new(
        pool: sqlx::SqlitePool,
        orchestrator: Arc<crate::agent::Orchestrator>,
        app_handle: tauri::AppHandle,
    ) -> Self {
        Self { pool, orchestrator, app_handle }
    }

    /// 执行任务（带超时）
    pub async fn execute(&self, job: &CronJob) -> ExecResult {
        match tokio::time::timeout(
            Duration::from_secs(job.timeout_secs as u64),
            self.execute_inner(job),
        ).await {
            Ok(result) => result,
            Err(_) => ExecResult::Timeout,
        }
    }

    async fn execute_inner(&self, job: &CronJob) -> ExecResult {
        match &job.action_payload {
            ActionPayload::Agent { prompt, session_strategy } => {
                self.execute_agent(job, prompt, session_strategy).await
            }
            ActionPayload::Shell { command } => {
                self.execute_shell(command).await
            }
            ActionPayload::McpTool { server_name, tool_name, args } => {
                self.execute_mcp(job, server_name, tool_name, args).await
            }
        }
    }

    /// Agent 任务：调用 Orchestrator
    async fn execute_agent(&self, job: &CronJob, prompt: &str, session_strategy: &str) -> ExecResult {
        let agent_id = match &job.agent_id {
            Some(id) => id.clone(),
            None => return ExecResult::Failed { error: "Agent 任务缺少 agent_id".to_string() },
        };

        // 创建或复用 session
        let session_id = match session_strategy {
            "reuse" => {
                // 查找或创建 cron 专用 session
                let title = format!("cron:{}", job.id);
                match crate::memory::conversation::find_or_create_session(
                    &self.pool, &agent_id, &title
                ).await {
                    Ok(s) => s.id,
                    Err(e) => return ExecResult::Failed { error: format!("创建 session 失败: {}", e) },
                }
            }
            _ => {
                // 每次新建 session
                match crate::memory::conversation::create_session(
                    &self.pool, &agent_id, &format!("cron-run-{}", chrono::Utc::now().timestamp())
                ).await {
                    Ok(s) => s.id,
                    Err(e) => return ExecResult::Failed { error: format!("创建 session 失败: {}", e) },
                }
            }
        };

        // 收集 LLM 输出
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let output_handle = tokio::spawn(async move {
            let mut output = String::new();
            while let Some(token) = rx.recv().await {
                output.push_str(&token);
            }
            output
        });

        // 获取 provider 信息
        let providers = match crate::main_helpers::load_providers_for_agent(
            &self.pool, &agent_id
        ).await {
            Ok(p) => p,
            Err(e) => return ExecResult::Failed { error: e },
        };

        match self.orchestrator.send_message_stream(
            &agent_id, &session_id, prompt,
            &providers.api_key, &providers.api_type,
            providers.base_url.as_deref(), tx,
        ).await {
            Ok(_) => {
                let output = output_handle.await.unwrap_or_default();
                ExecResult::Success { output: truncate_output(&output) }
            }
            Err(e) => ExecResult::Failed { error: e },
        }
    }

    /// Shell 命令执行
    async fn execute_shell(&self, command: &str) -> ExecResult {
        match tokio::process::Command::new("sh")
            .args(["-c", command])
            .output()
            .await
        {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                if output.status.success() {
                    let combined = format!("{}{}", stdout, stderr);
                    ExecResult::Success { output: truncate_output(&combined) }
                } else {
                    ExecResult::Failed {
                        error: format!("退出码 {}: {}", output.status.code().unwrap_or(-1), stderr)
                    }
                }
            }
            Err(e) => ExecResult::Failed { error: format!("执行失败: {}", e) },
        }
    }

    /// MCP 工具调用
    async fn execute_mcp(&self, job: &CronJob, server_name: &str, tool_name: &str, args: &serde_json::Value) -> ExecResult {
        let agent_id = job.agent_id.as_deref().unwrap_or("default");
        // 确保 MCP server 已启动
        if let Err(e) = self.orchestrator.mcp_manager().start_servers_for_agent(agent_id).await {
            return ExecResult::Failed { error: format!("启动 MCP 服务失败: {}", e) };
        }
        match self.orchestrator.mcp_manager().call_tool(server_name, tool_name, args.clone()).await {
            Ok(result) => ExecResult::Success { output: truncate_output(&result) },
            Err(e) => ExecResult::Failed { error: e },
        }
    }

    /// 带重试的执行
    pub async fn execute_with_retry(&self, job: &CronJob) -> (ExecResult, u32) {
        let max = job.retry.max_attempts;
        for attempt in 1..=(max + 1) {
            let result = self.execute(job).await;
            match &result {
                ExecResult::Success { .. } => return (result, attempt),
                _ if attempt <= max => {
                    let delay_ms = (job.retry.base_delay_ms as f64
                        * job.retry.backoff_factor.powi((attempt - 1) as i32)) as u64;
                    let delay_ms = delay_ms.min(600_000); // 上限 10 分钟
                    log::warn!("任务 {} 第 {} 次重试，等待 {}ms", job.name, attempt, delay_ms);
                    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                }
                _ => return (result, attempt),
            }
        }
        unreachable!()
    }
}

/// 输出截断
fn truncate_output(output: &str) -> String {
    if output.len() <= MAX_OUTPUT_BYTES {
        output.to_string()
    } else {
        let end = MAX_OUTPUT_BYTES - TRUNCATED_MARKER.len();
        // 确保不在 UTF-8 字符中间截断
        let end = output.floor_char_boundary(end);
        format!("{}{}", &output[..end], TRUNCATED_MARKER)
    }
}
```

注意：`execute_agent` 中的 `load_providers_for_agent` 和 `find_or_create_session` 是需要新增的辅助函数。在 Task 9（集成）中添加。

**Step 2: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 可能有未解析的引用（Task 9 补齐），但类型和逻辑正确

**Step 3: Commit**

```bash
git add src/scheduler/runner.rs
git commit -m "feat(scheduler): add job runner with agent/shell/mcp execution"
```


---

## Task 6: 调度引擎核心循环（engine.rs）

**Files:**
- Create: `local-app/src/scheduler/engine.rs`

**Step 1: 创建 engine.rs**

```rust
//! 调度引擎：sleep-to-earliest + Notify + catch-up + stuck 检测

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

use super::{store, planner, types::*};
use super::runner::{JobRunner, ExecResult};

const STUCK_RUN_THRESHOLD_SECS: i64 = 7200; // 2 小时
const HEALTH_CHECK_INTERVAL_SECS: u64 = 300; // 5 分钟

pub struct SchedulerEngine {
    pool: sqlx::SqlitePool,
    notify: Arc<Notify>,
    runner: Arc<JobRunner>,
    semaphore: Arc<Semaphore>,
    shutdown: CancellationToken,
    app_handle: tauri::AppHandle,
}

impl SchedulerEngine {
    pub fn new(
        pool: sqlx::SqlitePool,
        notify: Arc<Notify>,
        runner: Arc<JobRunner>,
        shutdown: CancellationToken,
        app_handle: tauri::AppHandle,
    ) -> Self {
        Self {
            pool,
            notify,
            runner,
            semaphore: Arc::new(Semaphore::new(3)), // 全局最大 3 并发
            shutdown,
            app_handle,
        }
    }

    /// 启动调度循环（在 tokio::spawn 中运行）
    pub async fn run(&self) {
        log::info!("调度引擎启动");

        // 启动时：取消上次未完成的 run + recovery scan
        if let Err(e) = store::cancel_running_runs(&self.pool).await {
            log::error!("取消残留 run 失败: {}", e);
        }
        self.recovery_scan().await;

        let mut last_tick = Instant::now();
        let mut last_health_check = Instant::now();

        loop {
            // 1. 休眠唤醒检测
            if last_tick.elapsed() > Duration::from_secs(90) {
                log::info!("检测到系统休眠唤醒，执行 recovery scan");
                self.recovery_scan().await;
            }

            // 2. 计算 sleep 时长
            let now_ts = chrono::Utc::now().timestamp();
            let delay = match store::earliest_next_run(&self.pool).await {
                Ok(Some(ts)) => {
                    let diff = (ts - now_ts).max(0) as u64;
                    Duration::from_secs(diff.min(MAX_TIMER_DELAY_SECS))
                }
                _ => Duration::from_secs(MAX_TIMER_DELAY_SECS),
            };

            // 3. sleep 或被唤醒
            tokio::select! {
                _ = self.notify.notified() => {
                    log::debug!("调度引擎被唤醒");
                }
                _ = tokio::time::sleep(delay) => {}
                _ = self.shutdown.cancelled() => {
                    log::info!("调度引擎收到关闭信号");
                    break;
                }
            }

            last_tick = Instant::now();

            // 4. 批量取到期任务
            let now_ts = chrono::Utc::now().timestamp();
            let due = match store::due_jobs(&self.pool, now_ts).await {
                Ok(jobs) => jobs,
                Err(e) => {
                    log::error!("查询到期任务失败: {}", e);
                    continue;
                }
            };

            // 5. 逐个检查 Guardrails → spawn 执行
            for job in due {
                if !self.check_guardrails(&job).await {
                    // 跳过但仍需更新 next_run_at
                    self.reschedule_job(&job).await;
                    continue;
                }
                self.spawn_job(job).await;
            }

            // 6. 定期健康检查
            if last_health_check.elapsed() > Duration::from_secs(HEALTH_CHECK_INTERVAL_SECS) {
                self.health_check().await;
                last_health_check = Instant::now();
            }

            // 7. stuck run 检测
            if let Err(e) = store::timeout_stuck_runs(&self.pool, STUCK_RUN_THRESHOLD_SECS).await {
                log::error!("stuck run 检测失败: {}", e);
            }
        }

        // 优雅退出：等待正在执行的任务（最多 10s）
        log::info!("等待执行中的任务完成...");
        let _ = tokio::time::timeout(
            Duration::from_secs(10),
            self.semaphore.acquire_many(3), // 等待所有 permit 归还
        ).await;
        if let Err(e) = store::cancel_running_runs(&self.pool).await {
            log::error!("退出时取消 run 失败: {}", e);
        }
        log::info!("调度引擎已停止");
    }

    /// Guardrails 检查
    async fn check_guardrails(&self, job: &CronJob) -> bool {
        // anti-spin: MIN_REFIRE_GAP
        if let Some(last) = job.last_run_at {
            let gap = chrono::Utc::now().timestamp() - last;
            if gap < (MIN_REFIRE_GAP_MS / 1000) as i64 {
                return false;
            }
        }

        // max_concurrent
        if let Ok(running) = store::count_running(&self.pool, &job.id).await {
            if running >= job.guardrails.max_concurrent {
                log::debug!("任务 {} 达到最大并发 {}", job.name, job.guardrails.max_concurrent);
                return false;
            }
        }

        // cooldown
        if job.guardrails.cooldown_secs > 0 {
            if let Some(last) = job.last_run_at {
                let elapsed = chrono::Utc::now().timestamp() - last;
                if elapsed < job.guardrails.cooldown_secs as i64 {
                    return false;
                }
            }
        }

        // max_daily_runs
        if let Some(max) = job.guardrails.max_daily_runs {
            let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
            if job.runs_today_date.as_deref() != Some(&today) {
                let _ = store::reset_daily_counter(&self.pool, &job.id, &today).await;
            } else if job.runs_today >= max {
                log::debug!("任务 {} 达到每日上限 {}", job.name, max);
                return false;
            }
        }

        // max_consecutive_failures → 自动 disable
        if job.fail_streak >= job.guardrails.max_consecutive_failures {
            log::warn!("任务 {} 连续失败 {} 次，自动禁用", job.name, job.fail_streak);
            let _ = store::disable_job(&self.pool, &job.id).await;
            return false;
        }

        true
    }

    /// spawn 执行任务
    async fn spawn_job(&self, job: CronJob) {
        let permit = match self.semaphore.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => {
                log::warn!("全局并发已满，跳过任务 {}", job.name);
                return;
            }
        };

        let pool = self.pool.clone();
        let runner = self.runner.clone();
        let app_handle = self.app_handle.clone();
        let notify = self.notify.clone();

        tokio::spawn(async move {
            let now = chrono::Utc::now().timestamp();
            let run_id = uuid::Uuid::new_v4().to_string();

            // 记录 queued → running
            let run = CronRun {
                id: run_id.clone(),
                job_id: job.id.clone(),
                scheduled_at: job.next_run_at.unwrap_or(now),
                started_at: Some(now),
                finished_at: None,
                status: RunStatus::Running,
                trigger_source: TriggerSource::Schedule,
                attempt: 1,
                output: None,
                error: None,
            };
            let _ = store::record_run(&pool, &run).await;

            // 执行（带重试）
            let (result, attempt) = runner.execute_with_retry(&job).await;

            // 更新 run 状态
            let finished = chrono::Utc::now().timestamp();
            let (status, output, error) = match &result {
                ExecResult::Success { output } => (RunStatus::Success, Some(output.as_str()), None),
                ExecResult::Failed { error } => (RunStatus::Failed, None, Some(error.as_str())),
                ExecResult::Timeout => (RunStatus::Timeout, None, Some("执行超时")),
            };
            let _ = store::update_run_status(&pool, &run_id, status, output, error).await;

            // 更新 job 状态
            match &result {
                ExecResult::Success { .. } => {
                    let _ = store::reset_fail_streak(&pool, &job.id).await;
                }
                _ => {
                    let _ = store::increment_fail_streak(&pool, &job.id).await;
                }
            }
            let _ = store::increment_daily_counter(&pool, &job.id).await;

            // 计算下次执行时间
            if let Ok(Some(next)) = planner::next_run_after(&job.schedule, now) {
                let _ = store::update_next_run(&pool, &job.id, next, now).await;
            } else if job.delete_after_run {
                let _ = store::delete_job(&pool, &job.id).await;
            }

            // 通知前端
            let _ = app_handle.emit_all("cron-run-complete", &serde_json::json!({
                "jobId": job.id,
                "runId": run_id,
                "status": status.to_string(),
                "attempt": attempt,
            }));

            // 唤醒调度循环（可能有新的 next_run_at）
            notify.notify_one();

            drop(permit); // 归还 semaphore
        });
    }

    /// Recovery scan：补执行错过的任务
    async fn recovery_scan(&self) {
        log::info!("执行 recovery scan...");
        let now = chrono::Utc::now().timestamp();
        let missed = match store::due_jobs(&self.pool, now).await {
            Ok(jobs) => jobs,
            Err(_) => return,
        };

        for job in missed {
            if job.misfire_policy == "skip" {
                // 直接跳到下次
                if let Ok(Some(next)) = planner::next_run_after(&job.schedule, now) {
                    let _ = store::update_next_run(&self.pool, &job.id, next, now).await;
                }
                continue;
            }

            // catch_up: 最多补执行 catch_up_limit 次
            let missed_count = if let (Some(next_run), Ok(Some(next_future))) =
                (job.next_run_at, planner::next_run_after(&job.schedule, now))
            {
                // 估算错过了多少次
                let interval = match &job.schedule {
                    Schedule::Every { secs } => *secs as i64,
                    _ => (next_future - now).max(3600),
                };
                ((now - next_run) / interval).min(job.catch_up_limit as i64) as u32
            } else {
                1
            };

            log::info!("任务 {} 错过 {} 次，补执行 {} 次", job.name, missed_count,
                missed_count.min(job.catch_up_limit));

            // stagger: hash(job_id) % 5s
            let stagger_ms = {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                job.id.hash(&mut hasher);
                (hasher.finish() % 5000) as u64
            };
            tokio::time::sleep(Duration::from_millis(stagger_ms)).await;

            self.spawn_job(job).await;
        }
    }

    /// 程序化健康检查
    async fn health_check(&self) {
        let report = HealthReport {
            scheduler_alive: true,
            stuck_runs: store::timeout_stuck_runs(&self.pool, STUCK_RUN_THRESHOLD_SECS)
                .await.map(|n| vec![format!("{} stuck runs", n)]).unwrap_or_default(),
            high_fail_jobs: store::high_fail_jobs(&self.pool, 3).await.unwrap_or_default(),
            auto_disabled_jobs: store::auto_disabled_jobs(&self.pool).await.unwrap_or_default(),
            recent_failure_rate: store::recent_failure_rate(&self.pool, 3600).await.unwrap_or(0.0),
        };

        if report.has_issues() {
            log::warn!("健康检查发现问题: {:?}", report);
            let _ = self.app_handle.emit_all("heartbeat-alert", &report);
        }
    }
}
```

**Step 2: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 编译成功

**Step 3: Commit**

```bash
git add src/scheduler/engine.rs
git commit -m "feat(scheduler): add core scheduling engine with guardrails and recovery"
```


---

## Task 7: Heartbeat 双层心跳（heartbeat.rs）

**Files:**
- Create: `local-app/src/scheduler/heartbeat.rs`

**Step 1: 创建 heartbeat.rs**

```rust
//! 双层心跳：程序化状态监控 + LLM 智能心跳

use std::sync::Arc;
use std::path::PathBuf;

use super::{store, types::*};

/// 第一层：程序化状态监控
pub async fn health_check(
    pool: &sqlx::SqlitePool,
    app_handle: &tauri::AppHandle,
) -> HealthReport {
    let stuck_runs = store::timeout_stuck_runs(pool, 7200).await.unwrap_or(0);
    let stuck_run_ids = vec![]; // timeout_stuck_runs 已处理，这里记录数量
    let high_fail = store::high_fail_jobs(pool, 3).await.unwrap_or_default();
    let auto_disabled = store::auto_disabled_jobs(pool).await.unwrap_or_default();
    let failure_rate = store::recent_failure_rate(pool, 3600).await.unwrap_or(0.0);

    let report = HealthReport {
        scheduler_alive: true,
        stuck_runs: stuck_run_ids,
        high_fail_jobs: high_fail,
        auto_disabled_jobs: auto_disabled,
        recent_failure_rate: failure_rate,
    };

    if report.has_issues() {
        log::warn!("心跳检测到问题: {:?}", report);
        let _ = app_handle.emit_all("heartbeat-alert", &report);
    }

    report
}

/// 第二层：LLM 智能心跳
/// 读取 HEARTBEAT.md + HealthReport，让 LLM 判断是否需要行动
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
        tokio::fs::read_to_string(&heartbeat_path).await
            .unwrap_or_default()
    } else {
        return Ok(()); // 无检查清单，跳过
    };

    // 跳过空文件或仅有注释的文件
    let has_tasks = checklist.lines()
        .any(|line| line.trim_start().starts_with("- "));
    if !has_tasks {
        return Ok(());
    }

    // 获取当前健康报告
    let report = health_check(pool, app_handle).await;

    // 构造 prompt
    let prompt = format!(
        "你是系统健康检查助手。以下是当前系统状态和检查清单。\n\
         请逐项检查并报告需要关注的问题。\n\
         如果一切正常，仅回复 HEARTBEAT_OK。\n\n\
         ## 系统状态\n\
         - 调度器: {}\n\
         - 最近1h失败率: {:.1}%\n\
         - 连续失败任务: {}\n\
         - 自动禁用任务: {}\n\n\
         ## 检查清单\n{}",
        if report.scheduler_alive { "运行中" } else { "异常" },
        report.recent_failure_rate * 100.0,
        if report.high_fail_jobs.is_empty() { "无".to_string() }
            else { report.high_fail_jobs.join(", ") },
        if report.auto_disabled_jobs.is_empty() { "无".to_string() }
            else { report.auto_disabled_jobs.join(", ") },
        checklist,
    );

    // 使用配置的 agent 执行
    let agent_id = config.agent_id.as_deref().unwrap_or("default");

    // 创建临时 session
    let session = crate::memory::conversation::create_session(
        pool, agent_id, &format!("heartbeat-{}", chrono::Utc::now().timestamp())
    ).await.map_err(|e| format!("创建心跳 session 失败: {}", e))?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let output_handle = tokio::spawn(async move {
        let mut output = String::new();
        while let Some(token) = rx.recv().await {
            output.push_str(&token);
        }
        output
    });

    // 获取 provider（复用 agent 的模型配置）
    let providers = crate::main_helpers::load_providers_for_agent(pool, agent_id).await
        .map_err(|e| format!("获取 provider 失败: {}", e))?;

    orchestrator.send_message_stream(
        agent_id, &session.id, &prompt,
        &providers.api_key, &providers.api_type,
        providers.base_url.as_deref(), tx,
    ).await?;

    let output = output_handle.await.unwrap_or_default();

    // HEARTBEAT_OK 抑制
    if output.trim().contains("HEARTBEAT_OK") {
        log::info!("LLM 心跳: 一切正常");
        return Ok(());
    }

    // 有问题，通知前端
    log::warn!("LLM 心跳发现问题: {}", &output[..output.len().min(200)]);
    let _ = app_handle.emit_all("heartbeat-llm-alert", &serde_json::json!({
        "message": output,
        "timestamp": chrono::Utc::now().timestamp(),
    }));

    Ok(())
}

/// 检查是否在静默时段
fn is_quiet_hour(config: &HeartbeatConfig) -> bool {
    let (start, end) = match (config.quiet_start, config.quiet_end) {
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
```

**Step 2: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 编译成功

**Step 3: Commit**

```bash
git add src/scheduler/heartbeat.rs
git commit -m "feat(scheduler): add dual-layer heartbeat system"
```

---

## Task 8: Agent 工具定义（tools.rs）

**Files:**
- Create: `local-app/src/scheduler/tools.rs`

**Step 1: 创建 tools.rs — 5 个 cron 工具**

```rust
//! Agent 可调用的定时任务管理工具

use async_trait::async_trait;
use serde_json::json;

use crate::agent::tools::{Tool, ToolDefinition, ToolParameter, ToolSafetyLevel};
use super::{store, planner, types::*};

/// cron_add 工具
pub struct CronAddTool {
    pool: sqlx::SqlitePool,
    notify: std::sync::Arc<tokio::sync::Notify>,
}

impl CronAddTool {
    pub fn new(pool: sqlx::SqlitePool, notify: std::sync::Arc<tokio::sync::Notify>) -> Self {
        Self { pool, notify }
    }
}

#[async_trait]
impl Tool for CronAddTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "cron_add".to_string(),
            description: "创建定时任务。支持 cron 表达式、固定间隔、一次性定时。".to_string(),
            parameters: vec![
                ToolParameter { name: "name".into(), param_type: "string".into(), description: "任务名称".into(), required: true },
                ToolParameter { name: "job_type".into(), param_type: "string".into(), description: "agent|shell|mcp_tool".into(), required: true },
                ToolParameter { name: "schedule".into(), param_type: "object".into(), description: "调度配置: {kind:'cron',expr,tz?} | {kind:'every',secs} | {kind:'at',ts}".into(), required: true },
                ToolParameter { name: "action".into(), param_type: "object".into(), description: "执行配置".into(), required: true },
                ToolParameter { name: "agent_id".into(), param_type: "string".into(), description: "Agent ID（agent/mcp_tool 类型必填）".into(), required: false },
            ],
        }
    }

    fn safety_level(&self) -> ToolSafetyLevel { ToolSafetyLevel::RequiresApproval }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let name = args["name"].as_str().ok_or("缺少 name")?;
        let job_type: JobType = args["job_type"].as_str().ok_or("缺少 job_type")?.parse()?;
        let schedule: Schedule = serde_json::from_value(args["schedule"].clone())
            .map_err(|e| format!("schedule 格式错误: {}", e))?;
        let action: ActionPayload = serde_json::from_value(args["action"].clone())
            .map_err(|e| format!("action 格式错误: {}", e))?;
        let agent_id = args["agent_id"].as_str().map(|s| s.to_string());

        planner::validate_schedule(&schedule)?;

        let req = CreateJobRequest {
            name: name.to_string(),
            agent_id,
            job_type,
            schedule,
            action_payload: action,
            timeout_secs: 300,
            guardrails: Guardrails::default(),
            retry: RetryConfig::default(),
            misfire_policy: "catch_up".to_string(),
            catch_up_limit: 3,
        };

        let job = store::add_job(&self.pool, &req).await?;
        self.notify.notify_one();
        Ok(format!("已创建定时任务: {} (ID: {})", job.name, job.id))
    }
}

/// cron_list 工具
pub struct CronListTool { pool: sqlx::SqlitePool }

impl CronListTool {
    pub fn new(pool: sqlx::SqlitePool) -> Self { Self { pool } }
}

#[async_trait]
impl Tool for CronListTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "cron_list".to_string(),
            description: "列出所有定时任务".to_string(),
            parameters: vec![],
        }
    }

    async fn execute(&self, _args: serde_json::Value) -> Result<String, String> {
        let jobs = store::list_jobs(&self.pool, None).await?;
        if jobs.is_empty() {
            return Ok("当前没有定时任务".to_string());
        }
        let mut output = String::from("定时任务列表:\n");
        for job in &jobs {
            let status = if job.enabled { "✅" } else { "⏸" };
            let schedule_desc = match &job.schedule {
                Schedule::Cron { expr, .. } => format!("cron: {}", expr),
                Schedule::Every { secs } => format!("每 {}s", secs),
                Schedule::At { ts } => format!("定时: {}", ts),
            };
            output.push_str(&format!(
                "\n{} {} [{}] {} (ID: {})",
                status, job.name, job.job_type, schedule_desc, job.id
            ));
        }
        Ok(output)
    }
}

/// cron_remove 工具
pub struct CronRemoveTool {
    pool: sqlx::SqlitePool,
    notify: std::sync::Arc<tokio::sync::Notify>,
}

impl CronRemoveTool {
    pub fn new(pool: sqlx::SqlitePool, notify: std::sync::Arc<tokio::sync::Notify>) -> Self {
        Self { pool, notify }
    }
}

#[async_trait]
impl Tool for CronRemoveTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "cron_remove".to_string(),
            description: "删除定时任务".to_string(),
            parameters: vec![
                ToolParameter { name: "job_id".into(), param_type: "string".into(), description: "任务 ID".into(), required: true },
            ],
        }
    }

    fn safety_level(&self) -> ToolSafetyLevel { ToolSafetyLevel::RequiresApproval }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let job_id = args["job_id"].as_str().ok_or("缺少 job_id")?;
        store::delete_job(&self.pool, job_id).await?;
        self.notify.notify_one();
        Ok(format!("已删除任务: {}", job_id))
    }
}

/// cron_update 工具
pub struct CronUpdateTool {
    pool: sqlx::SqlitePool,
    notify: std::sync::Arc<tokio::sync::Notify>,
}

impl CronUpdateTool {
    pub fn new(pool: sqlx::SqlitePool, notify: std::sync::Arc<tokio::sync::Notify>) -> Self {
        Self { pool, notify }
    }
}

#[async_trait]
impl Tool for CronUpdateTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "cron_update".to_string(),
            description: "修改定时任务（暂停/恢复/改调度/改执行配置）".to_string(),
            parameters: vec![
                ToolParameter { name: "job_id".into(), param_type: "string".into(), description: "任务 ID".into(), required: true },
                ToolParameter { name: "enabled".into(), param_type: "boolean".into(), description: "启用/禁用".into(), required: false },
                ToolParameter { name: "schedule".into(), param_type: "object".into(), description: "新调度配置".into(), required: false },
                ToolParameter { name: "action".into(), param_type: "object".into(), description: "新执行配置".into(), required: false },
            ],
        }
    }

    fn safety_level(&self) -> ToolSafetyLevel { ToolSafetyLevel::RequiresApproval }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let job_id = args["job_id"].as_str().ok_or("缺少 job_id")?;
        let patch = UpdateJobRequest {
            name: args["name"].as_str().map(|s| s.to_string()),
            enabled: args["enabled"].as_bool(),
            schedule: args.get("schedule").and_then(|v| serde_json::from_value(v.clone()).ok()),
            action_payload: args.get("action").and_then(|v| serde_json::from_value(v.clone()).ok()),
            timeout_secs: args["timeout_secs"].as_u64().map(|v| v as u32),
        };
        let job = store::update_job(&self.pool, job_id, &patch).await?;
        self.notify.notify_one();
        Ok(format!("已更新任务: {} ({})", job.name, job.id))
    }
}

/// cron_trigger 工具
pub struct CronTriggerTool {
    pool: sqlx::SqlitePool,
    notify: std::sync::Arc<tokio::sync::Notify>,
}

impl CronTriggerTool {
    pub fn new(pool: sqlx::SqlitePool, notify: std::sync::Arc<tokio::sync::Notify>) -> Self {
        Self { pool, notify }
    }
}

#[async_trait]
impl Tool for CronTriggerTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "cron_trigger".to_string(),
            description: "手动触发一次定时任务执行".to_string(),
            parameters: vec![
                ToolParameter { name: "job_id".into(), param_type: "string".into(), description: "任务 ID".into(), required: true },
            ],
        }
    }

    async fn execute(&self, args: serde_json::Value) -> Result<String, String> {
        let job_id = args["job_id"].as_str().ok_or("缺少 job_id")?;
        let job = store::get_job(&self.pool, job_id).await?;
        // 标记为手动触发，引擎下一轮会执行
        let now = chrono::Utc::now().timestamp();
        store::update_next_run(&self.pool, job_id, now, job.last_run_at.unwrap_or(0)).await?;
        self.notify.notify_one();
        Ok(format!("已触发任务: {}", job.name))
    }
}
```

**Step 2: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -5`
Expected: 编译成功

**Step 3: Commit**

```bash
git add src/scheduler/tools.rs
git commit -m "feat(scheduler): add 5 cron agent tools"
```


---

## Task 9: 模块入口 + Tauri Commands + main.rs 集成（mod.rs）

**Files:**
- Create: `local-app/src/scheduler/mod.rs`
- Modify: `local-app/src/main.rs`

**Step 1: 创建 mod.rs — SchedulerManager 公共 API**

```rust
//! 定时任务调度模块

pub mod types;
pub mod store;
pub mod planner;
pub mod runner;
pub mod engine;
pub mod heartbeat;
pub mod tools;

use std::sync::Arc;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use self::engine::SchedulerEngine;
use self::runner::JobRunner;

/// 调度管理器：持有引擎控制句柄
pub struct SchedulerManager {
    pool: sqlx::SqlitePool,
    notify: Arc<Notify>,
    shutdown: CancellationToken,
}

impl SchedulerManager {
    /// 创建并启动调度引擎
    pub fn start(
        pool: sqlx::SqlitePool,
        orchestrator: Arc<crate::agent::Orchestrator>,
        app_handle: tauri::AppHandle,
    ) -> Self {
        let notify = Arc::new(Notify::new());
        let shutdown = CancellationToken::new();

        let runner = Arc::new(JobRunner::new(
            pool.clone(),
            orchestrator,
            app_handle.clone(),
        ));

        let engine = SchedulerEngine::new(
            pool.clone(),
            notify.clone(),
            runner,
            shutdown.clone(),
            app_handle,
        );

        // 启动调度循环
        tokio::spawn(async move {
            engine.run().await;
        });

        Self { pool, notify, shutdown }
    }

    /// 唤醒调度循环（配置变更/手动触发后调用）
    pub fn wake(&self) {
        self.notify.notify_one();
    }

    /// 关闭调度引擎
    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }

    pub fn pool(&self) -> &sqlx::SqlitePool {
        &self.pool
    }

    pub fn notify(&self) -> Arc<Notify> {
        self.notify.clone()
    }
}
```

**Step 2: 在 main.rs 中添加 Tauri commands**

在 main.rs 中添加以下 command 函数：

```rust
// === 定时任务 Commands ===

#[tauri::command]
async fn create_cron_job(
    state: State<'_, Arc<AppState>>,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request: scheduler::types::CreateJobRequest = serde_json::from_value(payload)
        .map_err(|e| format!("参数错误: {}", e))?;
    let job = scheduler::store::add_job(state.scheduler.pool(), &request).await?;
    state.scheduler.wake();
    Ok(serde_json::to_value(&job).unwrap())
}

#[tauri::command]
async fn update_cron_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
    patch: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let request: scheduler::types::UpdateJobRequest = serde_json::from_value(patch)
        .map_err(|e| format!("参数错误: {}", e))?;
    let job = scheduler::store::update_job(state.scheduler.pool(), &job_id, &request).await?;
    state.scheduler.wake();
    Ok(serde_json::to_value(&job).unwrap())
}

#[tauri::command]
async fn delete_cron_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), String> {
    scheduler::store::delete_job(state.scheduler.pool(), &job_id).await?;
    state.scheduler.wake();
    Ok(())
}

#[tauri::command]
async fn list_cron_jobs(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<serde_json::Value>, String> {
    let jobs = scheduler::store::list_jobs(state.scheduler.pool(), None).await?;
    Ok(jobs.into_iter().map(|j| serde_json::to_value(&j).unwrap()).collect())
}

#[tauri::command]
async fn get_cron_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<serde_json::Value, String> {
    let job = scheduler::store::get_job(state.scheduler.pool(), &job_id).await?;
    Ok(serde_json::to_value(&job).unwrap())
}

#[tauri::command]
async fn pause_cron_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), String> {
    scheduler::store::disable_job(state.scheduler.pool(), &job_id).await?;
    state.scheduler.wake();
    Ok(())
}

#[tauri::command]
async fn resume_cron_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<(), String> {
    // 重新启用并重置 fail_streak
    scheduler::store::enable_job(state.scheduler.pool(), &job_id).await?;
    scheduler::store::reset_fail_streak(state.scheduler.pool(), &job_id).await?;
    state.scheduler.wake();
    Ok(())
}

#[tauri::command]
async fn trigger_cron_job(
    state: State<'_, Arc<AppState>>,
    job_id: String,
) -> Result<serde_json::Value, String> {
    let job = scheduler::store::get_job(state.scheduler.pool(), &job_id).await?;
    let now = chrono::Utc::now().timestamp();
    let run = scheduler::types::CronRun {
        id: uuid::Uuid::new_v4().to_string(),
        job_id: job.id.clone(),
        scheduled_at: now,
        started_at: None,
        finished_at: None,
        status: scheduler::types::RunStatus::Queued,
        trigger_source: scheduler::types::TriggerSource::Manual,
        attempt: 1,
        output: None,
        error: None,
    };
    scheduler::store::record_run(state.scheduler.pool(), &run).await?;
    state.scheduler.wake();
    Ok(serde_json::to_value(&run).unwrap())
}

#[tauri::command]
async fn list_cron_runs(
    state: State<'_, Arc<AppState>>,
    job_id: String,
    limit: Option<u32>,
) -> Result<Vec<serde_json::Value>, String> {
    let runs = scheduler::store::list_runs(state.scheduler.pool(), &job_id, limit.unwrap_or(20)).await?;
    Ok(runs.into_iter().map(|r| serde_json::to_value(&r).unwrap()).collect())
}

#[tauri::command]
async fn get_heartbeat_config(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    // 从 settings 表读取心跳配置
    let config = scheduler::store::get_heartbeat_config(state.scheduler.pool()).await?;
    Ok(serde_json::to_value(&config).unwrap())
}

#[tauri::command]
async fn update_heartbeat_config(
    state: State<'_, Arc<AppState>>,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let hb_config: scheduler::types::HeartbeatConfig = serde_json::from_value(config)
        .map_err(|e| format!("参数错误: {}", e))?;
    scheduler::store::save_heartbeat_config(state.scheduler.pool(), &hb_config).await?;
    state.scheduler.wake();
    Ok(serde_json::to_value(&hb_config).unwrap())
}

#[tauri::command]
async fn get_scheduler_status(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let jobs = scheduler::store::list_jobs(state.scheduler.pool(), None).await?;
    let total = jobs.len();
    let enabled = jobs.iter().filter(|j| j.enabled).count();
    let report = scheduler::heartbeat::health_check(
        state.scheduler.pool(), &state.app_handle
    ).await;
    Ok(serde_json::json!({
        "alive": true,
        "totalJobs": total,
        "enabledJobs": enabled,
        "healthReport": report,
    }))
}
```

**Step 3: 修改 AppState 和 setup**

```rust
// AppState 新增 scheduler 字段
struct AppState {
    db: db::Database,
    orchestrator: agent::Orchestrator,
    scheduler: scheduler::SchedulerManager,  // 新增
    app_handle: tauri::AppHandle,            // 新增（供 heartbeat 使用）
}

// setup 中初始化 scheduler（在 orchestrator 创建之后）
let orchestrator = Arc::new(orchestrator);
let scheduler = scheduler::SchedulerManager::start(
    pool.clone(),
    orchestrator.clone(),
    app.handle(),
);

// AppState 中包含 scheduler
let state = Arc::new(AppState {
    db,
    orchestrator: (*orchestrator).clone(), // 或调整为 Arc
    scheduler,
    app_handle: app.handle(),
});
```

**Step 4: 注册 commands 到 invoke_handler**

在 `invoke_handler` 的 `generate_handler![]` 中添加：

```rust
create_cron_job,
update_cron_job,
delete_cron_job,
list_cron_jobs,
get_cron_job,
pause_cron_job,
resume_cron_job,
trigger_cron_job,
list_cron_runs,
get_heartbeat_config,
update_heartbeat_config,
get_scheduler_status,
```

**Step 5: 添加 Tauri resumed 事件监听**

在 `app.run()` 的事件处理中添加：

```rust
tauri::RunEvent::Resumed => {
    // 系统从休眠唤醒，通知调度引擎
    if let Some(state) = _app_handle.try_state::<Arc<AppState>>() {
        state.scheduler.wake();
    }
}
```

**Step 6: 添加退出时 shutdown**

在 `ExitRequested` 处理中添加：

```rust
if let Some(state) = _app_handle.try_state::<Arc<AppState>>() {
    state.scheduler.shutdown();
}
```

**Step 7: 在 main.rs 顶部添加模块声明**

```rust
mod scheduler;
```

**Step 8: 验证编译**

Run: `cd local-app && cargo check 2>&1 | tail -10`
Expected: 编译成功

**Step 9: Commit**

```bash
git add src/scheduler/mod.rs src/main.rs
git commit -m "feat(scheduler): add SchedulerManager, Tauri commands, and main.rs integration"
```

---

## Task 10: 前端 CronPage（CronPage.tsx）

**Files:**
- Create: `frontend/src/pages/CronPage.tsx`
- Modify: `frontend/src/App.tsx`（添加路由）
- Modify: `frontend/src/pages/Dashboard.tsx`（添加导航入口）

**Step 1: 创建 CronPage.tsx**

主要组件结构：
- 任务列表面板（左侧/上方）
  - 每行显示：名称、类型图标（Agent/Shell/MCP）、调度表达式、状态（启用/暂停/失败）
  - 操作按钮：暂停/恢复、手动触发、编辑、删除
  - 右上角 [+ 新建任务] 按钮
- 运行记录面板（右侧/下方，选中任务后显示）
  - 每行：时间、状态图标、耗时、输出预览
  - 点击展开查看完整输出/错误
- 心跳状态栏（底部）
  - 健康状态指示灯（绿/黄/红）
  - 上次检查时间
  - [心跳设置] 按钮

新建/编辑任务表单（Modal）：
- 任务名称
- 类型选择（Agent/Shell/MCP Tool）
- 调度方式（Cron 表达式 / 固定间隔 / 一次性定时）
- 执行配置（根据类型动态显示）
  - Agent: 选择 Agent + 输入 prompt + session 策略
  - Shell: 输入命令
  - MCP: 选择 server + tool + 参数
- 高级设置（折叠）：超时、重试、Guardrails、misfire 策略

Tauri 事件监听：
- `cron-run-complete`: 刷新运行记录
- `heartbeat-alert`: 更新心跳状态
- `heartbeat-llm-alert`: 显示 LLM 心跳通知

**Step 2: 在 App.tsx 添加路由**

```tsx
import CronPage from './pages/CronPage'

// 在 Routes 中添加
<Route path="/cron" element={<CronPage />} />
```

**Step 3: 在 Dashboard 或侧边栏添加导航**

```tsx
<Link to="/cron">定时任务</Link>
```

**Step 4: 构建前端**

Run: `cd frontend && npm run build 2>&1 | tail -5`
Expected: 构建成功

**Step 5: Commit**

```bash
git add frontend/src/pages/CronPage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add CronPage for scheduled task management"
```

---

## Task 11: 注册 Agent 工具 + 端到端测试

**Files:**
- Modify: `local-app/src/agent/orchestrator.rs`（注册 cron 工具）
- Create: `local-app/tests/scheduler_test.rs`（集成测试）

**Step 1: 在 Orchestrator::new() 中注册 cron 工具**

在 `tool_manager` 注册内置工具的代码块末尾添加：

```rust
// 注意：cron 工具需要 pool 和 notify，在 SchedulerManager 启动后注册
// 改为在 SchedulerManager::start() 中调用 orchestrator.register_cron_tools()
```

或者在 SchedulerManager::start() 中：

```rust
// 注册 cron 工具到 orchestrator
let tools: Vec<Box<dyn Tool>> = vec![
    Box::new(tools::CronAddTool::new(pool.clone(), notify.clone())),
    Box::new(tools::CronListTool::new(pool.clone())),
    Box::new(tools::CronRemoveTool::new(pool.clone(), notify.clone())),
    Box::new(tools::CronUpdateTool::new(pool.clone(), notify.clone())),
    Box::new(tools::CronTriggerTool::new(pool.clone(), notify.clone())),
];
for tool in tools {
    orchestrator.tool_manager_mut().register_tool(tool);
}
```

**Step 2: 写集成测试**

```rust
// tests/scheduler_test.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cron_job_lifecycle() {
        // 1. 初始化内存 SQLite
        // 2. 创建 job
        // 3. 验证 list_jobs 返回 1 个
        // 4. 验证 due_jobs 在 next_run_at 之后返回该 job
        // 5. 更新 job
        // 6. 暂停 job
        // 7. 验证 due_jobs 不返回已暂停的 job
        // 8. 删除 job
        // 9. 验证 list_jobs 返回 0 个
    }

    #[tokio::test]
    async fn test_planner_cron_schedule() {
        // 验证 cron 表达式的 next_run 计算
    }

    #[tokio::test]
    async fn test_guardrails_max_concurrent() {
        // 创建 max_concurrent=1 的 job
        // 插入一个 running 状态的 run
        // 验证 check_guardrails 返回 false
    }

    #[tokio::test]
    async fn test_guardrails_fail_streak() {
        // 创建 max_consecutive_failures=3 的 job
        // 设置 fail_streak=3
        // 验证 job 被自动 disable
    }

    #[tokio::test]
    async fn test_recovery_scan_catch_up() {
        // 创建 misfire_policy=catch_up, catch_up_limit=2 的 job
        // 设置 next_run_at 为 3 小时前
        // 验证 recovery_scan 最多补执行 2 次
    }

    #[tokio::test]
    async fn test_output_truncation() {
        // 验证超过 16KB 的输出被截断
    }
}
```

**Step 3: 运行测试**

Run: `cd local-app && cargo test scheduler -- --nocapture 2>&1 | tail -20`
Expected: 所有测试通过

**Step 4: 全量测试**

Run: `cd local-app && cargo test 2>&1 | tail -5`
Expected: 所有测试通过（包括原有 137 个 + 新增测试）

**Step 5: Release 构建**

Run: `cd local-app && cargo build --release 2>&1 | tail -3`
Expected: 编译成功

**Step 6: Commit**

```bash
git add src/agent/orchestrator.rs src/scheduler/ tests/
git commit -m "feat(scheduler): register agent tools and add integration tests"
```

---

## 执行顺序总结

| Task | 内容 | 依赖 | 预估 |
|------|------|------|------|
| 1 | 添加依赖 | 无 | 2 min |
| 2 | types.rs 类型定义 | 1 | 5 min |
| 3 | DB schema + store.rs | 2 | 15 min |
| 4 | planner.rs 调度计算 | 2 | 10 min |
| 5 | runner.rs 执行引擎 | 2,3 | 15 min |
| 6 | engine.rs 核心循环 | 3,4,5 | 15 min |
| 7 | heartbeat.rs 双层心跳 | 3,6 | 10 min |
| 8 | tools.rs Agent 工具 | 3,4 | 10 min |
| 9 | mod.rs + Tauri commands + main.rs | 全部 | 15 min |
| 10 | CronPage.tsx 前端 | 9 | 20 min |
| 11 | 工具注册 + 集成测试 | 全部 | 15 min |

**关键路径**: 1 → 2 → 3 → 4/5(并行) → 6 → 7/8(并行) → 9 → 10/11(并行)

