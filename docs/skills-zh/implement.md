> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/implement/SKILL.md`
> 对应上游 hash：`560465496ad06693`
> 来源：`mattpocock/skills`

# implement

实现用户所述 spec 或工单（ticket）里描述的工作。

如果用户传了工单引用，从 issue tracker 取回它，并在开工前说出它的标题。引用含糊就先问。

在事先商定的接缝（seam）上，尽可能调用 Skill 工具加载 "tdd"。

定期跑类型检查、定期跑单个测试文件，最后完整跑一次测试套件。

完成后调用 Skill 工具加载 "code-review" 来评审这些工作。

把工作提交到当前分支。
