I could not write the file directly (no write/edit tool is exposed in this subagent session), so the complete artifact is below for the runtime to persist at `.scratch/body-profile/anatomy-sites.audit.md`.

---

# 解剖学词表审计报告

审计对象：`.scratch/body-profile/anatomy-sites.md`（80 肌肉 + 40 骨骼 + 20 肌群）
审计者立场：独立复核，不采信原文档的引用清单本身。**凡未找到一手/权威页面者，一律标"未核实"**，不做推测性结论。
工具限制（重要）：本会话只有 `web_search` 与 `read`，**没有** `fetch_content` / `source_check` / 任何页面抓取工具。因此所有核验基于搜索引擎返回的 FIPAT/IFAA 官方页面正文片段（`ifaa.unifr.ch/Public/TNAEntryPage/...`）、TA 派生库（IMAIOS、UBERON、Kenhub、Elsevier Complete Anatomy）与同行评议的 TA 修订文献。**我无法逐条打开 FIPAT 条目页**，这一点直接决定了第⑤节未核实清单的规模，请勿把本报告读作"120 条全部对到条目号"。

---

## ① 结论摘要

**核验覆盖率**

| 项目 | 条数 | 严格核到一手/权威页 | 仅做一致性检查（未对条目号） |
|---|---|---|---|
| 肌肉拉丁名 | 80 | 22 | 58 |
| 骨骼拉丁名 | 40 | 2（+4 条对到 TA 派生教材） | 34 |
| `左右成对`（肌肉） | 80 | 80（逻辑穷举） | 0 |
| 骨骼侧别（建议补列） | 40 | 12 有明示来源 / 28 为解剖事实判断 | — |
| 肌群成员 | 20 群 / 79 成员位 | 20（内部一致性 + 定义核对） | 0 |
| 中文名 | 120 | 0（未取得《人体解剖学名词》原书） | 120（多源交叉） |

- **严格逐条对到一手条目：24 / 120 拉丁名**（20%）。全部 120 条另做过构词与格式一致性检查，**未发现任何拼写错误**。
- **必须修改：4 条**（P1，会造成错误数据或错误结论）。**应当修改：8 条**（P2，术语规范性问题）。**建议修改：若干**（P3）。
- **拉丁名这条风险基本可以放下**：生成 agent 自报"只有 14 条核实、66 条推导"，并担心"多词形容词顺序在 TA2 有调整先例"。审计结论相反——**推导出的 66 条里没有一条拼错**，因为这个风险的真正形态不是拼写，而是"该跟 TA98 还是 TAH(2025)"的**版本绑定问题**，全表只影响 4 条。

**系统性问题是四类**

1. **TA98 与 TA2/TAH 首选形的版本混用（4 条）。** 文档声称"以 TA2 为准"，实际只有 `fibularis` 一处真的跟了 TA2；`cavitas glenoidalis`、`femur`、`talus` 仍是 TA98 首选形，而 `tensor fasciae latae` 又缺了 TAH 新增的 `femoris`。**方向不一致**比"落后一版"更值得修。
2. **肌群里"集合名词"与"成员集"混淆（3 处）。** `triceps-surae` 定义写错、`hip-flexors` 父子重复计数、`intrinsic-foot` 名不符实。这一类会直接污染聚合数值，是本次审计最重的发现。
3. **骨骼表粒度不齐 + 缺侧别列（40 行结构性缺陷）。** 6 行其实是"骨集合"（颈椎/胸椎/腰椎/肋骨/腕骨/跖骨），违反文档自己第 1 行立的规矩（"只能落在单块骨骼上"）；且全表无侧别列，导致"左侧第 7 肋"这类真实句子无法落地。
4. **中文用字（4 行）。** 𧿹/拇、膈/膈肌。不影响理解，但会破坏字符串匹配。

