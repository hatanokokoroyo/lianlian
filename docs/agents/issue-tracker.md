# Issue tracker：GitHub + 本地 markdown 镜像

本仓库的 issue 与 spec 存在于两个地方，两边必须保持一致：

1. **GitHub Issues**（`hatanokokoroyo/lianlian`）—— 对外共享、持久、公开的记录，也是**唯一的编号权威**。
2. **`.scratch/` 下的本地 markdown** —— 面向 agent 的工作副本。GitHub 上的每一条 issue 在这里都有且只有一个对应文件；每个本地文件都反向指回它的 issue。

远端：`origin` = `git@github.com:hatanokokoroyo/lianlian.git`（SSH）。在本仓库内运行时，`gh` 会从 `git remote -v` 自动推断仓库。

## 本仓库已定下的决策

一次性记录在此，之后要改就算是明确的修改，而不是悄悄漂移：

| 决策 | 取值 | 理由 |
| --- | --- | --- |
| 事实源 | GitHub Issues（公开、权威）+ `.scratch/` 镜像（面向 agent） | 当前单人开发；将来会接受外部 issue 与协作者 |
| 编号权威 | GitHub 自动分配的 `#N` | 永不重复；本地文件名直接复用它 |
| `.scratch/` 是否提交 | 提交进本仓库 | 开发会换机器，git 本身就是同步层，不要再引入第二套 |
| 状态 | 五个 canonical 字符串 | `needs-triage` 和 `ready-for-human` 今天闲置，等外部开始提 issue 后才回本 |
| 并发 | 单 agent、顺序执行 | 不建 claim / frontier 机制；`Blocked by:` 仅作信息 |
| 降级 | 本地优先 + `GitHub: pending` | 不是每台机器都装了 `gh`，工作不能因此停摆 |

只有答案变化时才重开这些决策：出现第二个并发 agent（补 claiming）、迁到 monorepo（见 `domain.md`）、或 `.scratch/` 在共享仓库里变成噪声（那时再 gitignore）。

## 选哪一面

- **永远两边都做**：凡是 skill 说「发布（publish）」的东西，都既创建/更新 GitHub issue，又写/更新本地文件。
- **若 `gh` 未安装或未登录**，走本地优先：本地文件写 `GitHub: pending`，之后（网页端，或 `gh` 可用后）再补建 issue 并替换掉 `pending`。绝不因为远端调用失败就丢掉本地文件，也绝不因为 GitHub 成功就静默跳过本地文件。

## 状态词表

GitHub 标签与本地 `Status:` 行使用同一套字符串：

| 字符串            | 含义                          |
| ----------------- | ----------------------------- |
| `needs-triage`    | 需要维护者先评估这条 issue    |
| `needs-info`      | 正在等提报者补充信息          |
| `ready-for-agent` | 已完整定义，可以交给离线 agent |
| `ready-for-human` | 需要人来实现                  |
| `wontfix`         | 不予处理                      |

本地文件的 `Status:` 行是**当下** agent 该做什么的权威；GitHub 标签是**外部**看到的权威。两者冲突时，修掉过期的那一个，不要靠猜。

谁负责设置状态：

- **自己提的 issue** 跳过 `needs-triage` —— 本该 triage 它的人就是刚写下它的人。直接从 `ready-for-agent` 开始。
- **他人提的 issue** 从 `needs-triage` 开始。一旦需要提报者提供东西就转 `needs-info`；拿到后转回 `ready-for-agent`。
- `ready-for-human` 表示 agent 不得接手：需要决策、凭证、不可逆操作或主观判断。
- 只保留会改变「下一个执行者做什么」的状态。某个状态若连续两个月未使用，就从两面一起删除，不要为对称性留着。

## 约定 —— GitHub 侧

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需配 `--label`、`--state` 过滤。
- **把某 issue 设为父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（子 issue 的 database id，见下文 **Blocking**）。若子 issue 功能不可用，就在子 issue 正文顶部写 `Part of #<parent>`。
- **Blocking（阻塞）**：使用 GitHub 的**原生 issue 依赖**，这是最权威、界面上可见的表达。加边：`gh issue create --blocked-by <n>,<n> ...` 或 `gh issue edit <child> --add-blocked-by <blocker>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞者的数字 **database id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，**不是** `#number`，也不是 `node_id`）。依赖功能不可用时，退回在子 issue 正文顶部写 `Blocked by: #<n>, #<n>`。当所有阻塞者都关闭时，该 ticket 视为解除阻塞。
- **统计未关闭的阻塞者**：`gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只算未关闭的；0 表示可以开工）。`gh issue view <n> --json blockedBy` 会把已关闭的也列出来，所以要过滤：`--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`。
- **评论**：`gh issue comment <number> --body "..."`。
- **加/删标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：先用 `gh issue comment <number> --body "..."` 发说明，再 `gh issue close <number>`。对已关闭的 issue，`gh issue close --comment` 会丢弃评论但仍返回 0。

只往 `hatanokokoroyo/lianlian` 提 issue。**绝不要**提到 `mattpocock/skills`（这些 skill 的来源仓库）。若 `gh` 在 fork 中默认指向 upstream 父仓库，会话里首次 `gh issue create` 之前先用 `gh repo view --json nameWithOwner` 确认目标。

## 约定 —— 本地镜像

- 功能目录：`.scratch/<feature-slug>/`
- Spec：`.scratch/<feature-slug>/spec.md`
- 一个 ticket 一个文件：`.scratch/<feature-slug>/issues/NN-<slug>.md`，从 `01` 起编号，**绝不**用单个合并的 tickets 文件。已知 GitHub issue 编号时，`NN` 就是补零后的 issue 编号（`#7` → `07-risk-scoring.md`）；未知时先顺序编号，拿到编号后重命名。
- 每个 ticket 靠近顶部有头部行：

  ```markdown
  GitHub: #7            <!-- 或：pending -->
  Status: needs-triage
  Type: task            <!-- research | prototype | grilling | task -->
  Blocked by: 03, 05    <!-- 未阻塞时省略此行 -->
  ```

