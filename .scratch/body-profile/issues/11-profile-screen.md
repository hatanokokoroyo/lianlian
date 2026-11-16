GitHub: #11
Status: resolved
Type: task
Blocked by: 8

# 11: 档案页

**What to build:** 档案页：按部位列出当前状态（五轴）、可展开看依据、可进入单个部位的**时间线**（历次判定、各自依据、哪次被更正），并支持"已解决"与"判定有误（撤回，必须写理由）"两个动作。

**Blocked by:** #8

**Status:** resolved

- [x] 部位列表按区域分组，显示最新取值，左右分开
- [x] 每条判定可展开看到四段式依据
- [x] 部位时间线按时间倒序，含更正事件与重视图
- [x] "已解决"追加正常判定；"撤回"要求填理由且条目转为无效
- [x] 肌群聚合视图可看到成员中的最差值
- [x] 词表外的部位不会出现在任何列表里

## 交付记录（#11）

- `domain/profile_page.rs`：档案页的读模型（词表里「档案」= Profile，读模型叫 ProfilePage，避免与会话归档 `archived` 混淆；`GLOSSARY.md` 补了「档案页 / 区域」两条），纯函数、零 IO。从事件流 + 依据日志算三样东西——
  按区域分好的卡片（肌肉跟首要肌群、骨骼跟区域，左右各一张，中线一张）、每行的四段依据与倒序时间线
  （每条判定标明写入 / 解决 / 撤回，并带它自己那条依据）、肌群聚合（成员逐轴取最差值并指名最差那条的来源）。
  词表外的 id 直接被跳过（旧库 / 手改 JSON 的防线）。「已解决」按**动作**判断（那条判定来自
  「标记已解决」追加的正常判定），不按取值判断。
- `api::Findings`：`load()` 读整个读模型；`resolve(finding)` 追加一条正常判定（`FindingDraft::resolve`）；
  `retract(finding, reason)` 撤回，理由空白直接拒。两个动作都走 `store::evidence` 的
  `record_with_evidence` / `retract_with_evidence`（判定与依据同一事务），依据里如实写
  「未经 agent 验证 / 未经复查」——它们是用户的动作，不冒充一次验证。
- `screens/findings.tsx`：档案条目区。区域标题可折叠（契约 §5）、五轴标签（未测虚线、异常 destructive）、
  展开看四段依据、时间线（最近在前、每条带自己的依据、当前生效标出来，任何一条都能撤回）、
  「标记已解决 / 判定有误」、肌群整体（成员最差值 + 最差那条的来源）、空档案引导去首次评估。
  列表与条件用 `Each` / `If`（按 key 保行）；撤回理由表单摆在列表上方，不塞进会重排的行里。
- `screens/profile.tsx`：档案页改成「档案条目在前、基本属性/测量/训练条件在后」，标题与说明跟着改；
  `ui/dates.ts` 抽出日期格式（测量页与档案页共用）。
- 测试：`cargo test` 194 项、`nsh test` 205 项（1 skipped）；新增 `Findings.test.tsx` 覆盖
  「通过提议卡真实落 3 条判定 → 分组与左右分开 → 区域折叠 → 展开四段依据 → 时间线 → 已解决后历史仍在 →
  历史里那条也能撤回 → 撤回必须写理由且撤到消失 → 肌群聚合指名最差那条 → 重开仍在」与
  「空档案引导去首次评估」。
- 视觉契约：`design/contract.md` §7 档案一行按实现补齐 testID；§9 记偏差（来源会话链接与
  修改训练条件的入口另开工单、撤回表单的位置、条目提到最前、撤回最后一条后整行消失、置信度一行）。
- 双轴评审（`/code-review`）：Standards 提了 3 个 P1（未登记的 testID、数字没等宽、`archive` 命名与词表冲突）
  与若干 P2；Spec 提了 2 个 P1（历史条目的依据只剩一段、历史条目不可撤回）。全部按上表修掉，
  P2 里接受的是区域折叠、slug 规则去重、按编号建一次索引、去掉未用字段与死代码。
- 没有改库结构，`schema_version` 不变（10）。

## Comments

- 手机不在时全部验收走 `nsh test`（headless，不需要设备）；真机目测留在最后。
- 已按双轴评审补齐后关闭：[GitHub #11 交付评论](https://github.com/hatanokokoroyo/lianlian/issues/11#issuecomment-6907397443)（`06eac03`）。
- 真机目测已补：[#11 补看记录](https://github.com/hatanokokoroyo/lianlian/issues/11#issuecomment-6907439789)。设备连不上不是线的问题——WSL 的 adb 占着 5037，Windows 侧 adb 起不来；Windows adb 换 5039 起、WSL 用 `ADB_SERVER_SOCKET` 连它即可（坑已写进 README）。
- 真机目测：`adb devices` 从 WSL 里看不到设备（Windows 侧 adb server 也没拿到），没收尾；
  等设备在 `adb devices` 里出现后跑 `nsh run --target android` 看一眼这屏。
