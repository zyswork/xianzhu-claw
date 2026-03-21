//! 运行时环境管理
//!
//! 自动下载、缓存和管理 Node.js 等运行时依赖，
//! 消除用户手动安装的需要。

pub mod node;

pub use node::NodeRuntime;
