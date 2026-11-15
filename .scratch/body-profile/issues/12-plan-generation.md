GitHub: #12
Status: ready-for-agent
Type: task
Blocked by: 8, 9

# 12: 计划生成、版本与复查日

**What to build:** 计划生成：模型依据档案与训练条件调用 `generate_plan` 产出版本化计划（频次规则、动作清单、每个动作对应的 Finding、复查日默认 4 周）；训练条件不齐时模型必须先追问而不是编。

**Blocked by:** #8, #9

**Status:** ready-for-agent

- [ ] 生成一份计划后档案页可见，每个动作能点回它对应的 Finding
- [ ] 同一时刻只有一个生效计划；重新生成即新版本，旧版本只读可查
- [ ] 训练条件不齐时 agent 追问而不是产出计划
- [ ] 复查日到期后今日页顶部出现提示
- [ ] 计划落库前后都能读到完整结构（不含 UI）
