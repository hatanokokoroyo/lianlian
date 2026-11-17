GitHub: #28
Status: resolved
Type: task

# 28: 档案根页收成区域索引 + 区域页

**What to build:** 档案根页不再渲染单条部位卡：保留计划卡（现有完整形态），下方显示全部区域索引；点区域进入区域页，区域页复用现有五轴、依据展开、时间线、标记已解决与判定有误。读模型补 `SiteSectionView.kind`（muscle/bone），供区域页聚合标题与后续关注块使用。返回键回到档案根页。

**Blocked by:** None（可立即开始）

**Status:** resolved

- [x] 根页只显示计划卡、区域索引与现有数据区，不出现 `site-*` 部位卡。
- [x] 区域索引只列有生效判定的区域，每块显示条数、最差状态/最近时间；`archive-section-{id}` 可进入区域页。
- [x] 区域页显示该区域全部部位卡，五轴、依据、时间线、解决/撤回与现有行为一致；返回根页。
- [x] 根页条数与区域页卡片数一致；已解决但仍有生效判定的区域仍出现。
- [x] `SiteSectionView.kind` 在 Rust 读模型与 TSX 类型中可用，肌群/骨骼聚合标题正确。
- [x] `Findings.test.tsx` 改为“进入区域 → 操作 → 返回”，覆盖计数一致性；`nsh check` 与 `nsh test` 通过。

## Comments

- 2026-11-17 交付：根页收成区域索引，区域详情进入区域页；`SiteSectionView.kind` 贯通 Rust 与 TSX。
- 验证：`nsh check` 通过；`nsh test` 273 tests（272 passed / 1 skipped）。`Findings.test.tsx` 覆盖进入/返回、根页条数与区域页卡片数一致、骨骼区域聚合标题。
