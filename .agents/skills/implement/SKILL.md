---
name: implement
description: 基于一份 spec 或一组工单实现一块工作。
disable-model-invocation: true
---

实现用户所述 spec 或工单里描述的工作。

如果用户传了工单引用，从 issue tracker 取回它，并在开工前说出它的标题。引用含糊就先问。

在事先商定的接缝上，尽可能调用 Skill 工具加载 "tdd"。

定期跑类型检查、定期跑单个测试文件，最后完整跑一次测试套件。

完成后调用 Skill 工具加载 "code-review" 来评审这些工作。

把工作提交到当前分支。
