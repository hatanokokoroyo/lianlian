# 视觉契约（Visual Contract）

本文件是 **设计稿与实现之间唯一的翻译层**。原型在 `design/screens/`（OD 原地读写，git 为版本真源）；实现（NSH）只认本文件，不认原型的 HTML 结构。

> 定稿方向：**C · 节拍**（深色 + 青柠，分段进度、大圆角、教练口吻）。A/B 两屏（`today-iron` / `today-ledger` / `profile-*`）只作风格考古，**不进实现**。

## 1. 怎么用

| 角色 | 读什么 | 产出 |
|---|---|---|
| agent 实现时 | 本文件的 §2 token 表、§4 组件映射、§6 交互契约、§7 testID | NSH 里的屏与组件 |
| 人评审时 | `screens/index.html` | 批注 → 回到同文件改 → 每轮一个 commit |
| 改设计时 | 先改屏，再改本文件；两者不一致以本文件为准 | — |

**不许**从原型里抄 HTML 结构、类名堆叠方式或 inline style——原型是"看着对"，实现要"结构对"。

## 2. Token 表（唯一真源 → `nsh.json` 的 `"theme"`）

v1 只有一种模式（深色）。全部值放在 `theme` 一节下，`light`/`dark` 不单独覆盖——否则系统切浅色会闪白。

| Token（shadcn 名） | 值 | 用在哪 |
|---|---|---|
| `background` | `#0f1114` | 页面底 |
| `foreground` | `#e8edf2` | 正文、标题 |
| `card` | `#171a1f` | 卡片、列表行、环形轨道容器 |
| `card-foreground` | `#e8edf2` | 卡片内文字 |
| `muted` | `#1e2229` | 二级底：输入框、禁用按钮、正常轴标签、未完成标记 |
| `muted-foreground` | `#8a93a0` | 次要文字、时间戳、说明、**正常轴** |
| `primary` | `#c8f04a` | 主行动、已完成、完成度环、当前 Tab |
| `primary-foreground` | `#10120c` | primary 底上的文字 |
| `accent` | `#6ee7f0` | 进行中、低置信度提示、链接式次要动作 |
| `accent-foreground` | `#06201f` | accent 底上的文字 |
| `destructive` | `#ff6b6b` | 异常且需注意的轴（紧 / 左弱 / 受限 / 疼痛>0）、删除 |
| `destructive-foreground` | `#1a0b0b` | destructive 底上的文字 |
| `border` | `#23272e` | 分隔线、描边、虚线（未测轴） |
| `radius`（`--radius`） | `20px`（卡片）/ `26px`（sheet） / `9999px`（胶囊） | 圆角档位只有这三档，别造第四档 |
| 字体 | 系统字体（不打包字体文件） | 全局 |
| 数字 | `tabular`（等宽数字） | 所有会变动的数字：百分比、组数、日期、体重 |

**语义映射（实现时按这个判断用哪个色，不要按"好看"选）**：

- `primary` = 用户做成了的事（已完成、打卡、当前所在）
- `accent` = 过程状态（进行中、待确认、可点开的解释）
- `destructive` = 需要干预的异常（不是"错误"，是"身体问题"）
- `muted` / `muted-foreground` = 正常、未测、不重要的

## 3. 屏清单

| # | 屏 | 原型文件 | 对应工单 |
|---|---|---|---|
| 1 | 今日 | `today-pulse.html` | #4（空态）、#14（清单与打卡） |
| 2 | 月历 | `calendar-pulse.html` | #16 |
| 3 | 日详情 | `day-detail-pulse.html` | #16 |
| 4 | 档案 | `profile-pulse.html` | #11 |
| 5 | 会话列表 | `conversation-list-pulse.html` | #6 |
| 6 | 对话 + 提议卡片 | `conversation-pulse.html` | #7、#10 |
| 7 | 体重趋势 | `measurements-pulse.html` | #5 |
| 8 | 首启引导 | `onboarding-pulse.html` | #4 |
| 9 | 设置 + 错误态 | `settings-pulse.html` | #7、#17 |

## 4. 组件映射（原型 → NSH）

