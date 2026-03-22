//! Desktop Bridge — 连接 Cloud Gateway
//!
//! 通过 WebSocket 连接云端，注册能力，接收转发消息，同步数据。
//! 参考混合架构设计文档：docs/plans/2026-03-19-hybrid-architecture-design.md

pub mod client;

pub use client::{BridgeClient, BridgeConfig};