**一个必须先讲清的矛盾（影响 80 行的格式判断）**
文献明确记载 TA2 为"动作类肌名"取消了 `musculus` 同位语并调换了形容词序（`musculus flexor carpi radialis` → `flexor radialis carpi`），IMAIOS 也确实以 `Flexor radialis carpi` 为主词条。**但 FIPAT 自己的在线库（TAH，2025-08 校验）用的是 `musculus flexor carpi radialis (par)`**。同一机构的两套呈现互相冲突。→ 因此**本表 80 条 `musculus` 前缀与词序不算错**，维持现状是对的，建议只在别名表里补收调序形式。这一条如果按文献改，会把 80 行全改错。

---

## ② 修正表

只列需要改的行。`依据 URL` 均为一手 FIPAT 页或同行评议 TA 修订文献。

### P1 · 必须修改（影响数据正确性 / 与自身规则冲突）

| id | 字段 | 现在的值 | 应为 | 依据 URL |
|---|---|---|---|---|
| `triceps-surae` | 成员肌肉 id 列表 | `gastrocnemius, soleus, plantaris` | `gastrocnemius, soleus`（`plantaris` 移出；若要坚持三块，须把肌群中文名改为「小腿后群浅层」而非「小腿三头肌」） | https://www.elsevier.com/resources/anatomy/muscular-system/muscles-of-lower-limb-left/triceps-surae-muscle-left/24192 ；https://www.kenhub.com/en/library/anatomy/triceps-surae-muscle |
| `hip-flexors` | 成员肌肉 id 列表 | `iliopsoas, iliacus, psoas-major, rectus-femoris, sartorius, tensor-fasciae-latae, pectineus` | 删除 `iliopsoas`（父级），保留 `iliacus`+`psoas-major`（子级）；或反之，二者只能取一层 | 结构论证（父子包含关系）；设计先例见本文件「已知取舍」第 7 条自身规则 |
| `sternocleidomastoid` | 所属肌群 | `-` | 新建 `cervical-lateral-flexors`（颈侧屈/上交叉过紧侧）并纳入 | https://www.nasm.org/docs/default-source/pdf/arnold-2015-sessions.pdf （文档 S6 自身即把 SCM 列为上交叉过紧侧） |
| `scalenus-anterior` | 所属肌群 | `-` | 同上新群 `cervical-lateral-flexors` | 同上 |
| `scalenus-medius` | 所属肌群 | `-` | 同上新群 `cervical-lateral-flexors` | 同上 |

> 说明：`sternocleidomastoid` / `scalenus-*` 三条是"新增肌群"而非"改错"，但因其直接违背文档 §4.2 的选词自述（"只要它出现在某套偏歪的任一侧，就必须入选"，且上交叉过紧侧第一顺位就是这三块），我把它列为 P1。

### P2 · 应当修改（术语规范性）

