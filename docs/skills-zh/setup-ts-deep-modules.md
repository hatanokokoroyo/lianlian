> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/setup-ts-deep-modules/SKILL.md`
> 对应上游 hash：`8a3136caaea8fa43`
> 来源：`mattpocock/skills`

# 搭建 TS 深模块（Setup TS Deep Modules）

让本仓库的每个包都成为**深模块（deep module）**：一个小的接口（interface）后面藏着大量行为。一个包的公开表面是它的**入口点（entry point）**（包根目录下的文件），子文件夹里的一切都是隐藏的。本技能安装 [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 以及「入口点是唯一入口」的规则，然后**证明规则真的会咬人**。

要做词汇（深模块（module）、接口、接缝（seam）、深度（depth）），调用 Skill 工具加载 "codebase-design"，并全程使用它的语言。

## 它强制的形状

```
src/packages/
  <name>/
    index.ts        ← 一个入口点（公开）。外部 import 它。
    client.ts       ← 另一个入口点。一个包可以暴露多个入口点。
    lib/            ← 实现：对外隐藏，内部可自由互相 import。
    tests/          ← 就近放置的测试 + fixture（是子文件夹，因此私有）。
```

公开表面是包的**根文件**，而不是被指定的那一个 `index.ts`。按约定实现放在 `lib/`、测试放在 `tests/`，让每个包都有同样的两文件夹形状。规则本身是通用的：**任何**子文件夹里的**任何东西**都是私有的，所以你永远不需要为新增文件夹去改配置。

四条规则，全部是 `error`：

1. **入口点边界**：包外的代码（应用代码或另一个包）只能 import 那个包的入口点（它的根文件），绝不能 import 它子文件夹里的任何东西。
2. **包内自由**：包自己的文件之间自由互相 import。
3. **通过入口点测试**：`<pkg>/tests/` 下的文件可以 import 任何包的入口点、以及自己 `tests/` 里的 fixture，但绝不能 import 任何包的子文件夹内部（连自己的也不行）。跨包的集成测试没问题；深 import 不行。
4. **无环**：不允许依赖环。

**入口点，不是 barrel。** 因为公开表面是**每一个**根文件，一个包可以暴露多个小入口点（`index.ts`、`client.ts`、`server.ts`），而不是把所有东西都挤进一个巨大的 `index.ts`。不鼓励用 barrel 文件把整棵子树重新导出；让入口点保持小，把实现藏在子文件夹里。

**分层**（哪些包可以依赖哪些包）是**另一件**事，在配置里留成一个注释掉的桩，由本仓库自己填。

## 步骤

### 1. 探测环境

- **包管理器**：`pnpm-lock.yaml` → pnpm，`yarn.lock` → yarn，`bun.lockb` → bun，否则 npm。下面每条命令都用它（`pnpm`/`yarn`/`npm run`/`bunx`）。
- **包根目录**：有 `src/` 就用 `src/packages`，否则用 `packages`。若仓库已有别的明显约定，与用户确认。
- **既有配置**：检查是否存在 `.dependency-cruiser.*`。若存在，**不要**覆盖它：把四条规则与相关选项合并进去，并告诉用户你加了什么。

**完成判据：** 包管理器、包根目录、既有配置状态（state）三者都已知。

### 2. 安装 dependency-cruiser

用探测到的包管理器把 `dependency-cruiser` 装成 devDependency。

**完成判据：** `devDependencies` 里有 `dependency-cruiser`。

### 3. 写配置

把 [`dependency-cruiser.config.cjs`](../../.agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs) 复制到仓库根目录，命名为 `.dependency-cruiser.cjs`。把 `PACKAGES_ROOT` 设为第 1 步探测到的根目录。规则基于路径深度、与扩展名无关，所以别的地方不用改。

**完成判据：** `.dependency-cruiser.cjs` 存在、`PACKAGES_ROOT` 正确、四条 forbidden 规则都在。

### 4. 接进检查流程

- 加一个 `lint:boundaries` 脚本：`depcruise <packages-root>`（或 `depcruise src`）。
- 把它并入仓库的总检查命令 —— 那个已经在跑 typecheck 的（例如 `check` / `ci` / `validate` 脚本）。**不要**动 `tsconfig`，不要加路径别名。
- 没有总检查脚本时，加 `lint:boundaries` 并告诉用户把它纳入 CI。

**完成判据：** `lint:boundaries` 存在，并与 typecheck 在同一条命令里运行。

### 5. 搭出示例包

创建一个**要提交**的 `<packages-root>/example/` 作为「照抄模板」：

- `index.ts` 是入口点，导出一个委托给内部文件的函数（让这个包肉眼可见地**深**，而不是转发层）。
- `lib/impl.ts`：**子文件夹**里的内部文件，被 `index.ts` import，外部够不到。
- `tests/example.test.ts` **只** import `../index`（入口点），并针对公开函数做断言。

告诉用户这是起始模板，可照抄也可删。

**完成判据：** 示例包存在，通过根入口点暴露行为，并把 `impl` 藏在子文件夹里。

### 6. 证明规则会咬人

这是整个技能的完成判据：一份在违规时不会失败的配置毫无价值。

1. 跑 `lint:boundaries`。必须**通过**（在干净的示例上）。
2. 临时往 `tests/example.test.ts` 里加一条深 import（例如 `import { thing } from "../lib/impl"`）。再跑 `lint:boundaries`，必须以 `tests-through-entrypoints` **失败**。
3. 撤回这条深 import。再跑一次，必须**通过**。

**完成判据：** 你亲眼看到「通过 → 深 import 后失败 → 撤回后又通过」。若第 2 步没有失败，规则没接对，修好再收工。

### 7. 记录约定

在**包文件夹里**写一份 `README.md`（`<packages-root>/README.md`，就在它所管辖的包旁边），内容覆盖：`src/packages/<name>/` 布局（入口点在根、`lib/` 放实现、`tests/` 放测试）、「只通过包的入口点（根文件）import」，以及怎么跑 `lint:boundaries`。**明确不鼓励 barrel 文件**：暴露多个小入口点，而不是通过一个 index 重新导出整棵子树。篇幅控制在「照抄片段 + 四条规则各一段」。

然后从仓库的 agent 指令文件（有 `CLAUDE.md` 用它，否则 `AGENTS.md`，两者都没有就创建 `AGENTS.md`）加一行**上下文指针**指向它。一行就够，例如 `Packages are deep modules: see [src/packages/README.md](./src/packages/README.md) before adding or importing one.` 正是这一行让 agent 发现边界规则，而不是一头撞上去。

**完成判据：** `<packages-root>/README.md` 存在且不鼓励 barrel，仓库的 `CLAUDE.md`/`AGENTS.md` 链接到它。

## 备注

- 配置里的 `$1` 反向引用（dependency-cruiser 的分组匹配）正是让一个包能到达自己内部、而外部不能的原因。不要把它们摊平成逐个包的独立规则。
- 公开与私有的界线由**深度**决定：包的根文件是入口点，子文件夹里的任何东西都是私有。约定俗成的子文件夹是 `lib/`（实现）与 `tests/`，但规则没有硬编码它们：任何子文件夹都是私有的，所以新增文件夹永不需要改配置。加一个入口点就是加一个根文件（不用 barrel）。
- 包是**扁平**的：根目录下一层直接子目录。包内部可以任意嵌套；包不能包含另一个包。
- 用 `.cjs`（不要 `.js`），这样即使仓库是 `"type": "module"`，配置里的 `module.exports` 也能工作。
