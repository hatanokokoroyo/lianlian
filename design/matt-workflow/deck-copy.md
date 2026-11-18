# deck 文案 v1（已确认）

> 状态：**已确认并落地**。成品见 [`deck.html`](deck.html) 与 [`cheatsheet.html`](cheatsheet.html)；本文保留为逐页讲稿与维护底稿。
>
> `README.md` 已同步为 22 页；本文是逐页细化，新增第三章「案例：原型与 OpenDesign」4 页。
>
> 读法：先看 §0 讲法，再看 §1 附件表，最后逐页批注。每页都可以单独删改，不牵一发动全身。

## 0. 讲法与时长

- 22 页，30–35 分钟。标 **[查阅页]** 的 5 页不逐行念，只指一句就翻。
- 三处现场演示，均有静态兜底：
  1. P02 点四个处境按钮，deck 自己跳转。
  2. P14 打开 `profile-ia-prototype.html#variant=A`，按 `→` 切到 D。
  3. P13 打开 `today-pulse.html`，勾一个动作，看环与打卡按钮变化。
- 讲述节奏：先给地图（P03–P05），再讲分支（P06–P11），然后用本项目三个案例证明（P12–P15），最后落到产物与协作（P16–P22）。
- 原则：一页一个主张；矩阵页负责查阅，不负责讲完。

## 1. 附件清单

| ID | 名称 | 来源 | 用在哪 | 状态 | 采集方式 |
| --- | --- | --- | --- | --- | --- |
| A1 | 三方向六屏 | `design/screens/today-{iron,ledger,pulse}.html`、`profile-{iron,ledger,pulse}.html` | P13 左 | 已有 | 6 张 360×800@2x，3 列 × 2 行 |
| A2 | 九屏 contact sheet | `design/screens/*-pulse.html`（9 张） | P13 右 | 已有 | 9 张 360×800@2x，拼 3×3 |
| A3 | 档案 IA 四变体 | `design/screens/profile-ia-prototype.html#variant=A / B / C / D` | P14 上 | 已有 | 4 张根页 + 1 张区域页，4 列并排 |
| A4 | 视觉契约 | `design/contract.md` | P12 / P13 / P14 / P15 | 已有 | 裁 token 表 + testID 表两块 |
| A5 | 原型结论 | `.scratch/profile-navigation/prototype.md` | P14 / P15 | 已有 | 引用文字，不做截图 |
| A6 | spec 引用 D | `.scratch/profile-navigation/spec.md` | P07 / P14 / P15 | 已有 | 裁头部 + 「选型依据」那一行（不写死行号） |
| A7 | 四张工单 | `.scratch/profile-navigation/issues/28-*.md` 等 4 张 | P07 / P14 | 已有 | 4 个头部（GitHub/Status/Blocked by）拼一张 |
| A8 | wayfinder map 示意 | `.agents/skills/wayfinder/SKILL.md` 模板 | P10 | 已完成 | 重绘，不用真实截图（本仓库暂无 map） |
| A9 | 11 个未路由 skill | `.agents/skills/` | P11 | 已有 | 纯文字列表 |
| A10 | 远端失败降级表 | `docs/agents/issue-tracker.md` | P18 | 已有 | 裁「外部依赖失败时」表 |
| A11 | A4 带走件 | `cheatsheet.html` | P22 + 会后 | 已完成 | 路由表 + 文件落点表，双面 A4 |
| A12 | `skills.js` | `data/skills.js` | 全 deck 数据源 | 已完成 | 37 条，逐条对 `SKILL.md` |
| A13 | OD 工作台截图 | `http://localhost:7456/projects/` | P12 | 已截 `od-workbench.png` | 左侧文件 + 中间对话 + 右侧预览；无账号信息 |

**素材规矩**

- 设备屏一律 360×800@2x；deck 舞台 1280×720。
- OD 工作台截图保留文件列、对话列、预览列；不截账号信息与其他项目列表。
- 不截 secrets、`.env`、未脱敏日志；issue 截图只保留标签与结构。
- 能 live 的优先 live；截图是兜底，不是主路径。

---

## 2. 逐页文案

### P01 · 封面

**屏上**
- 37 个 skill，怎么选？
- 不是背命令，是认处境。
- ask-matt 的三层路由 · 2026-11

**讲稿**

今天不逐条讲 37 个 skill。只讲一张能带走的地图，再用我们自己项目的三次原型，说明这张地图怎么落到屏幕上。