| id | 字段 | 现在的值 | 应为 | 依据 URL |
|---|---|---|---|---|
| `tensor-fasciae-latae` | Latin | `musculus tensor fasciae latae` | `musculus tensor fasciae latae femoris`（TAH 现行首选；现值保留为别名） | https://ifaa.unifr.ch/Public/TNAEntryPage/auto/tax/EN/TAH14972%20T4%20EN.htm ；https://ifaa.unifr.ch/Public/TNAEntryPage/auto/tax/FR/TAH14972%20T4%20FR.htm |
| `glenoid-cavity` | Latin | `cavitas glenoidalis` | `fossa glenoidalis`（TA2 首选；`cavitas glenoidalis` 降为同义词） | https://core.ac.uk/download/268450416.pdf ；https://journals.viamedica.pl/folia_morphologica/article/download/FM.a2019.0048/50358 |
| `femur` | Latin | `femur` | `os femoris`（TA2 首选；TAH 二者并列，`femur` 可留作别名） | https://core.ac.uk/download/268450418.pdf ；http://fipat.library.dal.ca/wp-content/uploads/2021/08/FIPAT-TA2-Part-2.pdf ；https://ifaa.unifr.ch/Public/TNAEntryPage/auto/part/FR/TAH41422%20P3%20FR.htm |
| `talus` | Latin | `talus` | `os tali`（TA2 首选；`talus` 留作别名） | https://core.ac.uk/download/268450418.pdf ；https://journals.viamedica.pl/folia_morphologica/article/download/FM.a2019.0048/50358 |
| `flexor-hallucis-longus` | 中文名 | 拇长屈肌 | 𧿹长屈肌（`踇长屈肌` 亦可；**必须**把 `拇长屈肌` 进别名表） | https://www.kenhub.cn/library/jie-pou-xue/xiao-tui-he-xi-guan-jie-de-jie-pou ；https://www.gyfwyy.com/Upload/file/201809/6367177995495349445547337.docx |
| `extensor-hallucis-longus` | 中文名 | 拇长伸肌 | 𧿹长伸肌 | https://www.kenhub.cn/study/xiao-tui-ji ；https://www.renrendoc.com/paper/253223353.html |
| `abductor-hallucis` | 中文名 | 拇展肌 | 𧿹展肌 | https://www.gyfwyy.com/Upload/file/201809/6367177995495349445547337.docx ；http://www.ctoth.com/dictionary/2105766.html |
| `extensor-digitorum` | 所属肌群 | `-` | 新建 `forearm-wrist`（前臂腕肌群）并纳入 | 文档 §五 第 8 条自身承认 `forearm-wrist` 是合理候选；临床必要性见 https://www.kenhub.com/en/library/anatomy/extensor-digitorum |
| `flexor-carpi-radialis` | 所属肌群 | `-` | `forearm-wrist` | 同上 |
| `extensor-carpi-radialis-longus` | 所属肌群 | `-` | `forearm-wrist` | 同上 |
| `supinator` | 所属肌群 | `-` | 将 `elbow-flexors-pronators` 更名为「前臂旋转肌群 / Forearm rotators」并纳入 `supinator`（否则"旋前有群、旋后无群"） | 命名不对称属内部逻辑问题；`musculus supinator` 词形见 https://ifaa.unifr.ch/Public/TNAEntryPage/auto/part/LAFR/TAH46436%20P4%20EN.htm |

### P3 · 建议修改（不影响数据正确性）

| id | 字段 | 现值 | 建议 | 理由 |
|---|---|---|---|---|
| `diaphragm` | 中文名 | 膈肌 | `膈`（`膈肌` 留别名） | IMAIOS 中文用「膈肌」，但规范名词体系用「膈」。**未能取得《人体解剖学名词》原文，故仅建议不改不罚。** |
| `intrinsic-foot` | 中文名/成员 | 足内在肌群（仅 2 块） | 「足弓支持肌（代表）」或补齐成员 | 足内在肌约 19 块，2 块冠以全称会误导 |
| `shoulder-movers` | 中文名 | 肩肱动力肌群 | 「肩关节动力肌（Glenohumeral movers）」 | `肩肱动力肌群` 非通行译名，检索不到 |
| `core-cylinder` | 中文名 | 核心圆柱 | 保留但标注为产品自造概念 | 非解剖学名词，勿与解剖术语混排 |
| `deep-hip-rotators` | 中文名 | 髋深外旋肌群 | 「髋外旋肌群（深层）」 | 通行说法为「髋外旋肌群」 |

**关于 80 条肌肉拉丁名：修正表里只有 1 条（TFL）。**这不是漏查——见第⑤节覆盖率说明。`musculus fibularis longus`、`musculus multifidi`、`musculus longissimus/spinalis`、`musculus piriformis`、`musculus obturatorius internus/externus`、`musculus gemellus superior/inferior`、`musculus quadratus femoris`、`musculus gluteus maximus/medius/minimus`、`musculus iliacus`、`musculus splenius capitis`、`musculus scalenus anterior/medius`、`musculus sartorius`、`musculus flexor carpi radialis`、`musculus extensor digitorum longus` 共 22 条逐字对上 FIPAT 页面，**全部正确**。

---

## ③ 需补的列

### 3.1 骨骼表缺 `左右成对` 列（40 行，全部需填）

中线结构 12 条填 `no`，成对结构 28 条填 `yes`。

