> 中文译本，仅供人阅读，**不具权威性**；以英文原文为准。
> 权威版本：`.agents/skills/git-guardrails-claude-code/SKILL.md`
> 对应上游 hash：`7aa92e9d469c6cd0`
> 来源：`mattpocock/skills`

# 配置 Git 护栏（git-guardrails-claude-code）

配置一个 PreToolUse hook，在 Claude 执行危险 git 命令之前拦截并阻止它们。

> 注：本技能写的是 **Claude Code** 的 hook 格式（`.claude/settings.json`）。在 pi 里没有等价的内置机制，可以参考同样思路改用扩展或全局 git hook；本文件只是原文的中文说明。

## 会被拦住什么

- `git push`（所有变体，含 `--force`）
- `git reset --hard`
- `git clean -f` / `git clean -fd`
- `git branch -D`
- `git checkout .` / `git restore .`

被拦时，Claude 会看到一条消息，告诉它无权使用这些命令。

## 步骤

### 1. 问范围

问用户：只为**本项目**装（`.claude/settings.json`），还是为**所有项目**装（`~/.claude/settings.json`）？

### 2. 复制 hook 脚本

随包提供的脚本在：[scripts/block-dangerous-git.sh](../../.agents/skills/git-guardrails-claude-code/scripts/block-dangerous-git.sh)

按范围复制到目标位置：

- **项目**：`.claude/hooks/block-dangerous-git.sh`
- **全局**：`~/.claude/hooks/block-dangerous-git.sh`

用 `chmod +x` 给它可执行权限。

### 3. 把 hook 写进 settings

加到相应的 settings 文件：

**项目**（`.claude/settings.json`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-dangerous-git.sh"
          }
        ]
      }
    ]
  }
}
```

**全局**（`~/.claude/settings.json`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/block-dangerous-git.sh"
          }
        ]
      }
    ]
  }
}
```

settings 文件已存在时，把 hook 合并进既有的 `hooks.PreToolUse` 数组。不要覆盖其他设置。

### 4. 问要不要定制

问用户是否要往黑名单里加或减模式。据此修改复制过去的那份脚本。

### 5. 验证

跑一次快速测试：

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | <path-to-script>
```

应当以退出码 2 结束，并向 stderr 打印一条 BLOCKED 消息。
