# @anys/gerrit-cli

`@anys/gerrit-cli` 是一个面向 Gerrit Code Review 的本地 Git 工作流 CLI，专注于 Change-Id hook、仓库检查、显式同步策略和 `refs/for/*` 送审。

> 这是非官方社区项目，与 Gerrit 项目不存在隶属或背书关系。

## 安装

无需长期安装即可直接运行：

```bash
npx @anys/gerrit-cli --help
```

也可以添加到项目：

```bash
pnpm add -D @anys/gerrit-cli
```

项目中可以保留简洁入口：

```json
{
  "scripts": {
    "gerrit": "gerrit",
    "review": "gerrit review"
  }
}
```

发布后的 CLI 要求 Node.js 18 或更高版本。

## 交互式命令菜单

在终端中不传参数运行 CLI，可以使用方向键选择命令并按 Enter 执行：

```bash
gerrit
# 或者无需安装直接运行：
npx @anys/gerrit-cli
```

每个选项都会说明用途及其读写影响。CI、管道等非 TTY 环境不会进入交互，而是显示帮助；自动化场景应继续使用显式命令和 `--json`。

人类可读输出会把对齐字段、就绪检查、跳过项、摘要和命令分成清晰区块。终端支持时，克制的 ANSI 颜色主要强调状态而不是字段名。设置 `NO_COLOR=1` 可以关闭颜色；JSON 永远不会包含 ANSI 转义序列，非 TTY 输出默认保持纯文本，除非显式强制开启颜色。

## 常用流程

```bash
pnpm gerrit --json doctor --offline
pnpm gerrit setup --dry-run
pnpm gerrit setup
pnpm gerrit status
pnpm review zhangsan,lisi --dry-run
pnpm review zhangsan,lisi
```

默认同步策略是 `ff-only`。分支发生分叉时，需要明确选择：

```bash
gerrit sync --sync-strategy merge
gerrit sync --sync-strategy rebase
```

CLI 不会为了绕过 Gerrit 的 `no new changes` 自动 amend，也不会自动制造 merge commit。

## 配置

仓库配置使用 `.gerrit-flow.json`，用户配置使用 `~/.config/gerrit-flow/config.json`。命令参数优先级最高。

```json
{
  "remote": "origin",
  "targetBranch": "feat/onepiece",
  "syncStrategy": "merge",
  "webUrl": "https://gerrit.example.com",
  "reviewers": ["zhangsan"]
}
```

CLI 不保存密码或 Token；Git、SCP 和 SSH 继续使用机器已有的 SSH 配置与凭据。

完整命令、JSON 契约、安全模型和开发说明见[英文主文档](../README.md)。
