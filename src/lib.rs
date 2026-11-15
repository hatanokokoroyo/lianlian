//! 练练的 Rust 侧：领域数据、库、模型网关都在这里，TSX 只经由 `lianlian/native`
//! 声明的入口拿数据。
//!
//! - `anatomy`：解剖学部位词表（随包编译的静态数据）；
//! - `domain`：五轴取值、档案条目只追加、投影与聚合——纯函数、零 IO；
//! - `store`：redb 单文件；
//! - `api`：对 TSX 暴露的类型与入口。

mod api;
pub mod anatomy;
pub mod domain;
pub mod llm;
pub mod store;

use nsh_core::prelude::*;

/// crate 的 UI 集合（`nsh.json` 的 `"rust"`）。
#[native_module("lianlian/native")]
fn native(registry: &mut Registry) {
    registry.module::<api::Profile>();
    registry.module::<api::Measurements>();
    registry.module::<api::Conversations>();
    registry.module::<api::Settings>();
}
