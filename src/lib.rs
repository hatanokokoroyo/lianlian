//! 练练的 Rust 侧：领域数据、库、模型网关都在这里，TSX 只经由 `lianlian/native`
//! 声明的入口拿数据。现在只有「今日页读一个训练日」这一条链路。

mod api;
mod store;

use nsh_core::prelude::*;

/// crate 的 UI 集合（`nsh.json` 的 `"rust"`）。
#[native_module("lianlian/native")]
fn native(registry: &mut Registry) {
    registry.module::<api::Today>();
}
