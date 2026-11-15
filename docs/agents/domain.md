# 领域文档（Domain Docs）

本文件说明：工程类 skill 在探索本仓库代码前，应当如何消费本仓库的领域文档。

## 探索前先读这些

- 仓库根目录的 **`GLOSSARY.md`**，或者
- 仓库根目录的 **`GLOSSARY-MAP.md`**（若存在）：它指向每个上下文各自的 `GLOSSARY.md`，把与当前主题相关的都读一遍。
- **`docs/adr/`**：读与你要动手的区域相关的 ADR。多上下文仓库还要检查 `src/<context>/docs/adr/` 里的上下文级决策。

以上文件若不存在，**静默继续**。不要提示缺失，也不要主动建议先创建它们。`/domain-modeling` skill（经由 `/grill-with-docs` 和 `/improve-codebase-architecture` 触达）会在术语或决策真正被确定时按需创建。

## 文件结构

本仓库是单上下文：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `GLOSSARY-MAP.md`）长这样 —— 除非重新运行 setup skill，否则不要在本仓库采用该结构：

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  ← 上下文级决策
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## 使用词表里的词汇

当你的产出需要命名一个领域概念时（issue 标题、重构提案、假设、测试名），使用 `GLOSSARY.md` 中定义的术语，不要漂移到词表明确规避的同义词。

如果你需要的概念还不在词表里，这是一个信号：要么你在发明项目并不使用的说法（重新考虑），要么确实存在缺口（记下来交给 `/domain-modeling`）。

## 标出 ADR 冲突

如果你的产出与既有 ADR 相矛盾，明确摆出来，不要静默覆盖：

> _与 ADR-0007（事件溯源订单）相矛盾，但仍值得重开，因为……_

## 关于 skill 可用性

本仓库目前只安装了 `setup-matt-pocock-skills`，因此上文提到的 `/domain-modeling`、`/grill-with-docs`、`/improve-codebase-architecture`、`/wayfinder`、`/triage`、`/to-spec`、`/to-tickets` 暂时还不能作为 `/skill:` 命令调用。本文件里的规则在手动完成、或由模型直接完成这些工作时依然成立；需要这些命令时再安装该合集。
