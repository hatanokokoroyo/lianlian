GitHub: #3
Status: resolved
Type: task
# 词表 / 五轴 / Finding 领域与存储

**What to build:** 领域层的第一块：解剖部位词表（静态数据）、五轴枚举、Finding 与 Correction 的只追加语义、肌群聚合，以及 redb 的建表与 schema 版本。做到"能写入一条真实判定、能从库里按时间读回来"。零 IO 的规则都在这里，所以这一层是 `cargo test` 的主战场。

**Blocked by:** None (can start immediately)

- [x] 部位词表随包编译：每条含 id、中文名、英文名、拉丁名（现行首选形）、拉丁别名、所属肌群（可多值）、左右成对、父级、粒度，带 schema 版本
- [x] 部位 id 不在词表内时被拒；`左右成对 = yes` 而缺侧别时被拒；中线结构带侧别时被拒
- [x] 五轴枚举齐全（张力/对称/活动度/疼痛/稳定性），非法取值在落库前被拒
- [x] 写入 Finding 后可读回并按时间排序
- [x] 撤回后投影不再包含该条，"已解决"体现为最新取值为正常，历史条目仍在
- [x] 肌群聚合返回成员中的最差值；骨骼集合行按"子项优先于父项"聚合
- [x] 以上全部由表驱动单测覆盖，零网络零 UI

## Comments

### hatanokokoroyo · 2026-11-15T13:47:43Z

做完，落在 `src/anatomy/`、`src/domain/`、`src/store/` 三层。

**词表**：内容是 `src/anatomy/sites.rs`，由 `scripts/gen-anatomy.py` 从 `.scratch/body-profile/anatomy-sites.md`（那份审计过的 markdown）生成——人工真源仍是 markdown，`--check` 会在两边不一致时报错。119 条可记录部位（79 肌肉 + 40 骨骼/集合区域）+ 23 个肌群，字段齐全（`zh`/`en`/`latin`/`latin_aliases`/`groups`/`region`/`paired`/`parent`/`granularity`），词表 `SCHEMA_VERSION` 单独一行。词表自检也是测试：id 跨三表唯一、肌群成员双向一致、无归属肌肉为 0、集合区域恰好是审计后的 6 行、中线判定只剩膈。

**五轴**：`tension`/`symmetry`/`mobility`/`pain`/`stability` 全是枚举，`Pain` 是 0–10 的 newtype（0 = 无痛），解析同时接受机器键与中文（模型会说"左弱""受限""紧"）。未知取值、疼痛越界都是 `DomainError`，错误文案是写给模型看的（告诉它可选值是什么）。

**只追加与投影**：`Finding` 一旦写入不可改；撤回是独立的 `Retract`（理由必填、不能撤两次、不能撤不存在的）。`Projection::from_events` 先把被撤回的条目整体剔除，再按「时间、编号」取每个「部位 + 侧别」的最后一条——所以撤掉最新一条会自动退回到上一条，而不是留空。`FindingDraft::resolve` 覆盖原判定测过的轴、全部取正常值，历史条目仍在时间线上。

**聚合**：肌群逐轴取最差值（成员侧别按查询方给的侧别，中线成员如膈无侧别）；「未测」不参与聚合，也不当成正常。骨骼集合行按 ADR-0003 修订实现「子项优先于父项」：子项测过的轴用子项的，没测的轴留父项的。

**存储**：redb 表 `findings` / `retracts`（值是 JSON），`meta.next_finding_id` 单调递增且不随重开库重置；库结构版本升到 3，版本对不上就重建（骨架期不做迁移）。判定按（时间，编号）读回，不按写入顺序。

测试 40 条全过（`cargo test`），`nsh test` 41 条（含今日页 headless 测试）全过；真机上重装宿主后今日页照常（`pm clear` 后重建库）。
