# 工作流参考手册

本仓库的 37 个 skill 怎么用、在什么场景下用哪个。给**人**读的速查表；skill 本身是给 agent 的指令。

- 全部 skill 在 `.agents/skills/<name>/SKILL.md`
- 项目的 issue / 标签 / 领域文档约定在 `docs/agents/`
- 想不起来用哪个 → `/skill:ask-matt`（它是路由表，会替你挑）

---

## 1. 一张地图

```
                  ┌─ /triage ────────┐        （别人提的 issue / 外部 PR）
                  │                  │
想法 ─ /grill-with-docs ─ 分支 ──────┴──→ /to-spec → /to-tickets → /implement(/tdd) → /code-review → /pr → /retro
                  │                  │                                    ↑
                  │                  └─ 多会话构建 → /implement-spec ──────┘
                  │
                  ├─ 需要一个可跑的答案 → /handoff ⇄ /prototype ⇄ /handoff
                  └─ 一团迷雾的超大工程 → /wayfinder →（交棒回 /to-spec）

坏得看不懂 ─ /diagnosing-bugs → /retro
空闲时 ─── /improve-codebase-architecture → /codebase-design
词汇层（跑在下面，自动被拉进来）── /domain-modeling · /codebase-design
独立 ── /grill-me · /research · /to-questionnaire · /wizard · /teach · /wait-what · /writing-for-agents
```

三种入口：

| 入口 | 何时用 |
|---|---|
| **有想法，要做出来** | 主流程，从 `/grill-with-docs` 开始 |
| **问题自己找上门**（别人的 bug 报告、需求） | `/triage` |
| **东西坏了** | `/diagnosing-bugs` |

---

## 2. 场景速查

| # | 场景 | 命令序列 | 产出落在哪 |
|---|---|---|---|
| 1 | 「我想做 X，但还没想清」 | `/grill-with-docs` → 反复回答 → `/to-spec` | `GLOSSARY.md` / `docs/adr/` / spec（GitHub issue + `.scratch/`） |
| 2 | 「spec 有了，拆活」 | `/to-tickets` | `.scratch/<feature>/issues/NN-*.md` + GitHub 子 issue + 原生阻塞边 |
| 3 | 「一个工单，做完」 | `/implement <ticket>` | 当前分支的提交 |
| 4 | 「整个 spec 一起推」 | `/implement-spec` | 集成分支 + 每工单一个 worktree |
| 5 | 「只想测先行做个小行为」 | `/tdd` | 测试 + 实现 |
| 6 | 「评审这个分支/PR」 | `/code-review from HEAD~5` | 双轴报告（不写文件） |
| 7 | 「要提交 PR 了」 | `/pr` | PR 正文 |
| 8 | 「别人提了 issue」 | `/triage` → 分类/验证/拷打 → `ready-for-agent` | GitHub 标签 + agent 简报评论 |
| 9 | 「这个 bug 见鬼了」 | `/diagnosing-bugs` →（修完）`/retro` | 回归测试 |
| 10 | 「设计问题说不清，得跑一下」 | `/handoff` → 新会话 → `/prototype` → `/handoff` 回来 | `prototype/<name>` 分支 |
| 11 | 「这也太大了，路都看不见」 | `/wayfinder` → 地图清晰后 `/to-spec` | tracker 上的 map + 决策工单 |
| 12 | 「模块该怎么切」 | `/codebase-design`（参考，不是会话） | 无（词汇） |
| 13 | 「这个词我们用得乱七八糟」 | `/domain-modeling` | `GLOSSARY.md` / ADR |
| 14 | 「查个技术事实」 | `/research` | 带引用的 markdown 文件 |
| 15 | 「卡在别人那里」 | `/to-questionnaire` | 问卷 |
| 16 | 「要开账号/配 secrets/点后台」 | `/wizard` | 交互式 bash 脚本 |
| 17 | 「刚才那句话没听懂」 | `/wait-what` | 无（重讲一遍） |
| 18 | 「构建完了，环境哪该改」 | `/retro` | 建议改的是**环境**，不是代码 |

---

## 3. 主流程细讲

### 3.1 磨想法：`/grill-with-docs`

