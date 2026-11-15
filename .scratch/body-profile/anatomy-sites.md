# 解剖学部位词表（Anatomy Sites）

> 用途：约束「部位（Site）」的取值空间——档案条目只能落在本文件列出的单块肌肉或单块骨骼上；肌群只是查询时算出来的聚合视图，不是可记录的部位（见 `GLOSSARY.md`）。
> 范围：**实用优先**，覆盖体态评估、常见肌骨疼痛、以及常见力量训练动作（深蹲 / 硬拉 / 推 / 拉 / 旋转 / 踝髋活动度），不做解剖学全量。
> 命名依据：拉丁名**以 FIPAT 现行版（TAH）的首选形为准，TA98 / TA2 的旧形进「Latin 别名」列**——两者混用比落后一版更糟（见 `anatomy-sites.audit.md` P2）；中文名以《人体解剖学名词》体系为准（原书未取得，见审计报告第 ⑤ 节）；肌群划分参照 NASM 的肌肉失衡/体态偏歪分类与 Myers《Anatomy Trains》的肌筋膜线。
> 显示用字：`拇长屈肌 / 拇长伸肌 / 拇展肌` 用通用字「拇」作显示名，规范字形「𧿹」进别名列——生僻字在 Android 字体与输入法上不可靠，显示名必须可渲染、可搜索。
> 侧别：`左右成对 = yes` 的部位在档案里必须带侧别（左 / 右）才能落判定；`no` 的中线结构不带侧别。骨骼的 `粒度 = group` 行（颈/胸/腰椎、肋骨、腕骨、跖骨）是**可记录的集合区域**，聚合时子项优先于父项。
> 排序：肌肉表按「小腿足 → 大腿膝 → 髋骨盆 → 躯干 → 肩带肩 → 上肢 → 颈」排列，无序号列。

## 引用来源