**素材** 无（大字排版）

**版式** 左上大标题，底部一行副标题与日期

**时长** 0:30

---

### P02 · 现场路由

**屏上**
- 你现在手上是什么？
- 四个入口：
  - 有想法，要做出来 → 主干
  - 别人提了问题 → triage
  - 东西坏了 → diagnosing-bugs
  - 大得看不见路 → wayfinder
- 每个入口一行小字：适合谁、第一步是什么。

**讲稿**

我们先不看目录。你手上是什么，就点哪个；这份 deck 本身就是一个 router。点「有想法」去主干，点「别人提了」去入口章，点「坏了」看诊断，点「看不见路」看 wayfinder。后面的顺序可以按你们今天的处境跳。

**素材**
- 现场交互：四个按钮跳 `#p03` / `#p11?focus=triage` / `#p11?focus=diag` / `#p10`
- 兜底：四张入口卡截图，放在备注里

**版式** 四个大按钮，2×2；悬停显示第一步

**时长** 1:00

---

### P03 · 主干

**屏上**
- 磨想法 → 出规格 → 拆工单 → 实现 → 评审 → PR → 复盘
- 四个分岔：需要一个可跑的答案 / 一个会话装不下 / 问题不是你提的 / 东西坏了
- 主干只有一条，岔路是常态。

**讲稿**

主干是 `grill-with-docs` 磨想法，`to-spec` 出规格，`to-tickets` 拆工单，然后 `implement` 或 `implement-spec` 实现，`code-review` 收评审，`pr` 写 PR，`retro` 复盘。但真正要记的不是这条线，是四个岔口：需要跑一下才能答的，去原型；一个会话装不下的，去 wayfinder 或拆票；不是你提的问题，去 triage；说不清的坏，去 diagnosing-bugs。

**素材** 无（HTML/SVG 自绘）

**版式** 横向五段 + 下方四个虚线岔口卡；与格式样张 P2 同构

**时长** 2:00

---

### P04 · 分支特征总表 **[查阅页]**

**屏上**

| 分支 | 触发 | 会话与上下文 | 关键产物 | 远端 | 典型失败 |
| --- | --- | --- | --- | --- | --- |
| 单会话 | 想清楚就能做 | 1 个窗口 | 代码 + 提交 | 可选 | 没留痕，别人接不了 |
| 多会话 | 一窗装不下 | 每票一窗 | spec + 工单 + 集成分支 | 必需，可降级 | 规格没定接缝，返工 |
| 原型 | 需要可跑的答案 | 出去 / 回来 | 变体 + 结论 | 无 | 做成了 demo，没结论 |
| 迷雾 | 路还看不见 | 一票一会话 | map + 决策票 | 必需，原生阻塞 | 直接开工，边走边丢 |
| 外部问题 | 别人提的 issue/PR | 1 | 标签 + brief | 必需 | 把已 ready 的再 triage |
| 硬 bug | 说不清、偶发、回归 | 1 | 回归测试 | 无 | 没红灯就开始猜 |

**讲稿**

不逐行念。只看三列：会话数、上下文策略、关键产物。这三列决定你今天怎么排班：是继续在一个窗口里推，还是切票、开新窗口、或者先去做原型。

**素材** 无（表格排版；可进 A4）

**版式** 全宽表；字号压小，作为查阅页

**时长** 0:45

---

### P05 · 一个会话装得下吗

**屏上**
- 主流程 1–3 步：`grill-with-docs → to-spec → to-tickets` 必须同一个不间断窗口
- 每个 `implement`：全新窗口
- `retro`：在 `/clear` 之前跑
- smart zone：约 150k tokens
- 阶段边界五选项：Continue / `/clear` / `/handoff` / Subagent / `/compact`
- 默认是 `/compact`，不是 `/handoff`

**讲稿**

主流程最容易错的是上下文：磨想法、出规格、拆工单这三步必须连着，不然 spec 会丢掉访谈里的 why。到了实现，每张票重新开始，因为票是自包含的。窗口逼近 150k 就在最近的阶段边界压缩，不要在降智状态下硬推。阶段边界的默认选择是 compact；handoff 只用于换 harness、换目录、交给同事，或者阶段中途分叉。

**素材**
- 判断树自绘
- 可引用 `PHASE-BOUNDARIES.md` 的一句原文做脚注

**版式** 左侧判断树，右侧五个选项卡片

**时长** 1:30

