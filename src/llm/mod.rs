//! 模型网关与装配（ADR-0006）。
//!
//! - `prompt`：按 `[系统提示][本会话历史][档案投影 + 训练条件 + 未结提议][本轮消息]`
//!   装配，纯函数；
//! - `deepseek`：DeepSeek 的 Responses 实现（无状态、多轮自拼），错误按「出路」分类。

pub mod deepseek;
pub mod prompt;
