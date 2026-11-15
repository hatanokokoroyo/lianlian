## Agent skills

### Issue tracker

issue 存放在 `hatanokokoroyo/lianlian` 的 GitHub Issues，并逐条镜像为 `.scratch/<feature>/issues/` 下的本地 markdown 文件。详见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用上游五个 canonical 标签，未改名。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：仓库根目录的 `GLOSSARY.md` 加 `docs/adr/`。详见 `docs/agents/domain.md`。

### 工作流手册

37 个 skill 的场景速查、主流程细讲、阶段边界决策树与本地约定，见 `docs/agent-workflows.md`。

### Skill 正文的权威性

- agent 只读 `.agents/skills/<name>/SKILL.md`（英文原文，**唯一权威**）。
- `docs/skills-zh/*.md` 是给人的中文译本，**不得**作为执行依据；人明确要求时才引用，且冲突以英文为准。
- 要改 agent 的行为，改英文原文；新装/更新 skill 后用 `scripts/check-skills-zh.sh` 查译本是否落后。