---

### P06 · 单会话快路径

**屏上**
- `grill-with-docs → implement → code-review → retro`
- 产物：代码 + 提交
- 不产生：spec、工单、集成分支
- 适合：想清楚就能做、一个人能收口的事

**讲稿**

这是最短的一条：聊清楚，直接做，评审，复盘。它没有 spec 和 ticket，所以快；代价是没有纸面痕迹。如果后来要多人接手，或者要跨会话继续，就得补 spec——那时候你已经多花了一次上下文。

**素材** 无

**版式** 四个节点 + 一条"产物"标注

**时长** 1:00

---

### P07 · 多会话：spec 与 tickets

**屏上**
- `to-spec`：问题 / 方案 / 长用户故事 / 实现决策 / 测试决策 / 不在范围
- 先定**测试接缝**：优先已有、尽量高、理想只有一个
- `to-tickets`：垂直切片，每片穿过所有层、自身可演示、装进一个窗口
- 每票声明**阻塞边**；宽重构走 expand–contract
- 发布前盘问：粒度对吗 / 边对吗 / 要不要合并或再拆

**讲稿**

spec 不写文件路径和代码片段，因为它们很快过期。真正要先定的是接缝：从哪儿测，能测到什么，漏掉什么。接缝确认完，再写 spec。拆票不是按层拆，是按垂直切片拆：每一票自己就能演示。宽重构是例外，一次机械改动炸遍全库，走 expand–contract：先加新形态，再分批迁移，最后删旧的。

**素材**
- A6：spec 的章节标题（问题 / 方案 / 用户故事 / 实现决策 / 测试决策）
- A7：工单头部的四行（`GitHub` / `Status` / `Type` / `Blocked by`）

**版式** 左 spec 模板，右 ticket 头部 + 垂直切片示意

**时长** 2:00

---

### P08 · 两种实现方式

**屏上**

| | `implement` | `implement-spec` |
| --- | --- | --- |
| 谁编排 | 你 | 你编排，subagent 执行 |
| 上下文 | 每票一个新窗口 | 每票一个 subagent |
| 并行 | 无 | 按 frontier 并行 |
| 分支 | 当前分支 | 集成分支 + 每票 worktree |
| 收尾 | 每票 code-review | 集成分支一次 code-review |
| 共同点 | `tdd` 建代码，`code-review` 收口 | 同左 |

**讲稿**

差别不是项目大小，是谁来编排。你愿意一票一票驱动、每票之间 clear，就用 implement。你愿意把任务图交给它、自己盯 frontier 和合并，就用 implement-spec。后者快，但要付 worktree 和合并的成本；前者慢，但每一票的上下文最干净。

**素材** 无

**版式** 两栏对照，底部一条"共同点"

**时长** 1:30

---

### P09 · 原型支路

**屏上**
- 问号决定形状：
  - 状态 / 逻辑感觉对吗 → 单文件 HTML，自由操作 + 引导走查
  - 它该长什么样 → 同一路由多套变体，URL 参数 + 浮动底栏切换
- 六条规则：标明 throwaway / 一条命令能跑 / 默认不持久化 / 不抛光 / 暴露状态 / 做完留存
- 出去：`/handoff`；回来：`/handoff`
- 答案回填 spec 或 issue；原型留 `prototype/<name>` 分支

**讲稿**

原型不是"做个 demo"，是回答一个问题。问题的形状决定原型的形状：逻辑问题做成能按键的单页，UI 问题做成同一条路由上的多个变体。六条规则里最重要的是两条：从第一天就标明是 throwaway，以及做完必须留下结论。否则你会得到一堆漂亮 HTML，但没人记得它回答了什么。

**素材**
- `prototype/SKILL.md` 六条规则摘要
- `profile-ia-prototype.html` 的底栏切换截图（A3 的一部分）

**版式** 左"两条分支"，右"六条规则"

**时长** 2:00

---

### P10 · wayfinder

**屏上**
- 什么时候用：一个会话装不下，路还看不见
- map 五块：Destination / Notes / Decisions so far / Not yet specified / Out of scope
- 决策工单四类：research（AFK）/ prototype（HITL）/ grilling（HITL）/ task（HITL/AFK）
- 认领 = assignee；阻塞 = 原生依赖；frontier = 未关闭、无阻塞、无认领
- 一次只解一票（research 除外）
- 地图清晰后交棒 `to-spec`，不直接 `implement`

**讲稿**

