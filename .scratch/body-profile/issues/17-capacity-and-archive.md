GitHub: #17
Status: resolved
Type: task
Blocked by: 13, 14

# 17: 容量仪表、会话阈值与归档

**What to build:** 收尾的容量与会话治理：档案页显示本地数据占用；删除会话后依据日志仍在并标注"来源会话已删除"。（会话长度阈值已拆到 #18，它只依赖已完成的 #7。）

**Blocked by:** #13, #14

**Status:** resolved

- [x] 档案页显示已用容量与各表占比
- [x] 删除会话后依据日志仍可被 `search_evidence` 检索到，且标注来源已删除
- [x] 归档会话不影响任何档案数据

## Comments

- 2026-11-15：把「会话长度阈值（20 万提示 / 50 万强制新开）」拆成 #18 —— 它只依赖已完成的 #7，
  不必等到 #13/#14。本工单只留容量仪表与删除会话后依据日志保留；阻塞边不变。
- 2026-11-16：已交付 `a263f45`。`Store` 保留库路径，`file_bytes()` 读文件大小，`table_usage()`
  通过 redb 的 `list_tables` + `ReadableTableMetadata::stats` 统计各表；照片目录另算。
  `Storage.load` 返回总量、数据库、照片与每张表的字节数/占比，档案页「本地数据」卡展示，
  档案页表格行有 `storage-table-{id}`。归档/删除只动会话与照片，依据日志保留；
  删除后 `search_evidence` 仍能命中并标 `"source":"deleted"`。测试：Rust 容量单测与
  `Storage.test.tsx`（容量 UI、归档保依据、删除保依据与判定）。
