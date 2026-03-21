//! 速率限制器 — Token Bucket 算法
//!
//! 限制 per-agent 的请求频率，防止滥用。

use std::collections::HashMap;
use std::time::Instant;

/// 速率限制配置
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// 每分钟最大请求数
    pub max_requests_per_minute: u32,
    /// 每分钟最大 token 数（0 = 不限）
    pub max_tokens_per_minute: u64,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests_per_minute: 30,
            max_tokens_per_minute: 0, // 默认不限 token
        }
    }
}

/// Token Bucket 状态
struct Bucket {
    tokens: f64,
    last_refill: Instant,
    capacity: f64,
    refill_rate: f64, // tokens per second
}

impl Bucket {
    fn new(capacity: f64) -> Self {
        Self {
            tokens: capacity,
            last_refill: Instant::now(),
            capacity,
            refill_rate: capacity / 60.0, // 每秒补充 capacity/60
        }
    }

    /// 尝试消耗一个 token，返回是否允许
    fn try_consume(&mut self) -> bool {
        self.refill();
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// 补充 token
    fn refill(&mut self) {
        let elapsed = self.last_refill.elapsed().as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_rate).min(self.capacity);
        self.last_refill = Instant::now();
    }

    /// 距离下一个 token 可用的等待时间（毫秒）
    fn wait_time_ms(&self) -> u64 {
        if self.tokens >= 1.0 { return 0; }
        let needed = 1.0 - self.tokens;
        (needed / self.refill_rate * 1000.0).ceil() as u64
    }
}

/// 速率限制器
pub struct RateLimiter {
    config: RateLimitConfig,
    /// per-agent buckets
    buckets: std::sync::Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            config,
            buckets: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// 检查是否允许请求
    ///
    /// 返回 Ok(()) 或 Err(等待毫秒数)
    pub fn check(&self, agent_id: &str) -> Result<(), u64> {
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());

        let bucket = buckets.entry(agent_id.to_string()).or_insert_with(|| {
            Bucket::new(self.config.max_requests_per_minute as f64)
        });

        if bucket.try_consume() {
            Ok(())
        } else {
            let wait = bucket.wait_time_ms();
            log::warn!("速率限制: agent={}, 需等待 {}ms", agent_id, wait);
            Err(wait)
        }
    }

    /// 重置某 agent 的限制
    pub fn reset(&self, agent_id: &str) {
        if let Ok(mut buckets) = self.buckets.lock() {
            buckets.remove(agent_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_allows() {
        let limiter = RateLimiter::new(RateLimitConfig {
            max_requests_per_minute: 10,
            max_tokens_per_minute: 0,
        });

        // 前 10 个请求应该通过
        for _ in 0..10 {
            assert!(limiter.check("agent1").is_ok());
        }

        // 第 11 个应该被限制
        assert!(limiter.check("agent1").is_err());
    }

    #[test]
    fn test_rate_limiter_per_agent() {
        let limiter = RateLimiter::new(RateLimitConfig {
            max_requests_per_minute: 5,
            max_tokens_per_minute: 0,
        });

        for _ in 0..5 {
            assert!(limiter.check("agent1").is_ok());
        }
        assert!(limiter.check("agent1").is_err());

        // agent2 不受影响
        assert!(limiter.check("agent2").is_ok());
    }
}
