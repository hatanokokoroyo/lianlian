# matt-workflow · 宣讲件

> 状态：**成品**（2026-11-18）。宣讲件 [`deck.html`](deck.html)、A4 带走件 [`cheatsheet.html`](cheatsheet.html)、逐页文案 [`deck-copy.md`](deck-copy.md) 均已就位。
>
> 前提：受众是**要用这套流程的工程师**。如果是给管理层做一次性汇报，应该改成 5 页 memo + 1 张图，本文不适用。

## 0. 一句话结论

做成一份**双模式单页 HTML**：宣讲时是 16:9 的 22 页 deck，会后是同一份数据的可点图册；再由同一份数据生成一张 A4 带走件。

不是「PPT 或文档二选一」，而是**一个事实源、两个视图、一张纸**。

## 1. 为什么不是纯 PPT / 纯文档

要讲的内容有三种完全不同的形状：

1. **一棵树**：ask-matt 的路由（处境 → 分支 → 阶段）。树需要展开、收起、点进去看，线性幻灯片只能一次讲一条路。
2. **三张矩阵**：分支特征、产物落点、远端依赖。矩阵需要并排比较和筛选，文档擅长、幻灯片不擅长。
3. **一条叙事线**：为什么要这么走、每一步防的是什么错。叙事需要节奏和留白，矩阵给不了。

所以主件必须是「能讲、也能查」的复合体。纯 PPT 讲得爽、会后没人查；纯 Markdown 查得爽、现场像念文档。

## 2. 候选格式

● 强　◐ 够用　○ 弱

| 形式 | 树的表达 | 现场宣讲 | 会后查阅 | 可 diff / 可维护 | 成本 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| Markdown + Mermaid | ◐ | ○ | ● | ● | 低 | 做讲稿源，不做主件 |
| 静态 HTML deck | ◐ | ● | ◐ | ● | 中 | 备选 |
| **双模式 HTML** | ● | ● | ● | ● | 中 | **推荐** |
| Keynote / Google Slides | ◐ | ● | ○ | ○ | 中 | 只适合一次性汇报 |
| 视频 | ◐ | ○ | ○ | ○ | 高 | 以后从 deck 录，不先做 |
| Notion / Confluence | ◐ | ◐ | ● | ○ | 中 | 与 git 脱节，数据和代码两套真源 |

双模式 HTML 的两个视图分工明确：

- **宣讲模式**：1280×720，`←/→` 翻页，一页一个主张，`F` 全屏，可打印成 PDF。
- **图册模式**：泳道图 + 点开详情，用来回答「我这种情况到底走哪条」「这个文件落在哪」。

两者读同一份 `data/skills.js`，不各写一遍。

## 3. 交付物

```
design/matt-workflow/
├── README.md              # 本文：方案、决策与维护
├── deck-copy.md           # 22 页逐页文案 + 附件使用计划 + 已确认记录
├── format-test.html       # 一次性格式样张（throwaway，验证「双模式」手感）
├── deck.html              # 主件：宣讲 + 图册
├── cheatsheet.html        # A4 双面带走件：路由表 + 产物落点表
├── data/
│   ├── skills.js          # 37 个 skill 的单一事实源
│   ├── slides-a.js        # P01–P11
│   └── slides-b.js        # P12–P22
├── assets/screens/        # 18 张原型截图 + 2 张 OD 截图（工作台 / 目录兜底）
└── scripts/
    ├── capture.sh         # 用 headless Chrome 重截原型图
    └── audit-skills.mjs   # 与 .agents/skills/、skills-lock.json 对账
```

`audit-skills.mjs` 扫 `.agents/skills/*/SKILL.md` 与 `data/skills.js` 对账，新增/删除/改名直接报错。漂移靠检查，不靠自觉。

### 怎么打开

- 直接双击 `deck.html` 或 `cheatsheet.html` 也能用（数据是 classic script，不依赖构建）。
- 想用固定地址：`python3 -m http.server 8765 --directory .`，然后开 `http://127.0.0.1:8765/design/matt-workflow/deck.html`。
- 图册：`deck.html#atlas`；单页：`deck.html#p13`。
- 带走件打印：`Ctrl/Cmd + P`，A4 双面，边距选「无」。
- 页脚署名：`李泽坤`（deck 屏幕/打印、cheatsheet 两页统一）。
- 对账：`node design/matt-workflow/scripts/audit-skills.mjs`。

## 4. 内容大纲（22 页，按 30–35 分钟设计）