wayfinder 产出的是决策，不是交付物。它把"从这里到目的地"画成一张共享地图，一次解一个决策票。每解一票，雾往后退一点，新票才长出来。地图清晰之后不要直接开工，先交给 to-spec 把互链的决策压成可构建计划，否则会丢掉关联细节。

**素材**
- A8：map 模板重绘
- 可裁 issue 上的原生阻塞边（本仓库暂无，标"示意"）

**版式** 左侧 map 五块，右侧四类票 + frontier 小图

**时长** 1:30

---

### P11 · 三个入口与盲区

**屏上**
- `triage`：五状态，只收**别人提的**；先验证，再 brief；拒绝的需求进 `.out-of-scope/`
- `diagnosing-bugs`：先拿到一条已经变红的紧反馈循环，再谈假设
- 独立工具：`grill-me` / `research` / `to-questionnaire` / `wizard` / `teach` / `wait-what` / `writing-for-agents`
- **盲区**：ask-matt 覆盖 26/37；11 个未路由
- 未路由名单：`chief-of-staff` · `claude-handoff` · `loop-me` · `writing-beats` / `writing-fragments` / `writing-shape` · `migrate-to-shoehorn` · `scaffold-exercises` · `setup-pre-commit` · `setup-ts-deep-modules` · `git-guardrails-claude-code`

**讲稿**

这两个入口最容易混。triage 只处理不是你提的问题；to-tickets 产出的票已经是 ready-for-agent，不要再 triage。diagnosing-bugs 的纪律是反直觉的：没有一条已经在这个 bug 上变红的命令，不许开始猜。最后一列是盲区：ask-matt 不是全覆盖，11 个 skill 它没路由；不是不重要，是需要你知道它们存在。

**素材**
- A9：11 个名字
- 五状态标签表（可裁 `docs/agents/triage-labels.md`）

**版式** 左 triage，中诊断，右独立工具 + 盲区列表

**时长** 2:00

---

### P12 · OpenDesign 在哪一格

**屏上**
- 三个角色：**人看** / **agent 写** / **git 存**
  - 人：`localhost:7456/projects/` 看屏、批注
  - agent：MCP 写屏，一屏一个 HTML
  - git：版本真源；OD 不是真源
- 它不替代任何 Matt 环节
- 它把 `/prototype` 的「做出来给人看」变便宜
- 边界：OD 产出「看着对」；实现只认 `contract.md`

**讲稿**

OpenDesign 是工作台，不是流程。它解决的是"UI 问题在对话里说不清"的那一段：人在浏览器里看，agent 直接改同一份文件，改完刷新就能看。我们把 `design/` 作为 OD 项目根，原地读写；一屏一个 HTML；Tailwind 4 + shadcn token；每个可交互元素带 `data-testid`；视口 360×800（另有 390/430 两档）。它没有改变 Matt 的分支结构，只是把原型这一步的手更快、眼更准。

**素材**
- A13：OD 工作台截图（左侧文件、中间对话、右侧预览）
- A4：`contract.md` 头部一句"唯一的翻译层"

**版式** 左三个角色，右一句边界；底部一条"在流程里的位置：prototype 分支内部"

**时长** 1:30

---

### P13 · 案例一：三方向 → 九屏 → 契约

**屏上**

```
2026-11-15
20:19   3 个方向 × 2 屏
        A 铁馆：近黑 + 电光橙，密度高
        B 台账：纸感 + 墨绿，表格化
        C 节拍：石板蓝 + 青柠，教练口吻
20:32   C 铺满 9 屏 + 可交互原型
20:40   五轴全显 + contract.md
```

- 每屏都带真实状态：部分完成、已解决部位、依据溯源、推迟/跳过、打卡禁用
- 选完立刻收口：token 表 / 屏清单 / 组件映射 / 状态矩阵 / testID
- 提交时间只说明迭代密度，不代表决策时间

**讲稿**

同一天晚上，先三个方向各两屏，每屏都带真实状态，不是空壳；然后选 C，把 9 屏全铺出来；再往下，五轴全显，写 contract。这里要分清三样东西：三方向是 throwaway 比较；九屏是选定方向的铺全，已经是视觉基准；contract 才是它进入实现的形态。选完立刻收口，是为了不让漂亮原型变成第二套真源。

**素材**
- A1：三方向六屏，左侧 3×2
- A2：九屏 contact sheet，右侧 3×3
- A4：contract 的 token 表裁图，底部一条
- live：`today-pulse.html` 勾选动作

