GitHub: #9
Status: ready-for-agent
Type: task
Blocked by: 6

# 09: 工具层与硬规则

**What to build:** 工具层：`search_evidence`、`record_finding`、`correct_finding` 三个工具接上模型，并与领域层打通。**硬规则由工具层强制**：未先对该部位 `search_evidence` 就调写入，一律拒绝并回错误让模型重试。

**Blocked by:** #6

**Status:** ready-for-agent

- [ ] 模型能调起三个工具并拿到结构化结果
- [ ] 写入一条 Finding 会同时落一条四段式依据日志（用户说法要点/验证方案与反馈/推理/不确定之处），缺段则拒绝
- [ ] 未先查询该部位就写入 → 被拒且错误信息足以让模型自助纠正
- [ ] `search_evidence` 支持按部位/轴/时间/关键词过滤，`limit` 上限 20 且不可绕过
- [ ] 以上用假客户端驱动一次完整工具往返即可测，不联网
