# Skill 中文译本

给**人**读的中文副本。agent 执行的永远是英文原文。

| | 位置 | 权威性 |
|---|---|---|
| agent 读 | `.agents/skills/<name>/SKILL.md`（英文，不入库，由 `skills-lock.json` 记录来源与 hash） | **唯一权威** |
| 人读 | `docs/skills-zh/<name>.md`（中文，入库） | 派生参考，不具权威性 |

## 规矩

1. **冲突以英文原文为准。** 中文只是帮你看懂，不能作为执行依据。要让 agent 按某条规矩干活，引英文原文。
2. **改了行为，只改英文那份。** 想调整 agent 怎么做，去改 `.agents/skills/`，然后同步译中文。
3. **术语统一**：关键术语首次出现时写成「中文（english）」，词表见 [`terms.tsv`](terms.tsv)，用 `scripts/apply-terms.sh` 机械应用。
4. **漂移可检**：每份译本头部记着翻译时对应的上游 hash。上游更新后：

```bash
npx skills add mattpocock/skills -s '*' -a pi --copy -y   # 拉新版英文
scripts/check-skills-zh.sh                                 # 列出需重译的
```

退出码 1 = 有人落了队。`--strict` 时「未译」也算失败。

## 索引

| skill | 中文文档 | 状态 |
|---|---|---|
| ask-matt | [ask-matt.md](ask-matt.md) | ✅ |
| chief-of-staff | — | ⬜ |
| claude-handoff | — | ⬜ |
| code-review | [code-review.md](code-review.md) | ✅ |
| codebase-design | — | ⬜ |
| diagnosing-bugs | — | ⬜ |
| domain-modeling | — | ⬜ |
| git-guardrails-claude-code | — | ⬜ |
| grill-me | [grill-me.md](grill-me.md) | ✅ |
| grill-with-docs | [grill-with-docs.md](grill-with-docs.md) | ✅ |
| grilling | [grilling.md](grilling.md) | ✅ |
| handoff | — | ⬜ |
| implement | [implement.md](implement.md) | ✅ |
| implement-spec | [implement-spec.md](implement-spec.md) | ✅ |
| improve-codebase-architecture | — | ⬜ |
| loop-me | — | ⬜ |
| migrate-to-shoehorn | — | ⬜ |
| pr | — | ⬜ |
| prototype | — | ⬜ |
| research | — | ⬜ |
| retro | — | ⬜ |
| scaffold-exercises | — | ⬜ |
| setup-pre-commit | — | ⬜ |
| setup-ts-deep-modules | — | ⬜ |
| tdd | [tdd.md](tdd.md) | ✅ |
| teach | — | ⬜ |
| to-questionnaire | — | ⬜ |
| to-spec | [to-spec.md](to-spec.md) | ✅ |
| to-tickets | [to-tickets.md](to-tickets.md) | ✅ |
| triage | [triage.md](triage.md) | ✅ |
| wait-what | — | ⬜ |
| wayfinder | — | ⬜ |
| wizard | — | ⬜ |
| writing-beats | — | ⬜ |
| writing-for-agents | — | ⬜ |
| writing-fragments | — | ⬜ |
| writing-shape | — | ⬜ |

> 场景层面「该用哪个 skill」不必查这里，看 [`../agent-workflows.md`](../agent-workflows.md)。
