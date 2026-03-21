# Cron 定时任务 + Heartbeat 心跳机制设计

> 日期：2026-03-17
> 状态：已批准

## 背景

my-openclaw 桌面应用缺少定时任务和心跳机制。参考 ironclaw（Guardrails、执行分级、quiet hours）、zeroclaw（SQLite + retry + 指数退避）、openclaw（anti-spin、missed job 追赶、stuck 检测）三个项目的优点，设计适合桌面单用户场景的方案。

## 架构决策

**方案 D：中心调度循环 + DB 状态机 + Notify 唤醒**

- 单个 tokio task 作为调度引擎，睡到最早 `next_run_at`（上限 60s）
- 配置变更/手动触发/休眠唤醒时通过 `tokio::sync::Notify` 提前唤醒
- 所有状态持久化在 SQLite，重启/休眠唤醒后自然恢复
- 全局 `Semaphore`（默认 3）控制并发

**选择理由**：
- 比纯轮询更及时（精确到秒级）
- 比 per-job timer 更可靠（DB 为真相源，休眠唤醒无需重建 timer）
- 复杂度适中（仅多一个 Notify + select!）

## 模块结构

```
src/scheduler/
  mod.rs           // SchedulerManager 公共 API + 模块导出
  types.rs         // CronJob, Schedule, JobType, ActionPayload, RunRecord, Guardrails
  store.rs         // SQLite CRUD（sqlx async）
  planner.rs       // next_run 计算：cron 表达式 / At / Every
  engine.rs        // 核心调度循环：sleep-to-earliest + Notify + catch-up + stuck 检测
  runner.rs        // 执行引擎：Shell / Agent / MCP，超时 + 重试 + 截断
  heartbeat.rs     // 双层心跳：程序化状态监控 + LLM 智能心跳
  tools.rs         // Agent 可调用的 cron 工具（cron_add/list/remove/update/trigger）
```

## 数据模型

### SQL Schema

```sql
CREATE TABLE IF NOT EXISTS cron_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_id TEXT,
    job_type TEXT NOT NULL CHECK(job_type IN ('agent','shell','mcp_tool')),
    -- 调度配置
    schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('cron','every','at')),
    cron_expr TEXT,
    every_secs INTEGER,
    at_ts INTEGER,
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    -- 执行配置
    action_payload TEXT NOT NULL,
    timeout_secs INTEGER NOT NULL DEFAULT 300,
    -- Guardrails
    max_concurrent INTEGER NOT NULL DEFAULT 1,
    cooldown_secs INTEGER NOT NULL DEFAULT 0,
    max_daily_runs INTEGER,
    max_consecutive_failures INTEGER NOT NULL DEFAULT 5,
    -- 重试
    retry_max INTEGER NOT NULL DEFAULT 0,
    retry_base_delay_ms INTEGER NOT NULL DEFAULT 2000,
    retry_backoff_factor REAL NOT NULL DEFAULT 2.0,
    -- Missed job 策略
    misfire_policy TEXT NOT NULL DEFAULT 'catch_up' CHECK(misfire_policy IN ('skip','catch_up')),
    catch_up_limit INTEGER NOT NULL DEFAULT 3,
    -- 运行状态
    enabled INTEGER NOT NULL DEFAULT 1,
    fail_streak INTEGER NOT NULL DEFAULT 0,
    runs_today INTEGER NOT NULL DEFAULT 0,
    runs_today_date TEXT,
    next_run_at INTEGER,
    last_run_at INTEGER,
    delete_after_run INTEGER NOT NULL DEFAULT 0,
    -- 元数据
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_cron_jobs_due ON cron_jobs(enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status);
```

### 核心类型

```rust
pub enum Schedule {
    Cron { expr: String, tz: String },
    Every { secs: u64 },
    At { ts: i64 },
}

pub enum JobType { Agent, Shell, McpTool }

pub struct ActionPayload {
    // Agent: { prompt, session_strategy: "new"|"reuse" }
    // Shell: { command }
    // McpTool: { server_name, tool_name, args }
}

pub struct Guardrails {
    pub max_concurrent: u32,
    pub cooldown_secs: u32,
    pub max_daily_runs: Option<u32>,
    pub max_consecutive_failures: u32,
}
```

## 调度引擎（engine.rs）

### 核心循环

```rust
pub struct SchedulerEngine {
    pool: SqlitePool,
    notify: Arc<Notify>,
    runner: Arc<JobRunner>,
    semaphore: Arc<Semaphore>,     // 全局并发控制（默认 3）
    shutdown: CancellationToken,
}

// 循环伪代码
loop {
    // 1. 休眠唤醒检测：wall clock 跳变 > 90s → recovery_scan
    if last_tick.elapsed() > Duration::from_secs(90) {
        self.recovery_scan().await;
    }

    // 2. 查最早到期时间，计算 sleep 时长
    let earliest = store::earliest_next_run(&self.pool).await;
    let delay = match earliest {
        Some(ts) => min(ts - now, 60s),
        None => 60s,
    };

    // 3. sleep 或被唤醒
    tokio::select! {
        _ = self.notify.notified() => {}
        _ = tokio::time::sleep(delay) => {}
        _ = self.shutdown.cancelled() => break,
    }

    // 4. 批量取到期任务 + Guardrails 检查 + spawn 执行
    // 5. stuck run 检测（running > 2h → timeout）
    // 6. anti-spin: MIN_REFIRE_GAP 2s
}
```