**版式** 左侧时间线，右侧 A1 + A2；底部 A4

**时长** 2:30

---

### P14 · 案例二：档案 IA 改版

**屏上**

```
问题   档案根页随条目无限变长，索引和详情挤在一页
原型   4 个根页结构，一条 URL 切换
       A 目录 / B 关注优先 / C 筛选 / D 组合
结论   D：计划 → 需处理肌群 → 全部区域 → 我的数据
纠偏   实际是 23 个肌群 + 8 个骨骼区域，不是 8 个身体区域
落地   prototype.md → spec（30 条故事）→ #28–31 → 测试 → contract
```

- 原型 842 行，共享区域页 / 计划页 / 我的数据页
- A/B/C 只作对比，不进实现
- 四个工单都是垂直切片；实现改了读模型、档案页、导航与测试

**讲稿**

这次不是选风格，是选信息架构。四个变体只变根页结构：先看计划、先看异常、先筛选，还是组合。D 是把三者合成一页。最有价值的不是 D 本身，是原型逼出了一个领域事实：真实读模型是 23 个肌群加 8 个骨骼区域，不是 8 个身体区域；原型只用了 10 个代表区域做样本。如果根页想收成 8 个粗区域，那是另一个决策。原型不只改像素，它会改模型。

**素材**
- A3：四变体并排，顶部
- A5：结论与领域事实，引用文字
- A6：spec 引用 D 的那一行
- A7：四张工单头部
- live：`profile-ia-prototype.html#variant=A`，按 → 到 D

**版式** 上半 A3 四列，下半左侧 A5/A6，右侧 A7

**时长** 3:00

---

### P15 · 为什么 Matt 的产物是原型的必要与助力

**屏上**

| 作用 | Matt 产物 | 在本项目里的证据 |
| --- | --- | --- |
| 定坐标 | `GLOSSARY.md` / ADR | 档案条目、部位、区域、五轴定住；23 肌群 + 8 骨骼区域 |
| 定问题与答案 | `prototype` / `handoff` / `prototype.md` | 一条 URL 切四变体；回来的是结论，不是 842 行 HTML |
| 定落地 | `spec` / `tickets` / `contract` / `code-review` | D 进 spec；30 条故事；#28–31；contract 锁 token 与 testID |

- **必要**：需要跑一下才能答的问题，散文答不了
- **助力**：OpenDesign 让答案变便宜，Matt 让答案变可用

**讲稿**

没有 glossary，四个变体会变成四个产品；没有 prototype.md，842 行 HTML 会变成死胡同；没有 spec 和 tickets，D 只是一句"我们用 D 吧"；没有 contract，实现会去抄原型 HTML 的结构。所以原型不是 Matt 的替代品，它是 Matt 的一个分支；Matt 的产物是它的入口、出口和落地轨道。一句话：OpenDesign 负责看见，Matt 负责看见之后不再走丢。

**素材**
- 文字表为主
- A5 / A6 / A4 各裁一小块做证据，不铺满

**版式** 三行表 + 底部两句结论

**时长** 2:00

---

### P16 · 目录总图

**屏上**

```
/
├─ GLOSSARY.md              # 领域语言
├─ docs/adr/                # 难逆决策
├─ docs/agents/             # tracker / triage / domain 约定
├─ .scratch/<feature>/      # agent 工作副本
│  ├─ spec.md
│  ├─ issues/NN-*.md
│  ├─ prototype.md
│  └─ map.md
├─ .out-of-scope/           # 拒绝的需求
├─ design/                  # 原型 + 视觉契约
│  ├─ screens/
│  ├─ tokens/
│  └─ contract.md
└─ src/ + screens/          # NSH 实现
```

- 三类目录：**知识** / **工作副本** / **视觉**
- 权威顺序：GitHub issue > 本地镜像；`contract.md` > 原型 HTML

**讲稿**

这棵树只要记三类。知识类是 glossary、ADR、agent 约定；工作副本是 `.scratch`，它是 agent 读的东西；视觉类是 `design/`，原型和契约。权威顺序要背下来：远端 issue 是编号权威，本地镜像是工作副本；contract 是实现唯一认的东西，原型 HTML 只是给人看的视觉基准。

**素材** 真实 `tree -L 2` 的精简版

**版式** 左树，右三类图例

**时长** 1:30

---

### P17 · 本地产物清单 **[查阅页]**