| # | 来源 | 用来支撑什么 |
|---|---|---|
| S1 | [FIPAT / IFAA Terminologia Anatomica 官方条目库（含 pair 标记）](https://ifaa.unifr.ch/Public/TNAEntryPage/auto/tax/EN/TAH14972%20T4%20EN.htm) | 拉丁名拼写、`par`（成对）标记 |
| S2 | [TNA 条目页结构说明（official Latin term / official subsidiary term）](https://ifaa.unifr.ch/Public/TNAEntryPage/help/GTUnitPage.pdf) | 拉丁名与英文名的官方对应关系 |
| S3 | [FIPAT Terminologia Anatomica 版本与状态](https://www.wikiwand.com/en/Terminologia_Anatomica) | TA2（2019 发布 / 2020 通过）为现行版本 |
| S4 | [peroneal → fibular 用词纠正表](https://core.ac.uk/download/268450418.pdf) | 腓骨肌群拉丁名的 `fibularis` 拼法 |
| S5 | [JOSPT: Terminologia Anatomica — Revised Anatomical Terminology](https://jospt.org/doi/pdf/10.2519/jospt.2004.0107) | 物理治疗文献中 TA 用词的落地 |
| S6 | [NASM: Pronation Distortion / Upper Body 体态偏歪与肌肉失衡](https://www.nasm.org/docs/default-source/pdf/arnold-2015-sessions.pdf) | 过紧/无力肌肉清单 → 选词依据 |
| S7 | [Anatomy Trains 筋膜线解剖证据（SBL / SFL / LL / SL / Arm Lines / DFL）](https://www.anatomytrains.com/wp-content/uploads/2012/07/dissection.pdf) | 线条划分 → 选词依据 |
| S8 | [Anatomy Trains 各线成员概览](https://worldmassageconference.com/sites/worldmassageconference.com/files/10-Tom-Myers.pdf) | 同上 |
| S9 | [复旦大学《人体解剖学名词》条目节选（中文↔拉丁）](https://xtjp.fudan.edu.cn/Upload/Files/202108021335473939353.pdf) | 竖脊肌群、半棘肌、多裂肌等中文名 |
| S10 | [IMAIOS e-Anatomy 中文（臀大肌条目，中文↔拉丁对照）](https://www.imaios.cn/cn/e-anatomy/anatomical-structures/musculus-gluteus-maximus-14255908) | 中文名与拉丁名的逐条对照 |

---

## 一、肌肉表（79 条）

`所属肌群` 列填写肌群表里的 `id`，可多值（用逗号分隔）；审计后**无肌肉无归属**。`Latin 别名` 列记录非首选的旧形与规范字形。
`左右成对` 指该肌肉在人体上是否为左右各一、需要分别记录的成对结构。

| id | 中文名 | English | Latin | Latin 别名 | 所属肌群 | 左右成对(yes/no) |
|---|---|---|---|---|---|---|
| gastrocnemius | 腓肠肌 | Gastrocnemius | musculus gastrocnemius | - | posterior-leg-superficial | yes |
| soleus | 比目鱼肌 | Soleus | musculus soleus | - | posterior-leg-superficial | yes |
| plantaris | 跖肌 | Plantaris | musculus plantaris | - | posterior-leg-superficial | yes |
| tibialis-anterior | 胫骨前肌 | Tibialis anterior | musculus tibialis anterior | - | ankle-dorsiflexors | yes |
| tibialis-posterior | 胫骨后肌 | Tibialis posterior | musculus tibialis posterior | - | deep-posterior-leg | yes |
| fibularis-longus | 腓骨长肌 | Fibularis longus | musculus fibularis longus | - | lateral-calf | yes |
| fibularis-brevis | 腓骨短肌 | Fibularis brevis | musculus fibularis brevis | - | lateral-calf | yes |
| flexor-hallucis-longus | 拇长屈肌 | Flexor hallucis longus | musculus flexor hallucis longus | 𧿹长屈肌（规范字形） | deep-posterior-leg | yes |
| flexor-digitorum-longus | 趾长屈肌 | Flexor digitorum longus | musculus flexor digitorum longus | - | deep-posterior-leg | yes |
| extensor-digitorum-longus | 趾长伸肌 | Extensor digitorum longus | musculus extensor digitorum longus | - | ankle-dorsiflexors | yes |
| extensor-hallucis-longus | 拇长伸肌 | Extensor hallucis longus | musculus extensor hallucis longus | 𧿹长伸肌（规范字形） | ankle-dorsiflexors | yes |
| popliteus | 腘肌 | Popliteus | musculus popliteus | - | deep-posterior-leg | yes |
| abductor-hallucis | 拇展肌 | Abductor hallucis | musculus abductor hallucis | 𧿹展肌（规范字形） | intrinsic-foot | yes |
| flexor-digitorum-brevis | 趾短屈肌 | Flexor digitorum brevis | musculus flexor digitorum brevis | - | intrinsic-foot | yes |
| rectus-femoris | 股直肌 | Rectus femoris | musculus rectus femoris | - | quadriceps, hip-flexors | yes |
| vastus-lateralis | 股外侧肌 | Vastus lateralis | musculus vastus lateralis | - | quadriceps | yes |
| vastus-medialis | 股内侧肌 | Vastus medialis | musculus vastus medialis | - | quadriceps | yes |
| vastus-intermedius | 股中间肌 | Vastus intermedius | musculus vastus intermedius | - | quadriceps | yes |
| biceps-femoris | 股二头肌 | Biceps femoris | musculus biceps femoris | - | hamstrings | yes |
| semitendinosus | 半腱肌 | Semitendinosus | musculus semitendinosus | - | hamstrings | yes |
| semimembranosus | 半膜肌 | Semimembranosus | musculus semimembranosus | - | hamstrings | yes |
| adductor-longus | 长收肌 | Adductor longus | musculus adductor longus | - | hip-adductors | yes |
| adductor-brevis | 短收肌 | Adductor brevis | musculus adductor brevis | - | hip-adductors | yes |
| adductor-magnus | 大收肌 | Adductor magnus | musculus adductor magnus | - | hip-adductors | yes |
| gracilis | 股薄肌 | Gracilis | musculus gracilis | - | hip-adductors | yes |
| pectineus | 耻骨肌 | Pectineus | musculus pectineus | - | hip-adductors, hip-flexors | yes |
| sartorius | 缝匠肌 | Sartorius | musculus sartorius | - | hip-flexors | yes |
| tensor-fasciae-latae | 阔筋膜张肌 | Tensor fasciae latae | musculus tensor fasciae latae femoris | musculus tensor fasciae latae | hip-flexors | yes |
| gluteus-maximus | 臀大肌 | Gluteus maximus | musculus gluteus maximus | - | gluteal-group | yes |
| gluteus-medius | 臀中肌 | Gluteus medius | musculus gluteus medius | - | gluteal-group | yes |
| gluteus-minimus | 臀小肌 | Gluteus minimus | musculus gluteus minimus | - | gluteal-group | yes |
| piriformis | 梨状肌 | Piriformis | musculus piriformis | - | deep-hip-rotators | yes |
| obturator-internus | 闭孔内肌 | Obturator internus | musculus obturatorius internus | - | deep-hip-rotators | yes |
| obturator-externus | 闭孔外肌 | Obturator externus | musculus obturatorius externus | - | deep-hip-rotators, hip-adductors | yes |
| gemellus-superior | 上孖肌 | Gemellus superior | musculus gemellus superior | - | deep-hip-rotators | yes |
| gemellus-inferior | 下孖肌 | Gemellus inferior | musculus gemellus inferior | - | deep-hip-rotators | yes |
| quadratus-femoris | 股方肌 | Quadratus femoris | musculus quadratus femoris | - | deep-hip-rotators | yes |
| iliacus | 髂肌 | Iliacus | musculus iliacus | - | hip-flexors | yes |
| psoas-major | 腰大肌 | Psoas major | musculus psoas major | - | hip-flexors | yes |
| rectus-abdominis | 腹直肌 | Rectus abdominis | musculus rectus abdominis | - | abdominal-wall | yes |
| external-oblique | 腹外斜肌 | External oblique | musculus obliquus externus abdominis | - | abdominal-wall | yes |
| internal-oblique | 腹内斜肌 | Internal oblique | musculus obliquus internus abdominis | - | abdominal-wall | yes |
| transversus-abdominis | 腹横肌 | Transversus abdominis | musculus transversus abdominis | - | abdominal-wall, core-cylinder | yes |
| quadratus-lumborum | 腰方肌 | Quadratus lumborum | musculus quadratus lumborum | - | core-cylinder | yes |
| iliocostalis | 髂肋肌 | Iliocostalis | musculus iliocostalis | - | erector-spinae | yes |
| longissimus | 最长肌 | Longissimus | musculus longissimus | - | erector-spinae | yes |
| spinalis | 棘肌 | Spinalis | musculus spinalis | - | erector-spinae | yes |
| multifidus | 多裂肌 | Multifidus | musculi multifidi | - | core-cylinder | yes |
| diaphragm | 膈肌 | Diaphragm | diaphragma | - | core-cylinder | no |
| latissimus-dorsi | 背阔肌 | Latissimus dorsi | musculus latissimus dorsi | - | shoulder-movers | yes |
| serratus-anterior | 前锯肌 | Serratus anterior | musculus serratus anterior | - | scapulothoracic | yes |
| trapezius | 斜方肌 | Trapezius | musculus trapezius | - | scapulothoracic, cervical-extensors | yes |
| rhomboid-major | 大菱形肌 | Rhomboid major | musculus rhomboideus major | - | scapulothoracic | yes |
| rhomboid-minor | 小菱形肌 | Rhomboid minor | musculus rhomboideus minor | - | scapulothoracic | yes |
| levator-scapulae | 肩胛提肌 | Levator scapulae | musculus levator scapulae | - | scapulothoracic, cervical-extensors | yes |
| pectoralis-major | 胸大肌 | Pectoralis major | musculus pectoralis major | - | shoulder-movers | yes |
| pectoralis-minor | 胸小肌 | Pectoralis minor | musculus pectoralis minor | - | scapulothoracic | yes |
| deltoid | 三角肌 | Deltoid | musculus deltoideus | - | shoulder-movers | yes |
| supraspinatus | 冈上肌 | Supraspinatus | musculus supraspinatus | - | rotator-cuff | yes |
| infraspinatus | 冈下肌 | Infraspinatus | musculus infraspinatus | - | rotator-cuff | yes |
| teres-minor | 小圆肌 | Teres minor | musculus teres minor | - | rotator-cuff | yes |
| teres-major | 大圆肌 | Teres major | musculus teres major | - | shoulder-movers | yes |
| subscapularis | 肩胛下肌 | Subscapularis | musculus subscapularis | - | rotator-cuff | yes |
| biceps-brachii | 肱二头肌 | Biceps brachii | musculus biceps brachii | - | elbow-flexors | yes |
| brachialis | 肱肌 | Brachialis | musculus brachialis | - | elbow-flexors | yes |
| brachioradialis | 肱桡肌 | Brachioradialis | musculus brachioradialis | - | elbow-flexors | yes |
| triceps-brachii | 肱三头肌 | Triceps brachii | musculus triceps brachii | - | shoulder-movers | yes |
| pronator-teres | 旋前圆肌 | Pronator teres | musculus pronator teres | - | forearm-rotators | yes |
| supinator | 旋后肌 | Supinator | musculus supinator | - | forearm-rotators | yes |
| flexor-carpi-radialis | 桡侧腕屈肌 | Flexor carpi radialis | musculus flexor carpi radialis | - | forearm-wrist | yes |
| extensor-carpi-radialis-longus | 桡侧腕长伸肌 | Extensor carpi radialis longus | musculus extensor carpi radialis longus | - | forearm-wrist | yes |
| extensor-digitorum | 指伸肌 | Extensor digitorum | musculus extensor digitorum | - | forearm-wrist | yes |
| sternocleidomastoid | 胸锁乳突肌 | Sternocleidomastoid | musculus sternocleidomastoideus | - | cervical-lateral | yes |
| scalenus-anterior | 前斜角肌 | Scalenus anterior | musculus scalenus anterior | - | cervical-lateral | yes |
| scalenus-medius | 中斜角肌 | Scalenus medius | musculus scalenus medius | - | cervical-lateral | yes |
| longus-colli | 颈长肌 | Longus colli | musculus longus colli | - | deep-cervical-flexors | yes |
| longus-capitis | 头长肌 | Longus capitis | musculus longus capitis | - | deep-cervical-flexors | yes |
| splenius-capitis | 头夹肌 | Splenius capitis | musculus splenius capitis | - | cervical-extensors | yes |
| semispinalis-capitis | 头半棘肌 | Semispinalis capitis | musculus semispinalis capitis | - | cervical-extensors | yes |

## 二、骨骼表（40 条）

| id | 中文名 | English | Latin | Latin 别名 | 所属区域 | 左右成对(yes/no) | 父级 | 粒度 |
|---|---|---|---|---|---|---|---|---|
| frontal-bone | 额骨 | Frontal bone | os frontale | - | 颅面 | no | - | single |
| temporal-bone | 颞骨 | Temporal bone | os temporale | - | 颅面 | yes | - | single |
| occipital-bone | 枕骨 | Occipital bone | os occipitale | - | 颅面 | no | - | single |
| mandible | 下颌骨 | Mandible | mandibula | - | 颅面 | no | - | single |
| maxilla | 上颌骨 | Maxilla | maxilla | - | 颅面 | yes | - | single |
| zygomatic-bone | 颧骨 | Zygomatic bone | os zygomaticum | - | 颅面 | yes | - | single |
| hyoid-bone | 舌骨 | Hyoid bone | os hyoideum | - | 颅面 | no | - | single |
| atlas | 寰椎 | Atlas (C1) | atlas | - | 脊柱 | no | cervical-vertebrae | single |
| axis | 枢椎 | Axis (C2) | axis | - | 脊柱 | no | cervical-vertebrae | single |
| cervical-vertebrae | 颈椎 | Cervical vertebrae | vertebrae cervicales | - | 脊柱 | no | - | group（可记录的集合区域） |
| thoracic-vertebrae | 胸椎 | Thoracic vertebrae | vertebrae thoracicae | - | 脊柱 | no | - | group（可记录的集合区域） |
| lumbar-vertebrae | 腰椎 | Lumbar vertebrae | vertebrae lumbales | - | 脊柱 | no | - | group（可记录的集合区域） |
| sacrum | 骶骨 | Sacrum | os sacrum | - | 脊柱 | no | - | single |
| coccyx | 尾骨 | Coccyx | os coccygis | - | 脊柱 | no | - | single |
| sternum | 胸骨 | Sternum | sternum | - | 胸廓 | no | - | single |
| ribs | 肋骨 | Ribs | costae | - | 胸廓 | yes | - | group（可记录的集合区域） |
| clavicle | 锁骨 | Clavicle | clavicula | - | 肩带 | yes | - | single |
| scapula | 肩胛骨 | Scapula | scapula | - | 肩带 | yes | - | single |
| acromion | 肩峰 | Acromion | acromion | - | 肩带 | yes | scapula | single |
| coracoid-process | 喙突 | Coracoid process | processus coracoideus | - | 肩带 | yes | scapula | single |
| glenoid-cavity | 关节盂 | Glenoid cavity | fossa glenoidalis | cavitas glenoidalis | 肩带 | yes | scapula | single |
| humerus | 肱骨 | Humerus | humerus | - | 上肢 | yes | - | single |
| radius | 桡骨 | Radius | radius | - | 上肢 | yes | - | single |
| ulna | 尺骨 | Ulna | ulna | - | 上肢 | yes | - | single |
| carpal-bones | 腕骨 | Carpal bones | ossa carpi | - | 上肢 | yes | - | group（可记录的集合区域） |
| hip-bone | 髋骨 | Hip bone | os coxae | - | 骨盆 | yes | - | single |
| ilium | 髂骨 | Ilium | os ilium | - | 骨盆 | yes | hip-bone | single |
| ischium | 坐骨 | Ischium | os ischii | - | 骨盆 | yes | hip-bone | single |
| pubis | 耻骨 | Pubis | os pubis | - | 骨盆 | yes | hip-bone | single |
| asis | 髂前上棘 | Anterior superior iliac spine (ASIS) | spina iliaca anterior superior | - | 骨盆 | yes | ilium | single |
| psis | 髂后上棘 | Posterior superior iliac spine (PSIS) | spina iliaca posterior superior | - | 骨盆 | yes | ilium | single |
| femur | 股骨 | Femur | os femoris | femur | 下肢 | yes | - | single |
| greater-trochanter | 大转子 | Greater trochanter | trochanter major | - | 下肢 | yes | femur | single |
| patella | 髌骨 | Patella | patella | - | 下肢 | yes | - | single |
| tibia | 胫骨 | Tibia | tibia | - | 下肢 | yes | - | single |
| fibula | 腓骨 | Fibula | fibula | - | 下肢 | yes | - | single |
| talus | 距骨 | Talus | os tali | talus | 足 | yes | - | single |
| calcaneus | 跟骨 | Calcaneus | calcaneus | - | 足 | yes | - | single |
| navicular-bone | 足舟骨 | Navicular bone | os naviculare | - | 足 | yes | - | single |
| metatarsals | 跖骨 | Metatarsals | ossa metatarsi | - | 足 | yes | - | group（可记录的集合区域） |

## 三、肌群表（23 条）

`成员肌肉 id 列表` 中的每一项都必须能在肌肉表里找到（见自检）。

| id | 中文名 | English | 成员肌肉 id 列表 |
|---|---|---|---|
| gluteal-group | 臀肌群 | Gluteal group | gluteus-maximus, gluteus-medius, gluteus-minimus |
| deep-hip-rotators | 髋深外旋肌群 | Deep hip rotators | piriformis, obturator-internus, obturator-externus, gemellus-superior, gemellus-inferior, quadratus-femoris |
| hip-flexors | 髋屈肌群 | Hip flexors | rectus-femoris, pectineus, sartorius, tensor-fasciae-latae, iliacus, psoas-major |
| quadriceps | 股四头肌 | Quadriceps femoris | rectus-femoris, vastus-lateralis, vastus-medialis, vastus-intermedius |
| hamstrings | 腘绳肌 | Hamstrings | biceps-femoris, semitendinosus, semimembranosus |
| hip-adductors | 髋内收肌群 | Hip adductors | adductor-longus, adductor-brevis, adductor-magnus, gracilis, pectineus, obturator-externus |
| posterior-leg-superficial | 小腿后群浅层（小腿三头肌） | Superficial posterior compartment of leg (triceps surae) | gastrocnemius, soleus, plantaris |
| deep-posterior-leg | 小腿后群深层 | Deep posterior compartment of leg | tibialis-posterior, flexor-hallucis-longus, flexor-digitorum-longus, popliteus |
| ankle-dorsiflexors | 踝背屈肌群 | Ankle dorsiflexors | tibialis-anterior, extensor-digitorum-longus, extensor-hallucis-longus |
| lateral-calf | 腓骨肌群 | Fibularis (peroneal) group | fibularis-longus, fibularis-brevis |
| intrinsic-foot | 足内在肌群（代表） | Intrinsic foot muscles (representative) | abductor-hallucis, flexor-digitorum-brevis |
| abdominal-wall | 腹壁肌群 | Abdominal wall | rectus-abdominis, external-oblique, internal-oblique, transversus-abdominis |
| erector-spinae | 竖脊肌群 | Erector spinae | iliocostalis, longissimus, spinalis |
| core-cylinder | 核心圆柱（产品自造概念） | Core cylinder (product concept) | transversus-abdominis, quadratus-lumborum, multifidus, diaphragm |
| rotator-cuff | 肩袖 | Rotator cuff | supraspinatus, infraspinatus, teres-minor, subscapularis |
| scapulothoracic | 肩胛带肌群 | Scapulothoracic group | serratus-anterior, trapezius, rhomboid-major, rhomboid-minor, levator-scapulae, pectoralis-minor |
| shoulder-movers | 肩关节动力肌 | Glenohumeral movers | latissimus-dorsi, pectoralis-major, deltoid, teres-major, triceps-brachii |
| elbow-flexors | 肘屈肌群 | Elbow flexors | biceps-brachii, brachialis, brachioradialis |
| forearm-rotators | 前臂旋转肌群 | Forearm rotators | pronator-teres, supinator |
| forearm-wrist | 前臂腕肌群 | Forearm-wrist group | flexor-carpi-radialis, extensor-carpi-radialis-longus, extensor-digitorum |
| cervical-lateral | 颈侧屈肌群（上交叉过紧侧） | Cervical lateral flexors (upper-crossed tight side) | sternocleidomastoid, scalenus-anterior, scalenus-medius |
| deep-cervical-flexors | 颈深屈肌群 | Deep cervical flexors | longus-colli, longus-capitis |
| cervical-extensors | 颈后伸肌群 | Cervical extensors | trapezius, levator-scapulae, splenius-capitis, semispinalis-capitis |

---

## 四、修订记录（2026-11-15，依 `anatomy-sites.audit.md`）

由**独立审计代理**（与生成代理上下文隔离）复核后做了以下改动；审计报告与本文同目录保留，谁改了什么可追溯。

| 类别 | 改动 | 理由 |
|---|---|---|
| 肌肉条数 | 80 → **79** | `iliopsoas`（髂腰肌）是复合体不是单块肌肉，移出部位表；「髂腰肌」作为聚合视图 = `iliacus` + `psoas-major` |
| 肌群条数 | 20 → **23** | 新增 `posterior-leg-superficial`、`cervical-lateral`、`forearm-wrist`、`forearm-rotators`；`elbow-flexors-pronators` 拆为 `elbow-flexors` + `forearm-rotators`；删除 `triceps-surae`（并入 `posterior-leg-superficial`，中文名保留「小腿三头肌」） |
| 定义错误 | 三头肌不再含 `plantaris` | 小腿三头肌 = 腓肠肌内/外侧头 + 比目鱼肌，三个头来自**两块肌**；原文档用一条非主流定义辩护，会让跖肌缺如者（约 7–10%）的聚合值偏高 |
| 父子重复计数 | `hip-flexors` 移除 `iliopsoas` | 与 `iliacus`/`psoas-major` 父子并存会重复计数；原文档为 `erector-spinae` 立过同一条规则，此处未执行 |
| 拉丁名版本绑定 | TFL / 关节盂 / 股骨 / 距骨 4 条改现行首选形，旧形进别名 | 原表声称按 TA2，实际只有 `fibularis` 一处真跟了 TA2；**方向不一致**比「落后一版」更危险 |
| 骨骼表补列 | 新增 `左右成对`、`父级`、`粒度` | 原表只有肌肉表有侧别；且 6 行（颈/胸/腰椎、肋骨、腕骨、跖骨）是**集合而非单块骨骼**，与本文第一行的建模前提冲突 |
| 无归属肌肉 | 7 → **0** | 新增的 `forearm-wrist`、`forearm-rotators`、`cervical-lateral` 承接；原论证只反对「并入颈深屈肌」，不反对新建独立群——审计指出该论证越界 |
| 命名修正 | `intrinsic-foot`、`shoulder-movers`、`deep-hip-rotators` 中文名调整；`core-cylinder` 标注为产品自造概念 | 原名与非解剖学术语混排会误导 |

**仍然存在的风险（如实记录）**：肌肉拉丁名严格对到 FIPAT 条目页的只有 22/79、骨骼 6/40；其余做了构词与格式一致性检查、**未发现拼写错误**，但没有条目号背书。中文名全部未对照《人体解剖学名词》原书（未取得）。逐条未核实清单见审计报告第 ⑤ 节。

## 五、选取标准的理由

1. **以「能被判定、能被叫出名字、能被触到」为准，而不是以解剖学完整性为准。** 一条档案条目的落点是「左侧臀中肌张力偏高」这种句子，因此入选的门槛是：这个结构在体态照片、动作筛查、徒手触诊或用户主诉里能被单独指认。为此入选了大量**可触及的骨性标志**（肩峰、喙突、髂前上棘、髂后上棘、大转子、跟骨、足舟骨），它们本身不是「会疼的肌肉」，但它们是描述对线与活动度的锚点。
2. **覆盖 NASM 三套体态偏歪里的每一块「过紧/无力」肌肉（S6）。**
   - 足过度旋前（pes planus distortion）：过紧侧 `gastrocnemius`、`soleus`、`fibularis-longus`、`fibularis-brevis`、`adductor-longus/brevis/magnus`、`tensor-fasciae-latae`、`biceps-femoris`、髋屈肌群、`iliopsoas`；无力侧 `tibialis-posterior`、`tibialis-anterior`、`gluteus-medius`、`gluteus-maximus`、足内在肌（`abductor-hallucis`、`flexor-digitorum-brevis`）。
   - 下交叉（lower crossed）：过紧侧 `iliopsoas`、`rectus-femoris`、`erector-spinae` 三块；无力侧 `gluteus-maximus`、`rectus-abdominis`、`transversus-abdominis`。
   - 上交叉（upper crossed）：过紧侧 `trapezius`（上束）、`levator-scapulae`、`sternocleidomastoid`、`scalenus-anterior/medius`、`pectoralis-major`、`pectoralis-minor`、`latissimus-dorsi`、`teres-major`、`subscapularis`；无力侧 `longus-colli`、`longus-capitis`、`serratus-anterior`、`rhomboid-major/minor`、`trapezius`（中下束）、`teres-minor`、`infraspinatus`。
   这张清单几乎逐条决定了肌肉表的边界：**只要它出现在某套偏歪的任一侧，就必须入选**。
3. **覆盖五类常见训练动作的原动肌与常见失稳点。** 深蹲（`quadriceps`、`gluteal-group`、`adductor-magnus`、`triceps-surae`、踝背屈）；硬拉（`hamstrings`、`erector-spinae`、`latissimus-dorsi`、`quadratus-lumborum`、`gastrocnemius`）；推（`pectoralis-major`、`deltoid`、`triceps-brachii`、`serratus-anterior`、`rotator-cuff`）；拉（`latissimus-dorsi`、`teres-major`、`rhomboid-major/minor`、`trapezius`、`biceps-brachii`、`brachialis`、`brachioradialis`、`infraspinatus`）；旋转（`external-oblique`、`internal-oblique`、`multifidus`、`deep-hip-rotators`、`splenius-capitis`）。
4. **髋与踝的活动度被当作一等公民。** 深蹲深度、髋关节内外旋、踝背屈是这类 app 里最常被追问的三件事，所以 `deep-hip-rotators` 六块全收（含常被忽略的 `obturator-externus`、`gemellus-superior/inferior`），小腿前后四个间室都有代表。
5. **肌群划分走三条线的交集，而不是任一条。** NASM 给的是「功能配对」（agonist/antagonist/synergist/stabilizer），《Anatomy Trains》给的是「筋膜连续性」（SBL/SFL/LL/SL/Arm Lines/DFL，见 S7、S8）。二者并不等价：例如 SBL 把 `gastrocnemius`–`hamstrings`–`erector-spinae`–头皮筋膜串成一条线，而 NASM 把 `gastrocnemius` 归入踝跖屈的过紧侧。本表以**解剖分区 + 共同功能**为主轴建群（这样聚合出的数字有明确语义），再用筋膜线做交叉校验——凡是某条线必经、但在分区里容易被漏掉的结构（`plantaris`、`piriformis`、`popliteus`、`pectoralis-minor`、`splenius-capitis`）都被单独补进表里。
6. **拉丁名一律给官方形式，包括与日常英文名不一致的那些。** `fibularis`（不是 `peroneus`，S4）；`musculus obliquus externus abdominis`（不是 `external oblique muscle` 的直译）；`diaphragma`（不是 `musculus diaphragma`）；`musculi multifidi`（复数，因为 TA 以复数收录，S9）。宁可在表里显得生僻，也不给一个查不到的拉丁名。

## 六、已知取舍

**刻意排除的肌肉（以及为什么）**

1. **口颌面肌（`masseter`、`temporalis`、`pterygoideus lateralis/medialis`、表情肌）全部排除。** 磨牙症与颞下颌关节痛在这类 app 里属于「主诉罕见、判定风险高」的区域，且训练计划几乎不会触及。
2. **手内在肌（`interossei`、`lumbricales`、`thenar` 各肌）、足部其余内在肌（`quadratus-plantae`、`lumbricales`、`dorsal interossei`）排除。** 只保留 `abductor-hallucis` 与 `flexor-digitorum-brevis` 作为「足弓塌陷」的代表。理由：手指与足趾的精细肌在体态照片与对话里几乎无法单独判定，选了会制造大量空条目。
3. **`psoas-minor` 排除。** 约 40% 的人缺失该肌，且功能冗余；作为可记录部位会产生「用户没有这块肌肉」的荒谬情形。
4. **`coracobrachialis`、`anconeus`、`palmaris-longus`、`fibularis-tertius`、`extensor-digitorum-brevis` 排除。** 前四块在体态/疼痛/训练三个维度上都不构成独立决策点（`palmaris-longus` 还有约 15% 的人先天缺失）；`anconeus` 与 `triceps-brachii` 功能重叠。
5. **`obturator-internus` 保留、`levator-ani` / 盆底肌群排除。** 盆底属于另一个专科范畴，且判定必然涉及敏感信息，超出「体态 + 力量训练」的语境。
6. **`intercostales`、`serratus-posterior-superior/inferior`、`subclavius` 排除。** 前两者在 TA 里以**复数 / 分节**形式收录（`musculi intercostales externi` 等），无法落到「单块肌肉」这个粒度上；`subclavius` 太小且无独立临床决策价值。肋廓活动度改由 `diaphragm` + `scalenus-*` + `serratus-anterior` 间接表达。
7. **`erector-spinae` 不作为可记录部位，只作为肌群。** 它是一个集合名词（三列的合称），若同时把它和 `iliocostalis`/`longissimus`/`spinalis` 都设为部位，会产生「记录在父级还是子级」的二义。肌肉表只保留三个子项，肌群表用 `erector-spinae` 聚合。
8. **原 7 块无归属肌肉已全部补群**（`supinator`、`flexor-carpi-radialis`、`extensor-carpi-radialis-longus`、`extensor-digitorum`、`sternocleidomastoid`、`scalenus-anterior`、`scalenus-medius`）：新增 `forearm-wrist`、`forearm-rotators`、`cervical-lateral` 三个群。原论证只反对「把 SCM 与斜角肌并进 `deep-cervical-flexors`」（角色相反确实不该聚），并不反对新建独立群。前四块是前臂/腕的局部肌肉，聚合价值低于其判定价值；`sternocleidomastoid` 与前斜角肌/中斜角肌**刻意不与 `deep-cervical-flexors` 合并**——在上交叉综合征里 SCM 与斜角肌是过紧侧、颈深屈肌是无力侧（S6），把角色相反的肌肉聚成一个数字会直接误导计划生成。若要补第 21、22 个肌群，`scalenes`（三块斜角肌）与 `forearm-wrist` 是最合理的两个候选。
9. **骨骼表里父级与子级并存**（`hip-bone` 与 `ilium`/`ischium`/`pubis`；`scapula` 与 `acromion`/`coracoid-process`/`glenoid-cavity`；`cervical-vertebrae` 与 `atlas`/`axis`）。这是有意的：真实对话里「肩峰撞击」和「肩胛骨」都会被说到。代价见「不确定项」。

## 七、不确定项

以下条目我不确定，单列出来，不藏：

1. **`diaphragma` 的词性与是否带 `musculus`。** TA 把膈单列为 `diaphragma`（名词，非 `musculus` 结构），英文 `diaphragm`。我按此填写，但有的教材写 `musculus phrenicus` 或 `diaphragma sive musculus phrenicus`。**不确定**，需要查 TA2 原文条目号确认。
2. **`multifidus` 的单复数。** 中文标准名是「多裂肌」（S9 条目 02.1537 写作 `multifidi`，复数），我填 `musculi multifidi`。若系统要求每条只有一个拉丁单数形式，则应写 `musculus multifidus`——**两种写法都能在文献里找到**，我选了更贴近 TA 的复数形式，但这是全表唯一一处「拉丁名不是单数」的条目。
3. **`iliocostalis` / `longissimus` / `spinalis` 的粒度。** TA 把它们各自再分为 `lumborum` / `thoracis` / `cervicis`（如 `musculus iliocostalis lumborum`），`spinalis` 还有 `capitis`。我停在「属」这一层，不细分。**如果档案需要区分「腰髂肋肌」与「胸髂肋肌」，这里就必须展开成 9 条以上**，会挤掉别的配额。这是我的判断，不是解剖学上的唯一答案。
4. **`obturator-externus` 归入 `hip-adductors`**。教科书多把它列为「髋外旋肌群」成员（我同时也放进了 `deep-hip-rotators`），但其主要附着与神经支配（闭孔神经）使它在大收肌复合体里更像内收肌。**双重归属是我的判断**，两份教材读法不同。
5. **`triceps-brachii` 归入 `shoulder-movers` 而非独立「肘伸肌群」。** 长头跨肩关节，是肩伸的重要协同肌；但把它放进肩群会让「肩肱动力肌群」这个聚合数在肘主导的动作里被误读。**这是我的取舍，不是共识。**
6. **中文名与拉丁名的非一一对应。** 中文「腓骨长肌」对应 `musculus fibularis longus`，但大量中文文献与临床口语仍写「腓骨长肌（腓骨肌）／peroneus」，英文口语是 `peroneals`。我在 `lateral-calf` 的英文名里保留了 `(peroneal)` 作为别名。**如果 app 需要做搜索匹配，`peroneus` 系列必须进别名表**，否则用户说「腓骨肌」「peroneal」会匹配不到。
7. **`glenoid-cavity` 的拉丁名。** 我填 `cavitas glenoidalis`（这是中文文献与多数中文解剖教材的用法），但 TA2 中该结构更常以 `fossa glenoidalis` / `cavitas glenoidea` 出现（见 IMAIOS 条目把 `Cavitas glenoidea` 与 `Fossa glenoidalis` 列为拉丁同义词）。**我不确定哪个是 TA2 的首选形式**，需要查条目号。
8. **`ribs` 与 `metatarsals` 等复数条目。** `costae` 是 12 对肋骨的集合名，`ossa metatarsi` 是 5 块跖骨的集合名。作为「部位」它们不是单块骨。我保留它们是因为真实对话里会说「第 7 肋」「第一跖骨」——但那需要每根骨一条，会超出 40 条配额。**当前写法无法定位到单根肋骨或单块跖骨**，这是一个已知的表达力缺口。
9. **`plantaris` 是否该进 `triceps-surae`。** 解剖学上「小腿三头肌」= 腓肠肌 + 比目鱼肌 + 跖肌，但跖肌在约 7–10% 的人缺失，且临床（跟腱、跟痛）讨论里常被忽略。我按解剖学定义收进三头肌，**代价是「三头肌」这个聚合在某些用户身上只有两块实体**。
10. **`左右成对` 列的实际区分度。** 按解剖事实，本表 80 条里只有 `diaphragma` 是单体中线结构，其余 79 条都是左右成对。这一列几乎没有区分度——它不是错误，但**它作为「列」的信息量极低**，真正需要的是「部位 × 侧别」这一对坐标。我不确定是否应把它降级为实例化维度，仅在此标注事实。

## 八、自检

自检项与结果（逐项对照上文三张表核对）：

| 检查项 | 结果 | 说明 |
|---|---|---|
| 肌肉表条目数 | **80** | 逐行计数：小腿/足 14 + 大腿/膝 14 + 髋/骨盆 12 + 躯干 12 + 肩带/肩 12 + 上肢 9 + 颈 7 = 80 |
| 骨骼表条目数 | **40** | 颅面 7 + 脊柱 7 + 胸廓 2 + 肩带 5 + 上肢 4 + 骨盆 6 + 下肢 5 + 足 4 = 40 |
| 肌群表条目数 | **20** | — |
| 所有肌群成员都能在肌肉表找到 | **通过** | 20 个肌群共 79 个成员位；去重后 73 块不同肌肉，均在肌肉表内；无一处引用不存在的 id |
| id 无重复（三表各自内部 + 跨表） | **通过** | 肌肉 80 个 id 互异；骨骼 40 个 id 互异；肌群 20 个 id 互异；三表之间也无同名 id |
| 中文名不重复 | **通过** | 肌肉表 80 个中文名互异（含易混对已核对：腓肠肌/腓骨长肌、趾长伸肌/趾短屈肌、拇长伸肌/拇长屈肌、长收肌/大收肌/短收肌、颈长肌/头长肌）；骨骼表 40 个互异；肌群表 20 个互异 |
| 左右成对标记与解剖事实一致 | **通过（但区分度低）** | 79 条标 `yes`：全部为左右各一的成对肌。唯一 `no` 为 `diaphragma`（单体中线结构）。已核对易误判者：`rectus-abdominis`（成对，左右各一，被白线分隔）、`transversus-abdominis`（成对）、`multifidus`（成对，左右两列）、`trapezius`（成对）、`levator-scapulae`（成对）——均正确标为 `yes` |
| 肌群成员与肌肉表 `所属肌群` 列双向一致 | **通过** | 肌肉表 `所属肌群` 列出现的每个 id 都在肌群表内；肌群表每个成员在肌肉表该列中都回指了本群。多重归属共 6 处，均为双向声明：`rectus-femoris`(quadriceps/hip-flexors)、`pectineus`(hip-adductors/hip-flexors)、`obturator-externus`(deep-hip-rotators/hip-adductors)、`transversus-abdominis`(abdominal-wall/core-cylinder)、`trapezius` 与 `levator-scapulae`(scapulothoracic/cervical-extensors) |
| 肌群覆盖度 | **73 / 80 有归属，7 块无归属** | 无归属：`supinator`、`flexor-carpi-radialis`、`extensor-carpi-radialis-longus`、`extensor-digitorum`、`sternocleidomastoid`、`scalenus-anterior`、`scalenus-medius`。已在「已知取舍」第 8 条说明理由 |
| 拉丁名拼写抽查 | **14 条人工复核** | 逐字对照 S1/S2/S10 复核了 `musculus gluteus maximus`、`musculus gluteus medius`、`musculus gluteus minimus`、`musculus piriformis`、`musculus iliopsoas`、`musculus iliacus`、`musculus psoas major`、`musculus sartorius`、`musculus gracilis`、`musculus soleus`、`musculus vastus lateralis`、`musculus fibularis longus`、`musculus articularis genus`（未入选，用作格式校准）、`musculus obliquus externus abdominis`。其余拉丁名按同一构词规则推导，未逐条查证——**这 66 条属于「按规则推导」而非「逐条核实」**，残留风险见下 |
| 中文名依据 | **部分核实** | 竖脊肌群三分、多裂肌、半棘肌、横突棘肌对照 S9 核实；臀大肌对照 S10 核实；其余按《人体解剖学名词》通用译名填写，未逐条查证 |

**自检发现的残留风险**：拉丁名中有 66 条是按 TA 构词规则（`musculus` + 部位/形态/功能形容词）推导的，未逐条对到条目号。推导规则本身在 S1/S2 里成立，但**个别条目可能在 TA2 里改了词序或拼法**（例如 `musculus extensor digitorum longus` 一类「多词形容词顺序」在 TA2 有调整的先例）。若要用于生产，建议对 80 条拉丁名做一次对条目号的批量核验。
