# Phase 5: BackendManager 生命周期所有权问题修复

## 问题分析

**规格要求缺陷**: 后端清理流程无法执行

**问题位置**: `local-app/src/main.rs` L61-78

**技术根因**: Rust 所有权冲突
- BackendManager 被 `app.run()` 的 move 闭包捕获
- app.run() 返回时，BackendManager 已被消费，无法访问
- L76 的 `backend_manager.stop().await` 无法执行

## 修复方案

使用 `Arc<Mutex<BackendManager>>` 实现正确的所有权和生命周期管理。

### 实现要点

1. **导入必需的模块** (L17)
   ```rust
   use std::sync::{Arc, Mutex};
   ```

2. **包装 BackendManager** (L53)
   ```rust
   let backend_manager = Arc::new(Mutex::new(backend_manager::BackendManager::new()));
   ```
   - Arc (Atomic Reference Counting) 提供原子引用计数，支持多所有者
   - Mutex 提供内部可变性，允许通过不可变引用修改内容

3. **启动后端进程** (L55-67)
   ```rust
   {
     let mut bm = backend_manager.lock().unwrap();
     match bm.start().await {
       // ...
     }
   }  // 自动释放 lock
   ```
   - 在作用域内获取 lock，使用完毕后自动释放
   - 确保后续代码可以继续使用 backend_manager

4. **应用事件循环中处理退出** (L75-94)
   ```rust
   let backend_manager_clone = backend_manager.clone();
   app.run(move |_app_handle, event| {
     if let tauri::RunEvent::ExitRequested { api, .. } = event {
       api.prevent_exit();
       
       // 在单独的线程中执行异步清理
       let backend_manager_clone = backend_manager_clone.clone();
       std::thread::spawn(move || {
         let rt = tokio::runtime::Runtime::new().unwrap();
         rt.block_on(async {
           if let Ok(mut bm) = backend_manager_clone.lock() {
             log::info!("应用关闭，停止后端进程...");
             bm.stop().await;
             log::info!("✓ 后端进程已停止");
           }
           std::process::exit(0);
         });
       });
     }
   });
   ```

### 关键技术细节

1. **Arc::clone() vs std::clone()**
   - Arc::clone() 增加引用计数，轻量级操作
   - 不复制实际的 BackendManager 数据

2. **异步清理实现**
   - 不能在 ExitRequested 事件闭包中直接 await（闭包不是 async）
   - 解决方案：使用 `tokio::runtime::Runtime::new()` 创建新运行时
   - `rt.block_on(async { ... })` 在新线程中同步执行异步代码

3. **进程退出流程**
   - api.prevent_exit() 防止立即退出
   - 执行清理操作
   - std::process::exit(0) 确保应用完全退出

## 规格合规验证

✓ **后端清理流程执行**: 在 ExitRequested 事件中执行
✓ **BackendManager.stop() 调用**: L87 中正确调用
✓ **日志记录**: L86, L88 记录清理过程
✓ **所有权问题解决**: Arc<Mutex<>> 模式允许多个所有者
✓ **编译检查通过**: cargo check 无关于 main.rs 的错误

## 提交信息

```
fix: phase 5 - 修复 BackendManager 生命周期所有权问题

- 使用 Arc<Mutex<>> 实现 BackendManager 的共享所有权
- 解决后端清理流程无法执行的问题
- 在应用 ExitRequested 事件中创建独立线程执行异步清理
- 确保后端进程被正确停止后应用才退出
```

## 改进点总结

| 维度 | 改进 |
|-----|------|
| 所有权 | 从单一所有权 → Arc 共享所有权 |
| 生命周期 | 从 app.run() 结束即销毁 → 显式清理后销毁 |
| 清理方式 | 从无法执行 → 在专属线程中异步执行 |
| 资源泄漏 | 修复：确保后端进程被清理 |