### Guardrails 检查

- max_concurrent: 查 running 状态的 run 数量
- cooldown: last_run_at + cooldown_secs > now → skip
- max_daily_runs: runs_today >= limit → skip
- max_consecutive_failures: fail_streak >= limit → 自动 disable
- anti-spin: MIN_REFIRE_GAP 2s

### Recovery Scan（休眠唤醒后）

- 找所有 next_run_at < now 且 misfire_policy = 'catch_up' 的 job
- 每个 job 最多补执行 catch_up_limit 次
- 按 hash(job_id) % 5s stagger 防雷群
- misfire_policy = 'skip' 的直接更新 next_run_at 到下一次

### 优雅退出

- Tauri exit_requested → shutdown_token.cancel()
- running 的 run 标记 status='cancelled'
- 等待 semaphore 所有 permit 归还（最多 10s）

## 执行引擎（runner.rs）

### 三种 JobType

- **Agent**：调用 `orchestrator.send_message_stream()`，收集 token 拼接为 output
  - session_strategy: "new"（每次新建）或 "reuse"（复用固定 session）
- **Shell**：`tokio::process::Command::new("sh").args(["-c", &command])`，120s 默认超时
- **MCP 工具**：`mcp_manager.call_tool(&server, &tool, &args)`

### 重试

指数退避：`base_delay * backoff_factor^(attempt-1)`，上限 10 分钟。

### 输出截断

MAX_OUTPUT_BYTES = 16KB，超出追加 `\n...[truncated]`。

### 前端通知

执行完成后 `app_handle.emit_all("cron-run-complete", payload)`。

## Heartbeat 双层心跳

### 第一层：程序化状态监控

内置在调度引擎中，每 5 分钟执行：
- stuck run 检测（running > 2h）
- 连续失败 job 检测（fail_streak >= 3）
- 最近 1h 失败率 > 50% 告警
- 自动禁用的 job 列表
- 状态变更时 `emit_all("heartbeat-alert", report)`

### 第二层：LLM 智能心跳

特殊内置 cron job，默认 30 分钟间隔：
1. 读取 HEARTBEAT.md 检查清单
2. 注入 HealthReport 作为上下文
3. 调用 Orchestrator 执行一轮 Agent 对话
4. 回复包含 HEARTBEAT_OK → 静默
5. 否则 → 推送结果到前端

### Quiet Hours

- 配置 start_hour / end_hour / timezone
- 静默时段：程序化监控只写 DB 不推送，LLM 心跳跳过执行
- 普通 cron job 不受影响

### HEARTBEAT.md 格式

```markdown
# Heartbeat Checklist

- 检查最近 1 小时是否有任务连续失败
- 检查磁盘空间是否充足（>10%）
- 检查是否有超过 24 小时未执行的启用任务
```

## Agent 工具（tools.rs）

5 个工具注册到 ToolManager：
- `cron_add` — 创建定时任务
- `cron_list` — 列出任务（支持过滤）
- `cron_remove` — 删除任务
- `cron_update` — 修改任务
- `cron_trigger` — 手动触发执行

## Tauri Commands

```rust
// CRUD
create_cron_job(payload) -> CronJob
update_cron_job(job_id, patch) -> CronJob
delete_cron_job(job_id)
list_cron_jobs(filter?) -> Vec<CronJob>
get_cron_job(job_id) -> CronJob

// 操作
pause_cron_job(job_id)
resume_cron_job(job_id)
trigger_cron_job(job_id) -> RunRecord

// 运行记录
list_cron_runs(job_id, limit?) -> Vec<RunRecord>

// 心跳
get_heartbeat_config() -> HeartbeatConfig
update_heartbeat_config(patch) -> HeartbeatConfig

// 状态
get_scheduler_status() -> SchedulerStatus
```

## 前端页面

新增 `CronPage.tsx`：
- 任务列表（状态、调度、类型、操作按钮）
- 运行记录（选中任务的历史执行）
- 心跳状态面板
- 新建/编辑任务表单

## 集成点

- `main.rs`: AppState 新增 scheduler，setup 阶段初始化，exit 时 shutdown，resumed 事件 notify
- `orchestrator.rs`: 无改动，runner 通过现有接口调用
- `mcp_manager.rs`: 新增 `call_tool()` 公共方法
- `agent/tools.rs`: 注册 5 个 cron_* 工具

## 依赖

- `cron`: cron 表达式解析（Rust crate）
- `chrono-tz`: 时区支持
- `tokio-util`: CancellationToken
