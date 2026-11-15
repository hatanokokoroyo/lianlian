> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/domain-modeling/SKILL.md`
> 对应上游 hash：`b78689833404148c`
> 来源：`mattpocock/skills`

# 领域建模（Domain Modeling）

在设计过程中主动地构建并磨利项目的领域模型。这是一门*主动*的功夫：挑战术语、发明边界场景、在词表（glossary）与决策一凝固的当下就写下来。（仅仅为了取词而*读* `GLOSSARY.md` 不算本技能：那是一行习惯，任何技能都能做。本技能用于你正在**改变**模型的时候，而不是只消费它。）

## 文件结构

大多数仓库是单上下文（single context）：

```
/
├── GLOSSARY.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

若根目录存在 `GLOSSARY-MAP.md`，该仓库有多个上下文。这张映射图指向每个上下文的所在：

```
/
├── GLOSSARY-MAP.md
├── docs/
│   └── adr/                          ← 系统级决策
├── src/
│   ├── ordering/
│   │   ├── GLOSSARY.md
│   │   └── docs/adr/                 ← 上下文级决策
│   └── billing/
│       ├── GLOSSARY.md
│       └── docs/adr/
```

**惰性创建文件**：只在真有东西可写时才建。没有 `GLOSSARY.md` 时，等第一个术语被敲定再建；没有 `docs/adr/` 时，等第一条 ADR 需要时再建。

## 会话过程中

### 对着词表挑战（challenge）

当用户使用的术语与 `GLOSSARY.md` 里的既有语言冲突时，立刻点出来。「你的词表把『取消』定义为 X，但你看起来在指 Y。到底是哪个？」

### 磨利模糊语言

当用户使用含糊或一词多义的术语时，提出一个精确的 canonical 术语。「你说『account』：你是指 Customer 还是 User？这是两个不同的东西。」

### 讨论具体场景

讨论领域关系时，用具体场景对它做压力测试。编造能探到边界情况的场景，逼用户对概念之间的边界精确表态。

### 与代码交叉核对

当用户陈述某件事如何运作时，检查代码是否同意。若发现矛盾，摆出来：「你的代码会取消整个 Order，但你刚说部分取消是可能的。哪个是对的？」

### 就地更新 GLOSSARY.md

一个术语被敲定时，就在当下更新 `GLOSSARY.md`。不要攒批：发生时就捕获。格式见 [GLOSSARY-FORMAT.md](../../.agents/skills/domain-modeling/GLOSSARY-FORMAT.md)。

`GLOSSARY.md` 应当完全不含实现细节。不要把 `GLOSSARY.md` 当作 spec、草稿纸，或实现决策的仓库。它就是一份词表，仅此而已。

### 克制地提议 ADR

只有在下面三条**同时**成立时才提议创建 ADR：

1. **难以逆转**：以后改主意的代价是有意义的
2. **脱离上下文会让人意外**：未来的读者会想「他们为什么这么做？」
3. **真实取舍的产物**：确实存在别的选项，而你出于具体理由选了这一个

三条缺一条就跳过 ADR。格式见 [ADR-FORMAT.md](../../.agents/skills/domain-modeling/ADR-FORMAT.md)。
