---
name: triage
description: 让 issue 与外部 PR 沿一串 triage 角色构成的状态机流转：分类、验证、必要时拷打，并写出 agent 可用的简报。
disable-model-invocation: true
---

# Triage

把项目 issue tracker 上的 issue 沿一个小型 triage 角色状态机推进。

若本仓库把外部 pull request 也当作需求入口（见 issue-tracker 配置），triage 同样覆盖它们：**一个 PR 就是一个附带代码的 issue**，用同样的角色、同样的状态、同一台机器，只有少数差异在下文标注「对 PR 而言」。裸写的 `#42` 按 tracker 配置解析成 issue 还是 PR。

triage 期间发到 issue tracker 的每条评论或 issue **必须**以下面这句免责声明开头：

```
> *本次内容由 AI 在 triage 过程中生成。*
```

## 参考文档

- [AGENT-BRIEF.md](AGENT-BRIEF.md)：如何写经得起时间的 agent 简报
- [OUT-OF-SCOPE.md](OUT-OF-SCOPE.md)：`.out-of-scope/` 知识库如何运作

## 角色

两个**分类**角色：

- `bug`：东西坏了
- `enhancement`：新功能或改进

五个**状态**角色：

- `needs-triage`：需要维护者评估
- `needs-info`：在等提报者补充信息
- `ready-for-agent`：已完整定义，可交给离线 agent
- `ready-for-human`：需要人来实现
- `wontfix`：不予处理

对 PR 而言，同样的状态针对附带的代码读：`ready-for-agent` 表示已附简报、agent 应在该 diff 上走下一步；`ready-for-human` 表示已可让人来合并。

每条 triage 过的 issue 应当恰好带一个分类角色和一个状态角色。若状态角色互相冲突，先标出来问维护者，再做别的事。

以上是 canonical 角色名。issue tracker 里实际使用的标签字符串可能不同。映射表本应已经提供给你 —— 本仓库见 `docs/agents/triage-labels.md`（`/setup-matt-pocock-skills` 已卸载，不要引导用户运行它）。

状态流转：未打标签的 issue 通常先进 `needs-triage`；从那里流向 `needs-info`、`ready-for-agent`、`ready-for-human` 或 `wontfix`。提报者回复后 `needs-info` 回到 `needs-triage`。维护者随时可以覆盖；遇到看起来不寻常的流转，先标出来问过后再动。

## 调用方式

维护者调用 `/triage` 并用自然语言描述想要什么。理解请求并行动。示例：

- 「给我看需要我关注的东西」
- 「看看 #42」（issue 或 PR）
- 「把 #42 移到 ready-for-agent」
- 「哪些可以交给 agent 了？」

## 展示需要关注的内容

查询 issue tracker，按三个桶呈现，最旧的在前：

1. **未打标签**：从未 triage 过。
2. **`needs-triage`**：评估进行中。
3. **`needs-info` 且提报者在上次 triage 记录之后有活动**：需要重新评估。

PR 在范围内时，把外部 PR 一并放进这些桶，并在每行标记 `[PR]` 或 `[issue]`。发现环节只暴露*外部* PR（谁算外部由 tracker 配置定义），所以协作者正在进行的 PR 不算 triage 工作。该过滤只用于发现；被明确点名的 PR 无论作者是谁都要 triage。

显示计数，并为每一项给一行摘要。让维护者挑。

## triage 某条具体的 issue 或 PR

1. **汇总上下文。** 读完整个 issue 或 PR（正文、评论、标签、作者、日期；PR 还要看 diff）。解析既有的 triage 记录，避免重问已解决的问题。按项目领域词表探索代码库，遵守该区域的 ADR。对代码库跑两项检查：(a) **冗余**：按领域概念（不只是请求里的措辞）搜索该行为是否已有实现，并报告你查过哪里。若已实现，它属于「已实现型 `wontfix`」（第 5 步）。(b) **既往拒绝**：读 `.out-of-scope/*.md`，把任何与本请求相似的内容摆出来。

2. **建议。** 告诉维护者你建议的分类与状态，附上理由，以及与该请求相关的简要代码库概况（包括是否已实现）。等待指示。

3. **验证说法。** 任何拷打之前，先核实这个说法站得住。对 bug，按提报者的步骤复现；对 PR，确认 diff 真的做了它声称的事：检出、跑相关测试或命令。报告结果：已确认（附代码路径）、失败、或细节不足（强烈的 `needs-info` 信号）。已确认的验证会让 agent 简报强得多。

4. **拷打（必要时）。** 若请求需要被撑开，调用 Skill 工具两次，分别加载 "grilling" 与 "domain-modeling"，一轮一轮把它拷打成形，同时磨利领域术语并就地更新 `GLOSSARY.md`／ADR。

5. **落定结果：**
   - `ready-for-agent`：发一条 agent 简报评论（[AGENT-BRIEF.md](AGENT-BRIEF.md)）。
   - `ready-for-human`：结构与 agent 简报相同，但注明为什么不能委派（判断性决策、外部访问、设计决策、人工测试）。
   - `needs-info`：发 triage 记录（下方模板）。
   - `wontfix`：关闭该 issue，评论取决于*原因*：
     - **已实现**：改动已存在于代码库中。指出它在哪；**不要**写入 `.out-of-scope/`（那个知识库用于*被拒绝*的请求，不是已构建的东西）。
     - **拒绝（bug）**：礼貌解释，然后关闭。
     - **拒绝（enhancement）**：写入 `.out-of-scope/`，从评论链接过去，然后关闭（[OUT-OF-SCOPE.md](OUT-OF-SCOPE.md)）。
   - `needs-triage`：打上该角色。若有部分进展，可选发一条评论。

## 快速状态覆盖

若维护者说「把 #42 移到 ready-for-agent」，信任他，直接打角色。先确认你即将做什么（角色变更、评论、关闭），再行动。跳过拷打。若未经拷打就移到 `ready-for-agent`，问一句是否要写 agent 简报。

## needs-info 模板

```markdown
## Triage 记录

**目前已确立：**

- 要点 1
- 要点 2

**我们还需要你（@提报者）提供：**

- 问题 1
- 问题 2
```

把拷打中已解决的问题全部写进「目前已确立」，这样这些工作不会丢失。问题必须具体、可行动，不能是「请提供更多信息」。

## 续接上一次会话

若该 issue 或 PR 上已有 triage 记录，先读它们，检查提报者是否回答了未决问题，呈现更新后的全貌再继续。不要重问已解决的问题。