**屏上**

| 产物 | 谁写 | 生命周期 | 入库 | 给谁看 |
| --- | --- | --- | --- | --- |
| `GLOSSARY.md` / ADR | grill-with-docs / domain-modeling | 长期 | 是 | 团队 + agent |
| `spec.md` | to-spec | 到交付 | 是 | agent + 团队 |
| `issues/NN-*.md` | to-tickets | 到关闭 | 是 | agent |
| `map.md` | wayfinder | 到交棒 | 是 | 团队 |
| `prototype.md` | prototype 回来时 | 长期 | 是 | 团队 + 未来 agent |
| research 笔记 | research | 按需 | 视结论 | agent |
| `contract.md` | 原型定稿后 | 长期 | 是 | 实现 + 评审 |
| handoff | handoff | 一次会话 | **否**（`$TMPDIR`） | 接手人 |
| 架构报告 | improve-codebase-architecture | 一次 | **否**（`$TMPDIR`） | 当前人 |
| `.env` / secrets | wizard | 长期 | **否** | 本机 / CI |

**讲稿**

只强调两行：handoff 和架构报告写在系统临时目录，不进仓库；它们是给当前这个人或接手人的，不是团队资产。`.scratch` 入库，但它是 agent 工作副本，不是团队文档——团队该看 GitHub issue。

**素材** 表

**版式** 全宽表；10 行，行高压紧

**时长** 0:45

---

### P18 · 远端交互矩阵 **[查阅页]**

**屏上**

| 类别 | 谁用 | 是否必须 | 断网 / 不可用怎么办 |
| --- | --- | --- | --- |
| GitHub issue / PR | to-spec / to-tickets / triage / wayfinder / pr | 语义上必须 | 本地先写 `GitHub: pending` |
| npm registry | setup-* / migrate-to-shoehorn | 仅安装时 | 依赖已装则可继续 |
| web 一手资料 | research / teach / diagnosing | 质量依赖 | 标注"未核实" |
| 第三方后台 | wizard | 人工必须 | 改为人工清单 |
| Anthropic CLI | claude-handoff | 可选 | 用普通 handoff |

**讲稿**

"是否必须"要分两层。对工作流语义，tracker 是必须的：编号、阻塞边、团队可见都靠它。对单个 session，不是必须的：本仓库双写，`gh` 不可用就写 `pending`，工作不停。另外，远端不止 GitHub：装依赖、查一手资料、点第三方后台，都是不同类别的远端。

**素材** A10：降级表裁图

**版式** 全宽表；5 行

**时长** 0:45

---

### P19 · 团队三分法

**屏上**

- 三个问题：它是权威吗？它随仓库走吗？它含敏感值吗？
- 2×2：权威 / 派生 × 随仓库 / 靠服务
- 右下角单独一条：**secrets 只共享配置方法，不共享值**

**讲稿**

别只问"在不在 git 里"。权威的、随仓库走的，必须共享并 review；权威的、靠服务的，给链接，比如 issue 和 PR；派生的、随仓库走的，可以入库，但要标明不是权威；派生的、不随仓库走的，只给接手人。最后，secrets 是另一条轴：方法可以共享，值永远不。

**素材** 2×2 图（与格式样张 P4 同构）

**版式** 2×2 居中，底部一条 secrets 注

**时长** 1:30

---

### P20 · 本仓库落地差异

**屏上**

| 事项 | 本仓库做法 |
| --- | --- |
| issue | GitHub 权威编号 + `.scratch` 镜像，双写 |
| 自己提的 issue | 跳过 `needs-triage`，直接 `ready-for-agent` |
| 标签 | 五个 canonical，未改名 |
| `gh` | 2.45.0；子 issue / 阻塞走 `gh api` + database id |
| setup skill | 已卸载；配置在 `AGENTS.md` + `docs/agents/` |
| 并发 | 单 agent 顺序；wayfinder 例外，用 assignee 认领 |

**讲稿**

这一页是"原版 vs 我们"。Matt 的原版是骨架，本仓库加了一层适配：双写、五个标签、自己提的跳过 triage、旧版 gh 的 API 回退。最重要的一句：skill 文本里让你跑 `/setup-matt-pocock-skills` 的地方，在本仓库可以忽略，配置已经在 AGENTS.md 和 docs/agents 里。

**素材** 无（表）

**版式** 全宽表；6 行

**时长** 0:45

---

### P21 · 五个常见误用