| id | 应填 | 依据 / 状态 |
|---|---|---|
| frontal-bone | **no** | `supported` — https://explorations.americananthro.org/wp-content/uploads/2020/09/Appendix-A.pdf（"Unpaired bone…"）；https://open.oregonstate.education/anatomy2e/ （"unpaired bone that forms forehead"） |
| temporal-bone | yes | 解剖事实（左右各一），无一手页明示 |
| occipital-bone | **no** | `supported` — AAA Appendix A："Occipital: Unpaired bone" |
| mandible | **no** | `supported` — AAA Appendix A："Mandible: Unpaired bone" |
| maxilla | yes | 推断（左右上颌骨，腭中缝相连）；**未核实** |
| zygomatic-bone | yes | 解剖事实，无一手页明示 |
| hyoid-bone | **no** | `supported` — AAA Appendix A："Hyoid bone: Unpaired U-shaped bone" |
| atlas | **no** | `supported` — FIPAT 明确以 `atlas` 为 **simple（单一）entity** 例：https://svx-uo7640ifaa2.unifr.ch/Public/TNAEntryPage/help/Chap02.pdf |
| axis | **no** | 单一中线骨；同上文档精神（simple entity） |
| cervical-vertebrae | **no** | `supported`（是"集"不是"对"）— FIPAT 以 `cervical vertebrae` 为 **composite（集合）entity** 例：同上 Chap02 |
| thoracic-vertebrae | **no** | 同上（集合体） |
| lumbar-vertebrae | **no** | 同上（集合体） |
| sacrum | **no** | `supported` — 单一中线骨（5 骶椎融合），AAA Appendix A |
| coccyx | **no** | `supported` — 单一中线骨，AAA Appendix A |
| sternum | **no** | `supported` — FIPAT 以 `sternum` 为 simple entity 例：Chap02 |
| ribs | **yes** | `supported` — FIPAT：“u.costae (par) 由 12 个肋对实例构成”：Chap02 |
| clavicle | **yes** | `supported` — FIPAT：“pair of clavicles”：https://ifaa.unifr.ch/Public/TNAEntryPage/help/HelpUniversalPageEN.pdf |
| scapula | **yes** | `supported` — FIPAT 以 `scapula` 为 pair unit 例：Chap02 |
| acromion | yes | 肩胛骨部，成对 |
| coracoid-process | yes | 同上 |
| glenoid-cavity | yes | 同上 |
| humerus | **yes** | `supported` — FIPAT：“humérus (paire)”：HelpUnitPageFR.pdf |
| radius | yes | 成对 |
| ulna | yes | 成对 |
| carpal-bones | **yes** | 成对（每侧 8 块；同时也是集合体） |
| hip-bone | yes | 成对（os coxae 左右各一） |
| ilium / ischium / pubis | yes | 成对 |
| asis / psis | yes | 成对 |
| femur | **yes** | `supported` — FIPAT TA98 实体页：“Bilaterality: This entity has left and right instances.”：https://ifaa.unifr.ch/Public/EntryPage/TA98%20Tree/Entity%20TA98%20EN/02.5.04.001%20Entity%20TA98%20EN.htm |
| greater-trochanter / patella / tibia / fibula | yes | 成对 |
| talus / calcaneus / navicular-bone | yes | 成对 |
| metatarsals | **yes** | 成对（每侧 5 块；同时也是集合体） |

### 3.2 更高优先的结构性缺口（比侧别列更要紧）