| 原型 | NSH | 备注 |
|---|---|---|
| `div` 容器 / 卡片 | `View` + `bg-card` `rounded-(--radius)` | 一律 flexbox，禁用 grid 做主体布局 |
| 文字 | `Text` | 数字必须 `fontVariant: tabular-nums` |
| 可点区域 | `View` + `role="button"` + `onPress` | 命中区 ≥ 44px；禁用态用 `disabled` 属性而不是只改颜色 |
| 底部 Tab（4 项） | **自绘**：`View` 一行 4 个 press 区 | 不用 `nsh/mobile` 的 `TabBar`——系统 tab 样式与原型差异大；若日后要系统一致性再换，改这一处即可 |
| 页面切换 | `NavStack` / `NavPage` | 每个 Tab 一个页面；详情页（日详情、设置、体重）用 push |
| 完成度环 | **`Canvas` + `arc` + `lineCap: round`**，数字用 `Text` 绝对定位叠在上面 | 见 §6.1；不要 `fillText` |
| 动作列表 | 短列表用 `View` 序列，长列表用 `List` | 今日页 ≤ 10 项，用 View |
| 输入框 | `input` | 底部输入条要避开软键盘 |
| 底部弹层（推迟/删除确认） | `Sheet`（`nsh/base`） | 不用自绘 overlay |
| 系统级确认（撤回、删库） | `AlertDialog` | 走平台原生 |
| 折线图 | `Plot` 的 `Line` + `Dot` | 原型是 SVG polyline；**不要**在实现里手画路径 |
| 照片缩略图 | `Image` + Blob URL（字节由 Rust 给） | 移动端不能直接加载本地文件路径 |
| 勾选框（动作、提议项） | 自绘圆形 `View`（实心=完成/add 边框=未做/add 数字=进行中） | 不用 `Checkbox`——它的指示器形状与原型不符 |
| 成功反馈 | 自绘卡片 + 一次 `spring` 入场 | 不做长 keyframes 动画 |

## 5. 状态矩阵

每屏至少要能被实现成这几种形态（缺一个就是没做完）：

| 屏 | 空 | 加载 | 部分完成 | 满 | 错误 | 长内容 |
|---|---|---|---|---|---|---|
| 今日 | 无计划 → 引导去做首次评估 | 计划计算中（骨架行） | 1/4 项 · 环 25% | 全勾 → 打卡反馈 | 计划展开失败 → 重试 | 12 个动作 → 滚动，环固定在顶部 |
| 月历 | 本月无记录 → 空白格 + 提示 | 月度查询中 | 混合五种状态 | 全打卡 | 查询失败 | 6 周月份（35/42 格）不错位 |
| 日详情 | 休息日 → "这天没有安排" | — | — | 全部完成带 ✓ | — | 动作很多时整页滚动 |
| 档案 | 无任何 Finding → 引导去评估 | 投影计算中 | 部分轴未测（虚线） | 五轴齐全 + 多条历史 | 读库失败 | 40+ 部位 → 按区域分组 + 折叠 |
| 会话列表 | 0 个会话 → "新开一个"主行动 | — | — | 归档折叠区 | — | 100+ 会话 → 虚拟列表 |
| 对话 | — | 流式输出中（打字机） | 提议卡片待确认 | 已接受 → 可撤销摘要 | 三类错误（见 §8） | 长回复可滚、输入条固定 |
| 体重 | 无测量 → 空图 + 引导 | — | 1 个点 | 多点折线 | — | 200 条 → 列表折叠为按月 |
| 引导 | 步骤 1 | — | 步骤 2 | 步骤 3 | key 未填 → 指向设置 | — |
| 设置 | key 未填 | — | key 已填但验证中 | 已验证 | key 无效 / 无额度 | 三个分区滚动 |

## 6. 交互契约

### 6.1 完成度环

- 值 = 已完成动作数 / 总动作数，四舍五入到整数百分比。
- 半径与线宽按 96×96 设计稿的比例：`r=40`、`lineWidth=8`（实现里按 device px 换算，线宽取偶数避免发虚）。
- 起始角 `-π/2`（12 点方向），顺时针；`lineCap: round`。
- 动效：值变化用 `animated value`（0.7s，ease-out）；**打卡那一下**从当前值走到 100% 后再显示成功卡。
- **无障碍（硬要求）**：环本身 `accessibilityLabel = "今日完成 {n}%，{done}/{total} 项"`，环内的百分比 `Text` 对读屏隐藏（避免重复播报）。
- `reducedMotion` 为真时：不做动画，直接跳到终值。

### 6.2 提议卡片状态机

```
待确认 ──接受选中──→ 已应用（可撤销）
   │                    │
   │                    └──撤销──→ 待确认（追加 Correction，不删除历史）
   └──拒绝──→ 拒绝中（可填理由）──→ 已关闭
                    └──只是拒绝──→ 已关闭
```

- 默认勾选规则：置信度 ≥ 阈值 → 勾；低置信度 → 不勾并在标题旁标"低置信度"。
- 一次最多 8 项；超过时 agent 必须分轮（服务端拒绝，见 spec 的工具约束）。
- "接受选中 0 项"时按钮禁用。
- 拒绝后 agent **必须同轮**给出下一步（换方案 / 追问 / 撤回并说明）；只回"好的"算失败。