不留情面的访谈，按**轮次**推进：一次问掉当前「前沿」的所有问题（每个都带推荐答案），等你回答后重新计算前沿，再问下一轮。事实由 agent 自己查，决策必须你拍。

- 有仓库 → `/grill-with-docs`（**有状态**，边聊边写 `GLOSSARY.md` 与 ADR）
- 没仓库（写文章、纯设计）→ `/grill-me`（同一场访谈，**不留痕迹**）
- 只想要访谈、不要包装 → `/grilling`（原语）

结束时你应能回答「每件事都定了吗」。

### 3.2 出规格：`/to-spec`

**不做访谈**，只把对话综合成 spec，打 `ready-for-agent` 发布。模板含：问题陈述 / 解决方案 / 长清单用户故事 / 实现决策 / 测试决策 / 不在范围内 / 补充说明。

关键动作：**先勾出测试接缝（seam）并跟你确认**。接缝越少越好，理想是一个；优先用已有接缝。

### 3.3 拆工单：`/to-tickets`

拆成 **tracer bullet 垂直切片** —— 每个切片都穿过所有层（schema/API/UI/测试）、自身可演示、能装进一个会话窗口。每个工单声明**阻塞边**（谁必须先完成）。

例外是**大范围重构**：一次机械改动炸遍全库，任何垂直切片都无法绿灯 → 按 **expand–contract** 排：先加新形态（不破坏），再分批迁移调用点，最后删旧形态。

发布前会**盘问你三点**：粒度对吗、阻塞边对吗、要不要合并/再拆。

### 3.4 实现

| 方式 | 适合 | 代价 |
|---|---|---|
| `/implement <ticket>` | 一次一个工单，**工单之间 `/clear`** | 你亲手驱动，上下文最干净 |
| `/implement-spec` | 整个 spec 一次推，按任务图并行开实现者 subagent | 你负责编排，要 worktree + 集成分支 |

两者内部都靠 `/tdd` 建代码（一次一个红→绿切片），并由 `/code-review` 收尾。

### 3.5 收尾：`/code-review` → `/pr` → `/retro`

- `/code-review`：双轴。**Standards**（是否符合仓库成文标准 + Fowler 坏味道基线）与 **Spec**（是否忠实实现 spec），两轴分开汇报、不许互相掩盖。
- `/pr`：正文三件套——能体现改动的最小可视化、改前/改后可用的证据、单向门还是双向门。
- `/retro`：回看会话，改的是 **agent 的环境**（导航指针、自动化检查、编码标准、引导文件、工具），不是代码。机械错误 → 确定性检查；判断分歧 → 编码标准。

---

## 4. 入口细讲

### 4.1 `/triage`（只用于**不是你提的** issue）

五个状态角色：`needs-triage` → `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`；两个分类：`bug` / `enhancement`。每条 triage 过的 issue 恰好一个分类 + 一个状态。

动作顺序：汇总上下文 → 建议（等你指示）→ **验证说法**（bug 要复现、PR 要检出跑）→ 必要时 `/grilling` + `/domain-modeling` 拷打 → 落定（agent 简报 / needs-info 记录 / 关闭）。

三条纪律：

1. 每条评论以 `> *本次内容由 AI 在 triage 过程中生成。*` 开头
2. `/to-tickets` 产出的工单已经是 `ready-for-agent`，**不要**再 triage
3. `wontfix` 的评论看原因：**已实现** → 指路，不写 `.out-of-scope/`；**拒绝需求** → 写 `.out-of-scope/` 再关闭

### 4.2 `/diagnosing-bugs`

拒绝在拿到**紧反馈循环**之前开始推测：必须先有一条**已经在这个 bug 上变红**的命令。然后靠回归测试修。修完在同一会话跑 `/retro`。如果真正的结论是「没有好接缝能锁住它」，转 `/improve-codebase-architecture`。

### 4.3 `/wayfinder`

给**一个会话装不下、路都看不清**的工程。在 tracker 上画一张 map（`wayfinder:map`），下面挂**决策工单**，一次解决一个，产出**决策而不是交付物**。地图清晰后**交棒不建造**：回 `/to-spec`，把互链的决策压成可构建计划。

判据：`/grill-with-docs` 磨的是**一个会话能握住**的想法；wayfinder 磨的是握不住的。范围清晰的功能用它纯属浪费。

