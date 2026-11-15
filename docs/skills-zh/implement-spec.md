> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/implement-spec/SKILL.md`
> 对应上游 hash：`c3474ef320861d79`
> 来源：`mattpocock/skills`

# implement-spec

你已被提供一份 spec。该 spec 应当配有工单（ticket），描述如何实现它。

issue tracker 本应已经提供给你。若没有，去读 `AGENTS.md` 与 `docs/agents/issue-tracker.md`（`/setup-matt-pocock-skills` 已卸载，不要引导用户运行它）。

目标是让整个 spec 在**单一集成分支（integration branch）**上实现完毕，每个工单都按 issue tracker 关闭工作的方式结清。

工单不是一串步骤，而是**任务图（task graph）**，彼此之间有阻塞（blocked）关系。这意味着始终存在一个**前沿（frontier）**：可以立刻抓取的工单。

每个 subagent 都从全新的上下文窗口（context window）开始。

与 subagent 之间的通信要稀疏。主要通过**上下文指针**沟通：指向 spec、工单、研究笔记、之前的提交。不要重复指针已经能拿到的信息。

**实现者 subagent** 应尽可能放到后台运行，以获得最大并发。

## 步骤

1. 读 spec 与工单，理解任务图。

2. （可选）用**探索 subagent** 做各工单所需的探查 —— 相关代码库文件或外部文档。确保探索 subagent 能写文件：它应把 markdown 笔记存到仓库外的某个目录，供之后所有 subagent 访问。这让**实现者 subagent** 专注实现而不是探查。

3. 创建集成分支。如果 issue tracker 通过 PR 关闭工作，或用户要求，就在第 5 步第一次合并之后开一个草稿 PR（领先 main 零提交的分支开不了 PR），标明将关闭该 spec 及其工单。

4. 每个工单用一个全新的**实现者 subagent**，各自在自己的 worktree、自己的分支上。每个实现者 subagent：
   - 开工前确认自己的 worktree 基于集成分支，若不是就 reset 到它上面；
   - 调用 Skill 工具加载 `tdd` 来构建该工单；
   - 报告完成前，把集成分支的最新提交合并进自己的分支。

5. 某个**实现者 subagent** 完成后，用一个**合并 subagent** 把它的工作合入集成分支。

6. 如果这改变了可用工单的**前沿**，就再启动更多**实现者 subagent** 去处理新解锁的工单。这样可获得最大并发。

7. 全部工单完成后，在集成分支上调用 Skill 工具加载 `code-review`。由一个全新的**实现者 subagent** 一次性修掉代码评审提出的所有问题。

8. 若存在草稿 PR（draft PR），把它标记为可评审。否则按 issue tracker 关闭工作的方式结清每个工单，并报告集成分支。

9. 清理所有**实现者 subagent** 的 worktree。
