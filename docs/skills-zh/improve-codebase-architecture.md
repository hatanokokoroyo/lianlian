> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/improve-codebase-architecture/SKILL.md`
> 对应上游 hash：`f0820b18426a7d9a`
> 来源：`mattpocock/skills`

# 改进代码库架构（Improve Codebase Architecture）

把架构上的摩擦暴露出来，并提出**加深机会（deepening opportunity）**：把浅模块（module）变成深模块（deep module）的重构。目标是可测性与 AI 可导航性。

本命令由项目的领域模型**提供信息**，并建立在共享的设计词汇之上：

- 调用 Skill 工具加载 "codebase-design" 取架构词汇（**module**、**interface**、**depth**、**seam**、**adapter**、**leverage**、**locality**）及其原则（删除测试、「接口（interface）就是测试表面」、「一个适配器（adapter） = 假想接缝（seam），两个 = 真接缝」）。每条建议都严格使用这些术语，不要漂移到「component」「service」「API」或「boundary」。
- `GLOSSARY.md` 里的领域语言给好接缝命名；`docs/adr/` 里的 ADR 记录着本命令不该重新翻案的决定。

## 过程

### 1. 探索

**扫描之前先划范围：YAGNI。** 加深模块的回报在于让未来对它的改动更容易，所以给最近改动过的部分额外加权。先决定*看哪里*，再去看：

- 用户指定了方向（某个模块、子系统、痛点），就照它来，跳过下面的推断。
- 否则往回追相当一段提交历史（`git log --oneline`），找出代码库的热点 —— 反复出现的文件与区域，先让这些路径牵引你的注意力。若改动散乱、没有明显热点，就把网撒大些。

先读项目的领域词表（`GLOSSARY.md`），以及你所触及区域的 ADR。

然后起一个带全新上下文窗口（context window）的 subagent 走一遍代码库。不要套死板的启发式；有机地探索，并记下你体验到摩擦的地方：

- 哪里理解一个概念需要在许多小模块之间来回弹？
- 哪里模块是**浅**的，接口几乎和实现一样复杂？
- 哪里为了可测性抽出了纯函数，但真正的 bug 藏在它们的调用方式里（缺少 **locality**）？
- 哪里紧耦合的模块泄漏穿过它们的接缝？
- 代码库哪些部分没有测试，或难以通过当前接口测试？

对你怀疑是浅的东西应用**删除测试**：删掉它会把复杂度集中起来，还是只是把复杂度搬走？「是的，会集中」才是你要的信号。

### 2. 用 HTML 报告呈现候选

写一个自包含的 HTML 文件到操作系统的临时目录，别让任何东西落进仓库。从 `$TMPDIR` 解析临时目录，回退到 `/tmp`（Windows 上是 `%TEMP%`），写到 `<tmpdir>/architecture-review-<timestamp>.html`，让每次运行都是新文件。替用户打开它（Linux 上 `xdg-open <path>`，macOS 上 `open <path>`，Windows 上 `start <path>`），并告诉他绝对路径。

报告用 **CDN 上的 Tailwind** 做布局与样式，用 **CDN 上的 Mermaid** 画那些用图/流程/时序能可靠传达结构的示意图。把 Mermaid 与手写的 CSS/SVG 视觉混用：关系是图状时（调用图、依赖、时序）用 Mermaid；想要更「版面化」的效果时（体量图、剖面图、折叠动画）用手搭的 div/SVG。每个候选都配一份**改前/改后可视化**。要视觉化。

每个候选一张卡片，包含：

- **文件（Files）**：涉及哪些文件/模块
- **问题（Problem）**：为什么当前架构在这里产生摩擦
- **方案（Solution）**：用平实中文描述会改什么
- **收益（Benefits）**：用 locality 与 leverage 说明，以及测试会怎么改善
- **改前 / 改后示意图**：并排、手绘，画出「浅」与「加深」
- **推荐强度（Recommendation strength）**：`Strong`、`Worth exploring`、`Speculative` 之一，做成徽章

报告结尾给一个 **Top recommendation** 小节：你会先动哪个候选，为什么。

**领域用 `GLOSSARY.md` 的词汇，架构用 `/codebase-design` 的词汇。** 若 `GLOSSARY.md` 定义了「Order」，就说「Order 接入模块」，不要说「FooBarHandler」，也不要说「Order 服务」。

**ADR 冲突**：若某个候选与既有 ADR 相矛盾，只有当摩擦真实到值得重开那条 ADR 时才提出来。在卡片里明确标注（例如一条警示：「与 ADR-0007 相矛盾，但值得重开，因为……」）。不要罗列每一条理论上被 ADR 禁止的重构。

完整的 HTML 骨架、示意图模式与样式指引见 [HTML-REPORT.md](../../.agents/skills/improve-codebase-architecture/HTML-REPORT.md)。

**先不要提接口。** 文件写好后问用户：「这些里你想深入探索哪一个？」

### 3. 拷打（grilling）循环

用户选定候选后，调用 Skill 工具加载 "grilling"，与他一起走那棵决策树：约束、依赖、加深后模块的形状、接缝后面放什么、哪些测试能活下来。

副作用在决策凝固时就地发生；调用 Skill 工具加载 "domain-modeling"，让领域模型随对话保持最新：

- **用 `GLOSSARY.md` 里没有的概念给加深后的模块命名？** 把该术语加进 `GLOSSARY.md`。文件不存在就惰性创建。
- **在对话中磨利了某个模糊术语？** 就地更新 `GLOSSARY.md`。
- **用户以承重的理由否决了这个候选？** 提议一条 ADR，措辞是：「要不要我把这个记成 ADR，好让以后的架构评审不再重复建议它？」只有当未来的探索者确实需要这条理由来避免重复建议时才提议；跳过临时性理由（「现在不值」）和自明的理由。
- **想为加深后的模块探索替代接口？** 调用 Skill 工具加载 "codebase-design"，用它的 design-it-twice 并行 subagent 模式。