- 评论与会话历史追加到文件底部 `## Comments` 标题下。
- 本地文件**提交**进本仓库：这是让进行中的工作熬过换机器的唯一方式，也是 agent 离线时读的东西。若 `.scratch/` 在某天成为共享仓库里的噪声，就把它加进 `.gitignore`、只留 GitHub Issues —— 那属于明确的反转，不是默认。
- 单 agent 顺序执行时，除 wayfinding 外没有认领（claim）协议：`Status:` 说明 ticket 处于什么阶段，不代表谁持有锁。`Blocked by:` 只是信息：开工前检查一下，在真的出现两个 agent 并行之前不要建 frontier 调度器。

## 外部依赖失败时

每个远端操作都有一个本地优先的落盘步骤，因此故障是降级而不是停摆：

| 故障 | 应对 |
| --- | --- |
| `gh` 未安装（目前某些机器就是这样） | 本地文件写 `GitHub: pending`，之后批量补建 issue |
| 断网 / GitHub 宕机 | 同上：本地文件即是记录，`git push` 与建 issue 延后 |
| `gh` 返回 401/403（token 过期、限流） | 同上，方便时重跑 `gh auth status` |
| 目标仓库错了（fork 默认指向 upstream） | 会话里首次 `gh issue create` 之前跑 `gh repo view --json nameWithOwner`，确认是 `hatanokokoroyo/lianlian` |
| 换机器 | `.scratch/` 已提交，clone 即可恢复全部 ticket |

占位符必须保持可机械扫描：`rg -n 'GitHub: pending' .scratch/` 就是下一个有 `gh` 的会话的完整待办清单。

## 同步规则

- **GitHub → 本地**：标题、正文、标签、新评论，重新生成本地文件，不要手工 merge。
- **本地 → GitHub**：评论、答案、状态流转，先在本地追加，再把同样的文字推到 issue。
- 本地文件找不到对应 GitHub issue 是 bug —— 要么补建 issue，要么删掉文件，不要让它悬空。

## 当 skill 说「发布到 issue tracker」

两面都做：`gh issue create`（`gh` 不可用时写 `GitHub: pending`），然后用返回的编号写本地 ticket 文件。

## 当 skill 说「取出相关 ticket」

本地文件存在就直接读。不存在则按上文 **读取 issue** 取回，并据此写出本地文件。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一条 GitHub issue 加一份本地镜像，其下每个 issue 对应一个**子 ticket**。

- **Map**：打上 `wayfinder:map` 标签的 GitHub issue（`gh issue create --label wayfinder:map`），镜像为 `.scratch/<effort>/map.md`（Notes / Decisions-so-far / Fog 正文）。
- **子 ticket**：作为 GitHub 子 issue 挂到 map 上（见 **把某 issue 设为父 issue 的子 issue**）；子 issue 功能不可用时，把子项加进 map 正文的任务列表，并在子 issue 正文顶部写 `Part of #<map>`。标签 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）；本地镜像在 `Type:` 行使用同样的字符串。认领后，ticket 指派给驱动它的开发者。
- **Blocking**：见约定中的 **Blocking**；本地以 `Blocked by: NN, NN` 镜像同样的边。
- **Frontier 查询**：map 下未关闭的子项，去掉有未关闭阻塞者或已有指派的；按 map 顺序取第一个。
- **认领（Claim）**：`gh issue edit <n> --add-assignee @me`（会话的第一次写操作），并在镜像里把 `Status:` 设为 `claimed`，然后才开始干活。
- **完成（Resolve）**：`gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，然后在镜像里把答案追加到 `## Answer` 标题下、把 `Status:` 设为 `resolved`，并把上下文指针（要点 + 链接）追加到 map 的 Decisions-so-far。

## Pull request 作为 triage 入口

**PRs as a request surface: no**（本仓库不把外部 PR 当作需求入口）。

若改成 `yes`，PR 会走与 issue 相同的标签与状态，只是用 `gh pr` 的对应命令：

- **读取 PR**：`gh pr view <number>`，随后 `gh pr view <number> --comments`（非 TTY 下 `--comments` 只打印评论、不含正文），以及 `gh pr diff <number>` 看 diff。
- **列出待 triage 的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用同一套编号空间，所以裸写的 `#42` 可能指任何一个：先用 `gh pr view 42` 解析，失败再退回 `gh issue view 42`。
