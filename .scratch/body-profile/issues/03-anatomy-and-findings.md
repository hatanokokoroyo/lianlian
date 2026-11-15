GitHub: #3
Status: ready-for-agent
Type: task

# 03: 词表 / 五轴 / Finding 领域与存储

**What to build:** 领域层的第一块：解剖部位词表（静态数据）、五轴枚举、Finding 与 Correction 的只追加语义、肌群聚合，以及 redb 的建表与 schema 版本。做到"能写入一条真实判定、能从库里按时间读回来"。零 IO 的规则都在这里，所以这一层是 `cargo test` 的主战场。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 部位词表随包编译：每条含 id、中文名、英文名、拉丁名、所属肌群、左右成对标记，带 schema 版本
- [ ] 五轴枚举齐全（张力/对称/活动度/疼痛/稳定性），非法取值在落库前被拒
- [ ] 写入 Finding 后可读回并按时间排序；写词表外的部位 id 被拒
- [ ] 撤回后投影不再包含该条，"已解决"体现为最新取值为正常，历史条目仍在
- [ ] 肌群聚合返回成员中的最差值
- [ ] 以上全部由表驱动单测覆盖，零网络零 UI
