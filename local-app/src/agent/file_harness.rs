//! 文件编辑安全层（Harness）
//!
//! - Hash 校验：读取时记录内容 hash，编辑时校验是否被外部修改
//! - 自动备份：编辑前创建备份，支持回滚
//!
//! 这是 harness 侧逻辑，不依赖 LLM 传回任何信息。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// 全局文件 hash 注册表（path → sha256 hex）
static HASH_REGISTRY: OnceLock<Mutex<HashMap<PathBuf, String>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<PathBuf, String>> {
    HASH_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 计算内容的 sha256 hex（简化实现，用内置 hash）
fn content_hash(content: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    content.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// 读取后注册文件 hash
pub fn register_read(path: &str, content: &str) -> String {
    let hash = content_hash(content);
    let canonical = PathBuf::from(path);
    if let Ok(mut reg) = registry().lock() {
        reg.insert(canonical, hash.clone());
        // 清理超过 500 个条目（LRU 简化：直接清空最旧的一半）
        if reg.len() > 500 {
            let keys: Vec<PathBuf> = reg.keys().take(250).cloned().collect();
            for k in keys { reg.remove(&k); }
        }
    }
    hash
}

/// 编辑前校验文件是否被外部修改
///
/// 返回 Ok(()) 表示安全，Err 表示文件已变化
pub fn verify_before_edit(path: &str, current_content: &str) -> Result<(), String> {
    let canonical = PathBuf::from(path);
    if let Ok(reg) = registry().lock() {
        if let Some(recorded_hash) = reg.get(&canonical) {
            let current_hash = content_hash(current_content);
            if &current_hash != recorded_hash {
                return Err(format!(
                    "文件 {} 自上次读取后已被外部修改（hash 不匹配: {} → {}）。请重新读取文件再编辑。",
                    path, &recorded_hash[..8], &current_hash[..8]
                ));
            }
        }
        // 没有记录的 hash → 首次编辑，不校验
    }
    Ok(())
}

/// 编辑后更新 hash
pub fn update_hash(path: &str, new_content: &str) {
    let hash = content_hash(new_content);
    let canonical = PathBuf::from(path);
    if let Ok(mut reg) = registry().lock() {
        reg.insert(canonical, hash);
    }
}

// ─── 备份系统 ───────────────────────────────────────────────

/// 备份目录根路径
fn backup_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".xianzhu/backups")
}

/// 单文件最大备份大小（5MB）
const MAX_BACKUP_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// 总备份目录最大大小（500MB）
const MAX_BACKUP_DIR_SIZE: u64 = 500 * 1024 * 1024;

/// 编辑前自动备份文件
///
/// 返回备份路径（如果成功），或 None（文件不存在/太大/跳过）
pub fn backup_before_edit(path: &str) -> Option<String> {
    let src = Path::new(path);
    if !src.exists() { return None; }

    // 检查文件大小
    let meta = std::fs::metadata(src).ok()?;
    if meta.len() > MAX_BACKUP_FILE_SIZE {
        log::info!("file_harness: 跳过备份（文件太大: {} > {}）: {}", meta.len(), MAX_BACKUP_FILE_SIZE, path);
        return None;
    }

    // 构建备份路径：~/.xianzhu/backups/{timestamp}_{filename}
    let filename = src.file_name()?.to_string_lossy().to_string();
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S%.3f");
    let backup_name = format!("{}_{}", timestamp, filename);
    let backup_dir = backup_root();
    let _ = std::fs::create_dir_all(&backup_dir);
    let backup_path = backup_dir.join(&backup_name);

    // 复制文件
    match std::fs::copy(src, &backup_path) {
        Ok(_) => {
            log::info!("file_harness: 已备份 {} → {}", path, backup_path.display());
            // 清理旧备份（异步，不阻塞）
            cleanup_backups_if_needed();
            Some(backup_path.to_string_lossy().to_string())
        }
        Err(e) => {
            log::warn!("file_harness: 备份失败: {} — {}", path, e);
            None
        }
    }
}

/// 列出所有备份（最近的在前）
pub fn list_backups() -> Vec<(String, String, u64)> {
    let dir = backup_root();
    let mut backups = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    backups.push((
                        entry.path().to_string_lossy().to_string(),
                        entry.file_name().to_string_lossy().to_string(),
                        meta.len(),
                    ));
                }
            }
        }
    }
    backups.sort_by(|a, b| b.0.cmp(&a.0)); // 最新在前
    backups
}

/// 回滚：将备份文件恢复到原始位置
pub fn rollback(backup_path: &str, target_path: &str) -> Result<(), String> {
    let src = Path::new(backup_path);
    if !src.exists() {
        return Err(format!("备份文件不存在: {}", backup_path));
    }
    std::fs::copy(src, target_path)
        .map_err(|e| format!("恢复失败: {}", e))?;
    // 更新 hash
    if let Ok(content) = std::fs::read_to_string(target_path) {
        update_hash(target_path, &content);
    }
    log::info!("file_harness: 已回滚 {} → {}", backup_path, target_path);
    Ok(())
}

/// 清理备份（总大小超限时删除最旧的）
fn cleanup_backups_if_needed() {
    let dir = backup_root();
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total_size: u64 = 0;

    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    total_size += meta.len();
                    files.push((entry.path(), meta.len(), mtime));
                }
            }
        }
    }

    if total_size <= MAX_BACKUP_DIR_SIZE { return; }

    // 按时间排序，最旧的在前
    files.sort_by(|a, b| a.2.cmp(&b.2));

    // 删除最旧的直到总大小低于限制
    for (path, size, _) in &files {
        if total_size <= MAX_BACKUP_DIR_SIZE { break; }
        if std::fs::remove_file(path).is_ok() {
            total_size -= size;
            log::info!("file_harness: 清理旧备份: {}", path.display());
        }
    }
}
