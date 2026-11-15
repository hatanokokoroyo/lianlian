# Triage 标签词表

各个 skill 用五个 canonical 角色说话。本文件把这五个角色映射到本仓库 issue tracker 里实际使用的标签字符串。

| mattpocock/skills 中的标签 | 本仓库 tracker 中的标签 | 含义                                |
| -------------------------- | ----------------------- | ----------------------------------- |
| `needs-triage`             | `needs-triage`          | 需要维护者先评估这条 issue          |
| `needs-info`               | `needs-info`            | 正在等提报者补充更多信息            |
| `ready-for-agent`          | `ready-for-agent`       | 已完整定义，可以交给离线 agent      |
| `ready-for-human`          | `ready-for-human`       | 需要人来实现                        |
| `wontfix`                  | `wontfix`               | 不予处理                            |

当 skill 提到某个角色时（例如「打上 AFK-ready 的 triage 标签」），使用本表中对应的字符串。本仓库目前五个字符串与上游完全一致，未做任何改名。

相关约定（谁给谁打标签、本地 `Status:` 行与 GitHub 标签的关系）见 `issue-tracker.md` 的「状态词表」一节。
