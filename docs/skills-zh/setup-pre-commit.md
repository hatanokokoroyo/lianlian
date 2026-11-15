> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/setup-pre-commit/SKILL.md`
> 对应上游 hash：`98523a8db5977c41`
> 来源：`mattpocock/skills`

# 配置 pre-commit hooks（setup-pre-commit）

## 会配置什么

- **Husky** 的 pre-commit hook
- **lint-staged** 对所有已暂存文件跑 Prettier
- **Prettier** 配置（若缺失）
- pre-commit hook 里的 **typecheck** 与 **test** 脚本

## 步骤

### 1. 探测包管理器

检查 `package-lock.json`（npm）、`pnpm-lock.yaml`（pnpm）、`yarn.lock`（yarn）、`bun.lockb`（bun）。哪个在就用哪个；不清楚时默认 npm。

### 2. 安装依赖

作为 devDependencies 安装：

```
husky lint-staged prettier
```

### 3. 初始化 Husky

```bash
npx husky init
```

这会创建 `.husky/` 目录，并在 package.json 里加上 `prepare: "husky"`。

### 4. 创建 `.husky/pre-commit`

写入下面的内容（Husky v9+ 不需要 shebang）：

```
npx lint-staged
npm run typecheck
npm run test
```

**按实际情况调整**：把 `npm` 换成探测到的包管理器。若 package.json 里没有 `typecheck` 或 `test` 脚本，就省掉对应行并告诉用户。

### 5. 创建 `.lintstagedrc`

```json
{
  "*": "prettier --ignore-unknown --write"
}
```

### 6. 创建 `.prettierrc`（若缺失）

只在没有任何 Prettier 配置时才创建。使用这些默认值：

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "es5",
  "semi": true,
  "arrowParens": "always"
}
```

### 7. 验证

- [ ] `.husky/pre-commit` 存在且可执行
- [ ] `.lintstagedrc` 存在
- [ ] package.json 的 `prepare` 脚本是 `"husky"`
- [ ] prettier 配置存在
- [ ] 跑 `npx lint-staged` 验证它能工作

### 8. 提交

把所有改动/新建的文件加入暂存区，用这条消息提交：`Add pre-commit hooks (husky + lint-staged + prettier)`

这次提交会穿过新建的 pre-commit hooks：是一次很好的冒烟测试，证明一切能跑。

## 备注

- Husky v9+ 的 hook 文件不需要 shebang
- `prettier --ignore-unknown` 会跳过 Prettier 解析不了的文件（图片等）
- pre-commit 先跑 lint-staged（快，只跑暂存文件），随后是完整的 typecheck 与测试