> 逐页屏上文字、讲稿与素材编号以 [`deck-copy.md`](deck-copy.md) 为准；本节只保留章节结构。

### 0 · 定位（2 页）

- P1 封面：**会选，比会背重要**。
- P2 现场路由：四个处境按钮（有想法 / 别人提了 / 东西坏了 / 看不见路），点进去就是对应章节。**deck 自己演示 router**。

### 1 · 地图（3 页）

- P3 主干一张图：磨想法 → 出规格 → 拆工单 → 实现 → 评审 → PR → 复盘，标出四个分岔点。
- P4 分支特征总表：触发条件 / 会话数 / 上下文策略 / 关键产物 / 远端依赖 / 典型失败模式。
- P5 「一个会话装得下吗」判断树，带 smart zone（~150k tokens）与阶段边界五选项。

### 2 · 分支细讲（6 页）

- P6 单会话快路径：`grill-with-docs → implement → code-review → retro`。
- P7 多会话：`to-spec` 先定测试接缝；`to-tickets` 垂直切片 / 阻塞边 / 宽重构走 expand–contract。
- P8 两种实现：`implement` 逐票 + `/clear`，vs `implement-spec` 任务图 + 并行 worktree + 集成分支。差别是**谁编排**，不是项目大小。
- P9 原型支路：`handoff` 出去 → `prototype` → `handoff` 回来；原型留在 `prototype/<name>` 分支。
- P10 `wayfinder`：map + 决策工单，产出决策不产出交付物，地图清晰后交棒给 `to-spec`。
- P11 三个入口与盲区：`triage`（别人的问题，五状态）/ `diagnosing-bugs`（先有红灯）/ 独立工具 / 11 个未路由 skill。

### 3 · 案例：原型与 OpenDesign（4 页）

- P12 OpenDesign 在哪一格：人看 / agent 写 / git 存；它是工作台，不是流程。
- P13 案例一：三方向 × 两屏 → 9 屏 → `contract.md`（2026-11-15）。
- P14 案例二：档案 IA 四变体 → D，以及「23 肌群 + 8 骨骼区域」的领域纠偏。
- P15 为什么 Matt 的产物是原型的必要与助力：定坐标 / 定问题与答案 / 定落地。

### 4 · 产物与目录（3 页）

- P16 目录总图：`GLOSSARY.md`、`docs/adr/`、`.scratch/<feature>/`、`prototype/*`、`research/*`、`.out-of-scope/`。
- P17 本地产物清单：谁写 / 生命周期 / 是否入库 / 给谁看。
- P18 远端交互矩阵：GitHub / npm / web 一手资料 / 第三方后台；必须 / 可降级 / 可选 / 无。

### 5 · 团队协作（2 页）

- P19 三分法 2×2：权威 vs 派生，随仓库 vs 靠外部服务。
- P20 本仓库落地差异：GitHub + 本地双写、五个 canonical 标签、`gh 2.45.0` 的 API 回退、`/setup-matt-pocock-skills` 已卸载。

### 6 · 收尾（2 页）

- P21 五个常见误用。
- P22 带走件 + 来源与更新方式。

### 可选 workshop 附录（60 分钟场次）

1. 拿你手上的真实任务走一遍路由，写下第一步。
2. 画出它会产生的 3 个文件，标出谁看。
3. 找出一个现在只在本机、其实该共享的产物。

## 5. 数据模型

七个问题里有四个是同一批 skill 属性的不同切面，所以只维护一份数据：

```json
{
  "name": "to-tickets",
  "cn": "拆工单",
  "lane": "主干",
  "trigger": "多会话构建；一个窗口装不下",
  "session": "与上一步同一窗口",
  "context": "same-window",
  "outputs": [".scratch/<feature>/issues/NN-*.md"],
  "remote": ["github:sub-issue", "github:blocking"],
  "remoteNeed": "required-degradable",
  "share": "team-authoritative",
  "note": "垂直切片，每片穿过所有层；宽重构走 expand–contract。",
  "source": ".agents/skills/to-tickets/SKILL.md"
}
```

- `trigger` / `session` / `context` → 分支特征表（P4）。
- `outputs` → 产物清单（P17）。
- `remote` / `remoteNeed` → 远端矩阵（P18）。
- `share` → 团队三分法（P19）。

`share` 取值：

- `team-authoritative`：改变他人行为，必须共享。
- `repo-derived`：派生材料，适合入库，但不是权威。
- `local-ephemeral`：临时文件，只给当前会话或接手人。
- `secret`：只共享配置方法，不共享值。

