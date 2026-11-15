> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/claude-handoff/SKILL.md`
> 对应上游 hash：`e903af941877ac19`
> 来源：`mattpocock/skills`

# 交给 Claude 后台 agent（claude-handoff）

写一份当前对话的交接摘要，好让一个全新的 agent 接着干。保存到用户操作系统的临时目录，然后用它作为 prompt 启动一个后台 agent：`claude --bg --name "<描述性名字>" -- "$(cat <摘要文件>)"`。传文件（而不是内联字符串）可以避免 shell 执行摘要里的反引号或展开 `$`。它从当前工作目录启动并立即返回；用户用 `claude agents` 管理它。

始终传 `-n`/`--name` 并给一个描述性名字（例如 `--name "Fix login bug"`）；它决定任务列表、会话选择器和终端标题里显示的名字。

摘要里包含一个「建议技能」小节，点名下一个 agent 应当用 Skill 工具加载哪些技能。

不要重复已经被其他产物（spec、计划、ADR、issue、提交、diff）记录的内容。用路径或 URL 引用它们。

脱敏任何敏感信息，例如 API key、密码、可识别个人身份的信息 —— 因为这份摘要会变成该 agent 的 prompt。

如果用户传了参数，把它们当作「下一个会话要专注什么」的描述，据此裁剪摘要。