**屏上**

1. triage 自己提的 / 已经 `ready-for-agent` 的票
2. 把 `handoff` 当默认的阶段边界（默认是 `compact`）
3. 主流程 1–3 步中途 `/clear`
4. 把 `.scratch` 当团队文档
5. 把路由摘要当 skill 行为

**讲稿**

每条给一个症状和纠正。triage 只收别人的；handoff 只用于换 harness、目录、同事或中途分叉；磨想法到拆工单这三步不能断；`.scratch` 是给 agent 的工作副本；摘要只用于导航，执行前读 `SKILL.md` 原文。

**素材** 无

**版式** 五行，每行"症状 → 纠正"

**时长** 1:30

---

### P22 · 带走件与更新

**屏上**

- 带走：A4 双面
  - 正面：路由表（处境 → 分支 → 第一步）
  - 反面：文件落点表（产物 → 目录 → 共享归属）
- 三个入口：`SKILL.md` 原文 / `docs/agent-workflows.md` / `docs/skills-zh/`
- 更新：`skills-lock.json` → `check-skills-zh.sh` → `audit-skills.mjs`
- 一句话：先认处境，再选 skill；先留决策，再写代码。

**讲稿**

会后不用记 37 个名字，拿这张 A4 就够。要执行的时候，回到英文原文，不要背摘要。上游更新后先跑对账：锁文件、中文译本检查、skills.js 对账。最后一句：先认处境，再选 skill；先留决策，再写代码。

**素材**
- A11：A4 预览
- 二维码可选（链到仓库路径）

**版式** 左 A4 预览，右三条入口

**时长** 1:00

---

## 3. 现场演示动线

### 演示 1：路由（P02，30 秒）

1. 停在 P02。
2. 点「大得看不见路」→ 跳到 P10。
3. 说一句「这就是 ask-matt 在替你做的事：先认处境」，再回 P03。

### 演示 2：九屏（P13，60 秒）

1. 新标签打开 `today-pulse.html`。
2. 勾一个动作，指环从 25% 变到 50%，打卡按钮从禁用变可用。
3. 说「这不是静态图，是可交互原型；听众能自己点」。

### 演示 3：四变体（P14，90 秒）

1. 新标签打开 `profile-ia-prototype.html#variant=A`。
2. 按 `→` 切到 B、C、D，每切一次说一句区别。
3. 在 D 里点一个区域，进区域页，再返回。
4. 说「一个 URL 就是一个决策空间；选完把 D 写进 spec」。

### 兜底

- 每个 live 都准备 3 张静态截图。
- 网络/浏览器故障时直接翻截图，讲稿不变。

## 4. 已确认（2026-11-18）

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 页数 | 22 页，可接受；不裁 P04 / P17 / P20。 |
| 2 | OD 章深度 | 4 页够；加 OD 工作台截图（A13，已用于 P12）。 |
| 3 | 现场演示 | 三处 live 都做：P02 路由、P13 九屏、P14 四变体。 |
| 4 | 数据点 | 保留 13 / 7 分钟，并注明是提交时间，不是决策时间。 |
| 5 | 点名程度 | 保留 `#28–31` 与具体文件名；对外版再脱敏。 |
| 6 | wayfinder 地图 | A8 用重绘示意；本仓库没有真实案例。 |

成品：`deck.html`（宣讲 + 图册）、`cheatsheet.html`（A4 双面）、`data/skills.js`（37 条）。

## 5. 史实核对

| 说法 | 证据 |
| --- | --- |
| 3 方向 × 2 屏 | `571220a`，2026-11-15 20:19:23 +0800，14 files / 689 insertions |
| 9 屏 + 可交互 | `c596ecc`，20:32:47 +0800，12 files / 1027 insertions |
| 五轴全显 + contract | `89581d5`，20:40:02 +0800，4 files / 211 insertions |
| IA 原型 842 行 | `wc -l design/screens/profile-ia-prototype.html` = 842 |
| 30 条用户故事 | `spec.md` 中 `^[0-9]+\. 作为` 计数 = 30 |
| 4 张工单 | `#28` 无阻塞；`#29`、`#30` blocked by 28；`#31` blocked by 28/29/30 |
| 23 肌群 + 8 骨骼区域 | `.scratch/profile-navigation/prototype.md`「需要记住的领域事实」 |

> 提交时间是迭代密度的证据，不是决策耗时的证据；讲稿已按此措辞。