## 6. 已核实、会改变讲法的事实

1. **ask-matt 不是全覆盖**：37 个已安装 skill 里，它提到 26 个，另有 11 个未路由（`chief-of-staff`、`claude-handoff`、`loop-me`、三个 `writing-*`、`migrate-to-shoehorn`、`scaffold-exercises`、两个 `setup-*`、`git-guardrails-claude-code`）。必须有一页「工具箱 / 盲区」，否则听众会以为漏讲了。
2. **`handoff` 写 `$TMPDIR`，`improve-codebase-architecture` 也写 `$TMPDIR`**：都是本地产物，不进仓库。这是「本地 ≠ 团队资产」最硬的例子。
3. **`.scratch/` 在本仓库是入库的**，但它是 agent 工作副本，不是团队文档。团队该看 GitHub issue，不该看 `.scratch` 路径。这条特别容易讲错。
4. **远端不止 GitHub**：还有 npm（`setup-*`）、web 一手资料（`research` / `teach`）、第三方后台（`wizard`）、Anthropic CLI（`claude-handoff`）。「是否必须」要分四类答。
5. **本仓库不跑 `/setup-matt-pocock-skills`**：配置在 `AGENTS.md` + `docs/agents/`，skill 文本里的相关指引要按本仓库约定修正。
6. **`triage` 只收别人提的**；`to-tickets` 的产物已经是 `ready-for-agent`，不要再 triage。
7. **上下文卫生是主流程的一部分**：1–3 步同一窗口，每个 `implement` 全新开始；~150k 是边界；`retro` 在 `/clear` 之前跑。
8. **`implement` 与 `implement-spec` 的差别是谁编排**，不是项目大小；两者都用 `tdd`，都收于 `code-review`。

## 7. 已拍板（2026-11-18）

| # | 决策 | 推荐 | 备选 |
| --- | --- | --- | --- |
| 1 | 媒体形态 | 双模式 HTML ✔ | 静态 deck / Markdown |
| 2 | 范围 | 分层讲全 37 ✔ | 只讲 26 / 只讲主干 11 |
| 3 | 时长 | 30 分钟主件 + workshop 附录 ✔ | 只 30 / 只 60 |
| 4 | 原版 vs 本仓库 | 主体讲原版，末章讲落地差异 ✔ | 全程混讲 / 只讲本仓库 |
| 5 | 交付物 | deck + A4 cheatsheet ✔ | 只 deck / 加录屏 |

逐页文案的 6 个待确认点也已拍板（2026-11-18）：

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 页数 | 22 页，可接受 |
| 2 | OD 章深度 | 4 页够；加 OD 工作台截图（A13，已用于 P12） |
| 3 | 现场演示 | 三处 live 都做（P02 路由、P13 九屏、P14 四变体） |
| 4 | 数据点 | 保留 13 / 7 分钟，并注明是提交时间不是决策时间 |
| 5 | 点名程度 | 保留 `#28–31` 与具体文件名（对内） |
| 6 | wayfinder 地图 | A8 用重绘示意（本仓库没有真实案例） |

## 8. 风险

- **漂移**：上游 skill 更新后，摘要会过期。靠 `source` 字段 + `skills-lock.json` hash + 对账脚本控制。
- **过度简化**：路由摘要不等于 skill 行为。每张卡都链到 `SKILL.md` 原文，并保留 ask-matt 的告诫：摘要只用于导航，执行前读原文。
- **设计目录污染**：`design/` 是 app 的视觉契约工作区（360px、暗色 `pulse.css`）。本目录是独立子项目，用纸感、桌面比例，**不链接进 `design/screens/index.html`**，也不要复用 app token。
- **页数膨胀**：37 个 skill 不要一 skill 一页。按层讲，只深挖 10 个左右代表。

## 9. 维护

1. 上游 skill 增删改：先跑 `node design/matt-workflow/scripts/audit-skills.mjs`，再补 `data/skills.js` 与对应页面文案。
2. 原型截图过期：跑 `design/matt-workflow/scripts/capture.sh` 重截（需要本地服务与 Chrome）。
3. OD 工作台截图：开 `localhost:7456` → 进入 `lianlian-design` → 1440×900 截左侧文件、中间对话、右侧预览；不要登录账号。
4. 中文讲稿与英文原文冲突：以 `.agents/skills/<name>/SKILL.md` 为准，改讲稿不改原文。
5. 对外版本：删掉 `#28–31`、具体文件名和内部提交时间，把「本项目案例」换成中性说法。
