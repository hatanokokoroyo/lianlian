> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/scaffold-exercises/SKILL.md`
> 对应上游 hash：`019bbcc250992c77`
> 来源：`mattpocock/skills`

# 搭课程练习骨架（Scaffold Exercises）

创建能通过 `pnpm ai-hero-cli internal lint` 的练习目录结构，然后用 `git commit` 提交。

## 目录命名

- **小节（section）**：`exercises/` 下的 `XX-section-name/`（例如 `01-retrieval-skill-building`）
- **练习（exercise）**：小节内的 `XX.YY-exercise-name/`（例如 `01.03-retrieval-with-bm25`）
- 小节编号 = `XX`，练习编号 = `XX.YY`
- 名字用 dash-case（小写、连字符）

## 练习变体

每个练习至少需要下列子文件夹之一：

- `problem/` —— 学员工作区，带 TODO
- `solution/` —— 参考实现
- `explainer/` —— 概念材料，无 TODO

搭骨架时默认用 `explainer/`，除非计划另有说明。

## 必需文件

每个子文件夹（`problem/`、`solution/`、`explainer/`）都需要一个 `readme.md`，并且：

- **不能为空**（必须有真实内容，哪怕只有一行标题也算）
- 不能有坏链

搭骨架时，创建一份只含标题与描述的极简 readme：

```md
# Exercise Title

Description here
```

若子文件夹里有代码，还需要一个 `main.ts`（超过 1 行）。但对骨架来说，只有 readme 的练习也可以。

## 工作流

1. **解析计划** —— 抽出小节名、练习名与变体类型
2. **创建目录** —— 对每个路径 `mkdir -p`
3. **创建 readme 桩** —— 每个变体文件夹一份带标题的 `readme.md`
4. **跑 lint** —— `pnpm ai-hero-cli internal lint` 验证
5. **修掉报错** —— 迭代到 lint 通过

## Lint 规则摘要

linter（`pnpm ai-hero-cli internal lint`）检查：

- 每个练习都有子文件夹（`problem/`、`solution/`、`explainer/`）
- `problem/`、`explainer/`、`explainer.1/` 至少存在一个
- 主子文件夹里的 `readme.md` 存在且非空
- 没有 `.gitkeep` 文件
- 没有 `speaker-notes.md` 文件
- readme 里没有坏链
- readme 里没有 `pnpm run exercise` 命令
- 每个子文件夹都需要 `main.ts`，除非是只有 readme 的练习

## 移动/重命名练习

重编号或移动练习时：

1. 用 `git mv`（不是 `mv`）重命名目录 —— 保住 git 历史
2. 更新数字前缀以维持顺序
3. 移动后重跑 lint

示例：

```bash
git mv exercises/01-retrieval/01.03-embeddings exercises/01-retrieval/01.04-embeddings
```

## 示例：按计划搭骨架

给定这样一份计划：

```
Section 05: Memory Skill Building
- 05.01 Introduction to Memory
- 05.02 Short-term Memory (explainer + problem + solution)
- 05.03 Long-term Memory
```

创建：

```bash
mkdir -p exercises/05-memory-skill-building/05.01-introduction-to-memory/explainer
mkdir -p exercises/05-memory-skill-building/05.02-short-term-memory/{explainer,problem,solution}
mkdir -p exercises/05-memory-skill-building/05.03-long-term-memory/explainer
```

然后创建 readme 桩：

```
exercises/05-memory-skill-building/05.01-introduction-to-memory/explainer/readme.md -> "# Introduction to Memory"
exercises/05-memory-skill-building/05.02-short-term-memory/explainer/readme.md -> "# Short-term Memory"
exercises/05-memory-skill-building/05.02-short-term-memory/problem/readme.md -> "# Short-term Memory"
exercises/05-memory-skill-building/05.02-short-term-memory/solution/readme.md -> "# Short-term Memory"
exercises/05-memory-skill-building/05.03-long-term-memory/explainer/readme.md -> "# Long-term Memory"
```