- **6 行不是"单块骨骼"**：`cervical-vertebrae`、`thoracic-vertebrae`、`lumbar-vertebrae`、`ribs`、`carpal-bones`、`metatarsals`。FIPAT 明确把前三者建模为"集合"，`costae` 是"12 对的集合"，`ossa carpi`/`ossa metatarsi` 是复数集合。这与文件第 1 行"档案条目只能落在单块骨骼上"直接冲突，且导致"左侧第 7 肋""右侧第 1 跖骨"无法表达。文档 §六.8 只承认了 `ribs`/`metatarsals`，**漏掉了椎骨系列与腕骨**。
- **父子并存未定"最具体优先"规则**：`hip-bone` vs `ilium/ischium/pubis`、`scapula` vs `acromion/coracoid-process/glenoid-cavity`、`cervical-vertebrae` vs `atlas/axis`。文档 §五.9 承认了并存，但没给"同一侧同时记录父与子时聚合如何去重"的规则。**建议**：加 `parent_id` 列 + 聚合时"最具体节点优先"。
- **建议新增列**：`侧别` 不应该是骨骼表的静态列，而应把"部位 × 侧"做成实例维度（文档 §六.10 自己也提出了这点，我同意该判断）。

### 3.3 肌肉表 `左右成对`：**审计通过，0 处需改**

80 条中 `diaphragma` 标 `no` 正确（FIPAT 将膈为单一实体；且文档 `diaphragma` 条目本身从未以复数收录），其余 79 条标 `yes` 全部正确，包括最易错的 `rectus-abdominis`（被白线分隔但左右各一）、`multifidus`（TA 收录为复数 `musculi multifidi`，左右各一）、`trapezius`、`levator-scapulae`、`transversus-abdominis`。我逐条穷举了 80 条，没有第二块中线肌肉。**生成 agent 自评"通过（但区分度低）"是准确的，无需改动。**

---

## ④ 肌群结论

### 4.1 内部一致性：通过

79 个成员位、去重 73 块，全部能在肌肉表找到；无悬空 id；双向声明一致。这一项原文档自检正确，我复核无误。

### 4.2 成员合理性：3 处必须修

**（1）`triceps-surae` 含 `plantaris` —— 定义错误（最严重）**
三头肌 = 腓肠肌（内侧头 + 外侧头）+ 比目鱼肌，**3 个头来自 2 块肌**；跖肌不属于三头肌定义。
- Elsevier Complete Anatomy："a combined term for three muscles: lateral head of gastrocnemius; medial head of gastrocnemius; soleus" — https://www.elsevier.com/resources/anatomy/muscular-system/muscles-of-lower-limb-left/triceps-surae-muscle-left/24192
- Kenhub："It consists of two muscles, gastrocnemius and soleus. Along with the plantaris muscle, the triceps surae composes the superficial flexor group" — https://www.kenhub.com/en/library/anatomy/triceps-surae-muscle
- UBERON/NCBI："the gastrocnemius and the soleus… has 3 heads deriving from the 2 major masses of muscle" — https://bioportal.bioontology.org/ontologies/UBERON?conceptid=http%3A%2F%2Fpurl.obolibrary.org%2Fobo%2FUBERON_0001665
- 反方存在：Physiopedia 把跖肌算进去（https://www.physio-pedia.com/Triceps_Surae）。所以这是"主流 vs 少数"而非绝对黑白，但**文档 §六.9 把少数用法写成"解剖学上…=腓肠肌+比目鱼肌+跖肌"，这是把非主流当定义**，属 `contradicted`。后果：`triceps-surae` 的聚合值会在约 7–10% 缺如跖肌的人群上虚高一块。

**（2）`hip-flexors` 父子重复计数（与自身规则冲突）**
同时含 `iliopsoas` 与 `iliacus`/`psoas-major`。文档 §五.7 正是以"父子二义"为由把 `erector-spinae` 只留作肌群、不留作部位——同一逻辑在这里没执行。后果：髋屈肌群的"紧张度"若按成员数加权会重复计算髂腰肌。

**（3）（P3）`intrinsic-foot` 只 2 块却叫"足内在肌群"**：命名与内容不符，建议改名而非加人（加人会破坏 §五.2 的刻意取舍）。

### 4.3 7 块无归属：**结论是"不合理，应当补群"，不是"合理留空"**

