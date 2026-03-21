//! 调度引擎：sleep-to-earliest + Notify + catch-up + stuck 检测

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

use super::{store, planner, types::*};
use super::runner::{JobRunner, ExecResult};
use tauri::Manager;

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
            semaphore: Arc::new(Semaphore::new(3)),
            shutdown,
            app_handle,
        }
    }

    /// 启动调度循环
    pub async fn run(&self) {
        log::info!("调度引擎启动");

        // 启动时：取消上次未完成的 run
        if let Err(e) = store::cancel_running_runs(&self.pool).await {
            log::error!("取消残留 run 失败: {}", e);
        }
        self.recovery_scan().await;

        let mut last_tick = Instant::now();
        let mut last_health_check = Instant::now();

        loop {
            // 1. 休眠唤醒检测
            if last_tick.elapsed() > Duration::from_secs(RECOVERY_THRESHOLD_SECS) {
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

            // 8. anti-spin
            tokio::time::sleep(Duration::from_millis(MIN_REFIRE_GAP_MS)).await;
        }

        // 优雅退出
        log::info!("等待执行中的任务完成...");
        let _ = tokio::time::timeout(
            Duration::from_secs(10),
            self.semaphore.acquire_many(3),
        ).await;
        if let Err(e) = store::cancel_running_runs(&self.pool).await {
            log::error!("退出时取消 run 失败: {}", e);
        }
        log::info!("调度引擎已停止");
    }

    /// Guardrails 检查
    async fn check_guardrails(&self, job: &CronJob) -> bool {
        // anti-spin
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
            if job.runs_today >= max {
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

            // 记录 running
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
            let finished = chrono::Utc::now().timestamp();
            if let Ok(Some(next)) = planner::next_run_after(&job.schedule, finished) {
                let _ = store::update_next_run(&pool, &job.id, next, finished).await;
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

            notify.notify_one();
            drop(permit);
        });
    }

    /// 重新调度（跳过执行但更新 next_run_at）
    async fn reschedule_job(&self, job: &CronJob) {
        let now = chrono::Utc::now().timestamp();
        if let Ok(Some(next)) = planner::next_run_after(&job.schedule, now) {
            let _ = store::update_next_run(&self.pool, &job.id, next, now).await;
        }
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
                if let Ok(Some(next)) = planner::next_run_after(&job.schedule, now) {
                    let _ = store::update_next_run(&self.pool, &job.id, next, now).await;
                }
                continue;
            }

            // catch_up: stagger 防雷群
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
        let report = self.build_health_report().await;
        if report.has_issues() {
            log::warn!("健康检查发现问题: stuck={}, high_fail={}, disabled={}",
                report.stuck_runs.len(), report.high_fail_jobs.len(), report.auto_disabled_jobs.len());
            let _ = self.app_handle.emit_all("heartbeat-alert", &report);
        }
    }

    /// 构建健康报告
    pub async fn build_health_report(&self) -> HealthReport {
        let stuck = store::timeout_stuck_runs(&self.pool, STUCK_RUN_THRESHOLD_SECS).await.unwrap_or(0);
        let high_fail = store::high_fail_jobs(&self.pool, 3).await.unwrap_or_default();
        let disabled = store::auto_disabled_jobs(&self.pool).await.unwrap_or_default();
        let failure_rate = store::recent_failure_rate(&self.pool, 3600).await.unwrap_or(0.0);

        HealthReport {
            scheduler_alive: true,
            stuck_runs: if stuck > 0 {
                vec![format!("{} 个 stuck run 已超时", stuck)]
            } else {
                vec![]
            },
            high_fail_jobs: high_fail,
            auto_disabled_jobs: disabled,
            recent_failure_rate: failure_rate,
        }
    }
}