---

## 5. 阶段边界怎么选（最模糊的决策）

在一段工作**之间**（访谈/实现/QA 的交界），五个选项，从上往下排除：

| 选项 | 何时 | 代价 |
|---|---|---|
| **Continue** | 下一步还用得上这里的上下文 | 零成本 —— 但先排除它：一手来源（原始对话）的代价最高 |
| `/clear` | 这里的东西对下一步毫无价值 | 丢了不可恢复 |
| `/handoff` | 要换 harness、换目录、交给同事，或**阶段中途**分叉支线 | 写一份可携带文件，成本中等 |
| **Subagent** | 任务范围紧窄、结果只需一份报告 | 上下文隔离，通信有损耗 |
| `/compact` | 默认选择，位于决策树底部 | 压缩有损，但保住主线 |

**上下文卫生铁律**：`/grill-with-docs` → `/to-spec` → `/to-tickets` 三步必须待在**同一个不间断窗口**里；之后每个 `/implement` 都从工单全新开始。窗口逼近 ~150k tokens（smart zone 边界）时，在最近的阶段边界 `/compact`，不要在降智状态下硬推。

---

## 6. 本仓库特有的约定（用之前先看这段）

| 事项 | 约定 |
|---|---|
| issue 存放 | GitHub Issues（`hatanokokoroyo/lianlian`，权威编号）+ `.scratch/<feature>/issues/NN-*.md` 镜像 |
| 自己提的 issue | 跳过 `needs-triage`，直接 `ready-for-agent` |
| 别人提的 issue | 从 `needs-triage` 进 |
| 本地文件头部 | `GitHub: #N`（或 `pending`）、`Status:`、`Type:`、`Blocked by:` |
| `gh` 版本 | **2.45.0**，低于 2.94 → `--parent` / `--blocked-by` 等参数不存在，子 issue 与原生依赖走 `gh api` + 数字 database id |
| 降级 | `gh` 不可用/断网 → 本地先写 `GitHub: pending`；`rg -n 'GitHub: pending' .scratch/` 即待办 |
| 换机器 | `.scratch/` 与配置都在 git 里，clone 即恢复 |
| `/setup-matt-pocock-skills` | **已卸载且不必再跑**（skill 文本里的相关指引可忽略，配置已在 `AGENTS.md` + `docs/agents/`） |

---

## 7. 常用命令备忘

```bash
# skill 本身
ls .agents/skills                       # 有哪些
npx skills list                         # 已装清单
npx skills update                       # 更新上游（会覆盖本地翻译！见第 8 节）
npx skills add mattpocock/skills -s '*' -a pi --copy -y

# issue
gh issue list --state open --json number,title,labels
gh issue view 7 --json number,title,body,labels,comments
gh issue create --title "..." --body "..."
gh issue comment 7 --body "..." && gh issue close 7
gh issue edit 7 --add-label ready-for-agent
gh label list

# 本地工单
rg -n 'GitHub: pending' .scratch/       # 待补建清单
rg -n '^Status: ready-for-agent' .scratch/   # 可以开工的
```

---

## 8. 中文译本策略（重要）

两份文件，职责分开：

| | 位置 | 谁读 | 权威性 |
|---|---|---|---|
| 英文原文 | `.agents/skills/<name>/SKILL.md` | **agent 执行** | 唯一权威（不入库，由 `skills-lock.json` 记录来源与 hash） |
| 中文译本 | `docs/skills-zh/<name>.md` | **人阅读** | 派生参考，不具权威性（入库） |

- 改了行为 → 只改英文那份，再同步译中文
- 上游更新 → `npx skills add mattpocock/skills -s '*' -a pi --copy -y` 拉新版英文，再 `scripts/check-skills-zh.sh` 看谁落队
- 术语统一 → `docs/skills-zh/terms.tsv` + `scripts/apply-terms.sh`（关键术语首次出现写成「中文（english）」）
- 索引与状态 → `docs/skills-zh/README.md`

注意 `-s '*'` 会把已移除的 `setup-matt-pocock-skills` 一并装回来，重装后需手动删（`rm -rf .agents/skills/setup-matt-pocock-skills` 并清 `skills-lock.json`）。