### 6.3 日历格子编码（双编码，不只靠颜色）

| 状态 | 形状 | 色 |
|---|---|---|
| 已完成 | 实心小圆点 | `primary` |
| 计划中 | 空心小圆环 | `muted-foreground` 描边 |
| 已推迟 | 日历格内文字标"推迟" | `accent` |
| 未完成 | 实心小灰点 | `border` |
| 休息日 | 无标记 | — |
| 今天 | 整格描边 | `primary` |

### 6.4 日状态迁移

`计划中 → 已完成`（全部动作勾完）/ `计划中 → 已推迟`（整天推迟）/ `计划中 → 未完成`（跨自然日 00:00 结算）。`已完成` 之后补取消勾选 → 回到 `计划中`（当天内允许）。

### 6.5 底部 Tab

4 项固定顺序：今日 / 日历 / 对话 / 档案。当前项 `primary`，其余 `muted-foreground`；切 Tab 不重置各自页面栈。

## 7. testID 规范

- kebab-case、语义命名、**英文 id + 中文由 agent 翻译**；与领域词表对齐（用 `site-` `exercise-` `proposal-` 这类前缀）。
- 每个**可交互元素**必须有；纯展示不加。
- 与 NSH 的 `testID` 一一对应，测试里直接引用。

已登记（实现时照抄，不要改名）：

| 前缀 | testID |
|---|---|
| 今日 | `tab-today` `open-calendar` `exercise-{slug}` `checkin` `postpone` `skip-exercise` `view-evidence` `today-ready-title` `today-start-assessment` `today-needs-training-title` `today-fill-training` `today-error` |
| 日历 | `tab-calendar` `day-{1..31}` `prev-month` `next-month` |
| 档案 | `tab-profile` `site-{slug}` `evidence-source` `mark-resolved` `retract` `open-timeline` `open-measurements` `edit-training-context` `open-settings` `save-basics` `save-training` `profile-training` `profile-training-missing` `profile-error` `profile-saved` |
| 会话 | `tab-conversations` `new-conversation` `conv-{slug}` `conv-menu` `archive-conv` `delete-conv` `message-input` `pick-photo` `send` `conv-actions` `undo` |
| 提议 | `accept-proposal` `reject-proposal` `reject-reason` |
| 体重 | `weight-chart` `add-measurement` `delete-measurement` |
| 引导 | `onboarding-next` `onboarding-prev` `onboarding-step-3` `onboarding-error` |
| 基本属性 | `basics-sex-{female\|male\|none}` `basics-age` `basics-height` `basics-weight` `condition-input` `condition-add` `condition-remove-{n}` |
| 训练条件 | `training-days-{2\|3\|4\|5}` `training-minutes-{15\|30\|45}` `training-place-{home\|gym\|office\|outdoor}` `training-equipment-{band\|dumbbell-8kg\|mat\|foam-roller\|nothing}` |
| 设置 | `api-key` `reveal-key` |
| 通用 | `back` `open-conversations` |

## 8. 不可迁移项与替代（原型里"能做"、NSH 里"别做"）

| 原型里的东西 | 实现替代 | 原因 |
|---|---|---|
| `backdrop-blur` 玻璃拟态 | 纯色 `bg-background` | NSH 无等价的廉价模糊 |
| 自定义字体文件 | 系统字体 + 字重/字距 | 不打包字体，包体与启动都省 |
| 长 `@keyframes` 庆祝动画 | 一次 `spring` 入场 + 静态成功卡 | 动效时长与性能不可控 |
| SVG 手绘折线 | `Plot` 组件 | 有现成组件，且它处理坐标与动效 |
| 硬编码 hex 颜色 | 只用 §2 的 token 名 | 主题切换与以后改色只改一处 |
| `position: fixed` 浮层 | `Sheet` / `Overlay` | 原生层叠与返回键行为 |

**三类错误态**（设置屏已给样子，实现要照做）：可重试（网络/429/5xx → 只给重试，输入不丢）/ 配置问题（key 无效、无额度 → 直接跳设置）/ 请求问题（超长、图过大 → 提示并自动裁剪重发一次）。

## 9. 与实现的偏差记录

| 日期 | 偏差 | 原因 |
|---|---|---|
| 2026-11-15 | 原型用 SVG `stroke-dasharray` 画环，实现改用 `Canvas arc` | 原型只是"看着对"；NSH 里可用 `Canvas` 的 arc + `animated value` 得到同样的视觉，且每帧由平台重绘、无 JS 开销 |
