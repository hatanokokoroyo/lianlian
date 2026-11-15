> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/handoff/SKILL.md`
> 对应上游 hash：`f60a2c3688379b7a`
> 来源：`mattpocock/skills`

# 交接（Handoff）

写一份交接文档，总结当前对话，好让一个全新的 agent 接着干。

保存到用户操作系统的临时目录（`$TMPDIR`，否则 `/tmp`；Windows 上是 `%TEMP%`）—— **不要**放在当前工作区。

文档里包含一个「建议技能（suggested skills）」小节，点名下一个 agent 应当用 Skill 工具加载哪些技能。

不要重复已经被其他产物（spec、计划、ADR、issue、提交、diff）记录的内容。用路径或 URL 引用它们。

脱敏任何敏感信息，例如 API key、密码、可识别个人身份的信息。

如果用户传了参数，把它们当作「下一个会话要专注什么」的描述，据此裁剪文档。