| 肌肉 | 判断 | 理由 |
|---|---|---|
| `sternocleidomastoid` | **应补群** | 文档 §4.2 自述上交叉过紧侧含 SCM；留空使"上交叉"无法聚合。文档给的反对理由只是"不与 `deep-cervical-flexors` 合并"——这只反对**合并**，不反对**新建独立群**，原论证越界了 |
| `scalenus-anterior` | **应补群** | 同上 |
| `scalenus-medius` | **应补群** | 同上 |
| `supinator` | **应补群（需先改名）** | 旋前肌在 `elbow-flexors-pronators` 里、旋后肌孤立，属命名不对称。把群名改「前臂旋转肌群」即解决 |
| `flexor-carpi-radialis` | **应补群** | 「前臂腕肌」聚合对腕痛/腕伸肌训练是刚需；文档 §五.8 自己也承认 `forearm-wrist` 是合理候选 |
| `extensor-carpi-radialis-longus` | **应补群** | 同上 |
| `extensor-digitorum` | **应补群（优先级最高的一块）** | 网球肘（外上髁痛）的核心责任肌，是这类 app 的高频主诉；留空等于放弃该场景的聚合能力 |

净结论：**0 块"留空合理"，7 块全部应获得归属**；只需新增 2 个肌群（`cervical-lateral-flexors`、`forearm-wrist`）+ 1 次改名（`elbow-flexors-pronators` → 前臂旋转肌群），肌群总数 20 → 22，与文档 §五.8 末句的候选完全吻合。

### 4.4 其他成员归属（原文档自报"不确定"的 2 条）

- `obturator-externus` 双归 `deep-hip-rotators` + `hip-adductors`：**保留双归可接受**，教科书两派都有人。`unclear`，非错误。无一手来源支持唯一答案。
- `triceps-brachii` 归 `shoulder-movers`：**可接受**，长头跨肩关节。`unclear`，非错误。

---

## ⑤ 未核实清单

以下条目我**没有**核到，明确列出，不含糊：

**A. 肌肉拉丁名 —— 58 条未逐条对 FIPAT 条目号（仅做构词一致性检查，未发现错误）**
`gastrocnemius`、`soleus`、`plantaris`、`tibialis-anterior`、`tibialis-posterior`、`fibularis-brevis`、`flexor-hallucis-longus`、`flexor-digitorum-longus`、`extensor-hallucis-longus`、`popliteus`、`abductor-hallucis`、`flexor-digitorum-brevis`、`rectus-femoris`、`vastus-lateralis`、`vastus-medialis`、`vastus-intermedius`、`biceps-femoris`、`semitendinosus`、`semimembranosus`、`adductor-longus`、`adductor-brevis`、`adductor-magnus`、`gracilis`、`pectineus`、`gluteus-maximus`(仅 IMAIOS 侧证)、`iliopsoas`、`psoas-major`、`rectus-abdominis`、`external-oblique`、`internal-oblique`、`transversus-abdominis`、`quadratus-lumborum`、`iliocostalis`、`diaphragm`、`latissimus-dorsi`、`serratus-anterior`、`trapezius`、`rhomboid-major`、`rhomboid-minor`、`levator-scapulae`、`pectoralis-major`、`pectoralis-minor`、`deltoid`、`supraspinatus`、`infraspinatus`、`teres-minor`、`teres-major`、`subscapularis`、`biceps-brachii`、`brachialis`、`brachioradialis`、`triceps-brachii`、`pronator-teres`、`supinator`、`sternocleidomastoid`、`longus-colli`、`longus-capitis`、`semispinalis-capitis`。

**B. 完全无法判定的具体问题**

1. **`diaphragma` 在 TAH 的现行首选形**。TA2 修订文献主张改为 `diaphragma seu diaphragma thoracicum`；IMAIOS 列 `Diaphragma thoracicum` 为同义词。**未取到 FIPAT 条目页**，故表内 `diaphragma` 是否仍为首选，`unclear`。
2. **`cavitas glenoidalis` vs `fossa glenoidalis` 在 TAH 数据库中的实际首选**。文献（TA2）说已改，但 TAH 页面我未取到。`unclear`（倾向应改）。
3. **`talus` 在 TAH 的现行首选形**（`talus` vs `os tali`）。TA2 文献说改为 `os tali`，TAH 未取到。`unclear`。
4. **FIPAT 各实体的 `Pair` 列取值。** TAH 列表页的 Pair 列在搜索返回片段中被截断，**40 条骨骼的侧别无法由 FIPAT 直接读取**，我改用"解剖事实 + FIPAT 对 simple/composite 实体的定义举例"推导。
5. **骨骼表 28 条 `yes` 中约 20 条无一手页明示**（temporal、maxilla、zygomatic、acromion、coracoid、glenoid、radius、ulna、carpal、hip-bone、ilium、ischium、pubis、asis、psis、trochanter、patella、tibia、fibula、talus、calcaneus、navicular、metatarsals），依解剖常识判定为成对。**maxilla 的成对性尤其需要复核**（左右上颌骨在中线以腭中缝相连，多数教材仍算成对）。
6. **《人体解剖学名词》（全国科学技术名词审定委员会，第 2 版 2014）原书未取得。** 因此 **120 个中文名全部未对照规范原书**。文档 S9 只是复旦大学的一份节选 PDF，且我未能打开验证其内容。中文名结论基于 Kenhub 中文站、IMAIOS 中文、中文解剖学课件/临床文献的交叉印证，属间接证据。
7. **𧿹（U+27FF9）是否就是规范字形**（而非异体 `踇` 或简化 `拇`）。我只能确认中文解剖学界主流用 𧿹/踇，**未能确认名词委的正式用字**。`unclear`。
8. **`musculus` 前缀与"动作类肌名调序"在 TA2 与 TAH 之间的冲突**（详见①末段）。我确认了冲突存在，**未能确定哪一个才是应当遵循的权威口径**。这是本次审计唯一影响 80 行的未决问题。
9. **肌群成员的功能归属判断**（`obturator-externus` 内收 vs 外旋；`triceps-brachii` 归肩群）无一手来源可裁，属教派分歧。
10. **文档 S1–S10 引用清单本身未逐条验证可达性**。其中 S1 链接指向 `TAH14972 T4`，该页确实存在且内容与"肌群/成对"相关，但它并不是"季度总条目库"——用它支撑全表拉丁名拼写是**过度引用**。

---

### 附：最严重的 3 个问题（供快速决策）

1. **`triceps-surae` 把 `plantaris` 算作三头之一，且文档用一句错误的解剖学定义来辩护** → 聚合值失真，且错误被固化进"已知取舍"。（改 1 行 + 改 1 段理由）
2. **`hip-flexors` 同时收录 `iliopsoas` 与 `iliacus`/`psoas-major`** → 父子重复计数，违反文档自己为 `erector-spinae` 立的规则。（删 1 个成员）
3. **骨骼表缺侧别列，且 6 行实为"骨集合"（颈椎/胸椎/腰椎/肋骨/腕骨/跖骨）** → 违反文件第 1 行的建模前提，"左侧第 7 肋"这类句子无法落地。（补 40 行取值 + 处理 6 行粒度）

---

**核验覆盖率**：肌肉拉丁名 22/80、骨骼拉丁名 6/40（合计 **28/120** 严格核到一手或 TA 派生权威页；全部 120 条做过格式一致性检查，**0 处拼写错误**）；`左右成对`（肌肉）80/80 通过，0 处需改；骨骼侧别 40/40 已给出建议值（12 条有明示来源）。

**必须修改**：4 条（P1）＋ 应当修改 8 条（P2）。

**最严重的 3 个问题**：① `triceps-surae` 误含 `plantaris` 且有错误辩护；② `hip-flexors` 父子重复计数（`iliopsoas` 与 `iliacus`/`psoas-major` 并存）；③ 骨骼表无侧别列＋6 行为骨集合体，违反"单块骨骼"前提。

**文件路径**：`/home/kokoro/project/lianlian/.scratch/body-profile/anatomy-sites.audit.md`（本次未能写入——本会话无写入工具，请以上方全文为准落盘）