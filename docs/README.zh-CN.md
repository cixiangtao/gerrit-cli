# @anys/gerrit-cli

一个面向 [Gerrit Code Review](https://www.gerritcodereview.com/) 的安全本地 Git 工作流 CLI。

`@anys/gerrit-cli` 专注于通用 Gerrit API 客户端通常没有覆盖的仓库侧流程：Change-Id hook
安装、本地诊断、显式同步策略以及安全的 `refs/for/*` 送审。

> 这是非官方社区项目，与 Gerrit 项目不存在隶属或背书关系。CLI 运行界面与 JSON 契约仅使用英文。

[English documentation](https://github.com/cixiangtao/gerrit-cli)

## 当前状态

项目正在准备首次公开发布。`1.0.0` 之前的版本可能继续调整命令和 JSON 契约。只有发布工作流完成且
npm registry 版本通过独立验证后，npm 包才算公开可安装。

## 为什么需要这个 CLI

Gerrit 送审不只是执行一条特殊的 `git push`。安全的本地流程还需要理解跟踪分支、保护本地历史、
在不覆盖其他 hook 管理器的前提下安装官方 `commit-msg` hook，并稳定构造送审 refspec。

这个 CLI 会把关键决策保持为显式行为：

- 诊断命令只读，并支持离线模式；
- 会修改状态的命令提供预览；
- 同步默认使用 `ff-only`，分叉时不会擅自选择解决方式；
- 实际送审默认要求交互确认，只有显式 `--yes` 才跳过；
- JSON 使用稳定 envelope，并且永远不包含 ANSI 转义序列；
- 子进程使用参数数组启动，不经过 shell。

## 环境要求

- Node.js 22.14 或更高版本
- Git
- 实际检查连接、下载 hook 和送审时，需要能够通过 SSH 访问目标 Gerrit 服务器

## 安装

无需长期安装即可运行：

```bash
npx @anys/gerrit-cli --help
```

也可以添加到项目：

```bash
pnpm add -D @anys/gerrit-cli
```

如果项目希望保留稳定的本地入口，可以添加：

```json
{
  "scripts": {
    "gerrit": "gerrit",
    "review": "gerrit review"
  }
}
```

## 交互式命令菜单

在终端中不传参数运行 CLI，可以使用方向键选择命令：

```bash
gerrit
# 或者无需安装：
npx @anys/gerrit-cli
```

每个选项都会说明用途及其读写影响。CI、管道等非 TTY 环境不会进入交互，而是显示帮助；自动化场景
应使用显式命令和 `--json`。

人类可读输出会把检查、摘要和命令分成清晰区块。设置 `NO_COLOR=1` 可以关闭颜色；JSON 输出永远
不会包含 ANSI 转义序列。

## 快速开始

```bash
# 只检查本地配置，不发起网络请求。
gerrit --json doctor --offline

# 预览并安装 Gerrit 官方 Change-Id hook。
gerrit setup --dry-run
gerrit setup

# 检查本地送审状态。
gerrit status

# 更新当前 Change，默认上传为新的 Patch Set。
git add src/example.ts
gerrit amend --dry-run
gerrit amend

# 自动更新 merge commit 正文并上传到同一 Change。
gerrit amend --merge-log --dry-run
gerrit amend --merge-log

# 通过菜单选择分支，或显式预览一次合并。
gerrit merge
gerrit merge feature/login --dry-run

# 先预览，再送审。
gerrit review zhangsan,lisi --dry-run
gerrit review zhangsan,lisi
```

## 命令

| 命令                             | 用途                                                 | 是否写入状态     |
| -------------------------------- | ---------------------------------------------------- | ---------------- |
| `doctor [--offline]`             | 检查 Git、仓库、hook、remote 和 SSH 就绪状态         | 否               |
| `status`                         | 验证 Gerrit remote，并显示项目主页、分支和 hook 状态 | 否               |
| `setup [--dry-run]`              | 下载并组合 Gerrit 官方 `commit-msg` hook             | 是               |
| `amend [--dry-run]`              | 更新提交并上传同一 Change 的新 Patch Set             | 是               |
| `merge [source] [--dry-run]`     | 以明确的 merge commit 合并来源分支                   | 是               |
| `sync [--dry-run]`               | 拉取并按显式策略同步目标分支                         | 是               |
| `review [reviewers] [--dry-run]` | 预检、按需同步并推送到 `refs/for/*`                  | 是               |
| `open [--print]`                 | 打开当前仓库对应的 Gerrit 项目主页                   | 打开浏览器       |
| `hook run <file>`                | 与 Husky 等其他 hook 管理器组合                      | 更新提交信息文件 |

使用 `gerrit <command> --help` 查看完整选项。

所有依赖 Gerrit 仓库上下文的业务命令都会先经过同一个离线门禁，再进行计划或写操作。门禁可自动
识别显式 Gerrit SSH 端口 `29418`；HTTPS、自定义 SSH 端口和 SCP-like remote 需要明确配置
`webUrl`。普通 GitHub/GitLab remote 会返回 `NOT_A_GERRIT_REPOSITORY`。`doctor` 会把识别结果
作为诊断项，并可继续验证真实 SSH 连通性；`hook run` 只执行已经安装的 Gerrit hook，不检查
remote。

## 更新现有 Change

修改代码后只暂存本次 Patch Set 应包含的文件，再运行 `gerrit amend`：

```bash
git add src/example.ts
gerrit amend --dry-run
gerrit amend
```

CLI 会检查 HEAD 已有 `Change-Id`、拒绝未暂存或未跟踪文件、用 `git commit --amend --no-edit`
保留原提交说明，并默认推送到同一目标分支，形成同一 Gerrit Change 的新 Patch Set。它不会自动
执行 `git add .`。只修改提交说明时使用 `gerrit amend --edit-message`；只在本地 amend 而不上传时
使用 `gerrit amend --no-review`。

如果 HEAD 是需要补全正文的两父 merge commit，使用：

```bash
gerrit amend --merge-log --dry-run
gerrit amend --merge-log
```

CLI 会按 `HEAD^1..HEAD^2` 自动计算本次合入的提交，将其短哈希和 subject 写入
`Included commits:` 正文，保留原 subject 与 `Change-Id`，然后默认上传为同一 Change 的新
Patch Set。该模式不需要先制造文件改动，也不能和手动编辑正文的 `--edit-message` 同时使用。

## 合并分支

在交互式终端中直接运行 `gerrit merge`，CLI 会先自动刷新远端，再询问来源分支，随后展示目标
分支、来源分支、双方独有提交、待合入提交和实际 Git 命令。真正修改历史前还会再次确认。该命令
固定使用 `git merge --no-ff --no-edit --log`，保证分支合入动作形成可审核的 merge commit，
并在 merge commit 正文中保留来源提交的一行摘要。

```bash
# 只预览，不 fetch、不修改历史。
gerrit merge feature/login --dry-run

# 默认刷新 origin 后创建合并提交。
gerrit merge origin/feature/login

# 离线或明确需要使用现有引用时跳过 fetch。
gerrit merge feature/login --no-fetch

# 创建并保留一个明确的合并提交。
gerrit merge feature/login

# 冲突解决并暂存后继续，或放弃本次合并。
gerrit merge --continue
gerrit merge --abort
```

`merge` 默认执行 `git fetch --prune <remote>`，不再询问是否刷新；`--dry-run` 只展示命令而不
fetch，`--no-fetch` 可明确使用现有引用。该命令不提供快进策略；同步目标分支请使用默认
`ff-only` 的 `gerrit sync`。非交互环境必须明确给出来源分支，并使用 `--yes` 跳过最终确认。

## 送审选项

```bash
gerrit review zhangsan,lisi
gerrit review -r zhangsan -r lisi --cc wangwu
gerrit review --topic feature-auth --wip
gerrit review --sync-strategy merge
gerrit review --no-sync
gerrit review --dry-run
```

默认同步策略是 `ff-only`。本地与远端历史发生分叉时，需要明确选择 `merge` 或 `rebase`。CLI 不会
为了绕过 Gerrit 的 `no new changes` 自动 amend，也不会制造合并提交。送审前如果发现 HEAD 已经
存在于其他远端跟踪分支，CLI 会在推送前停止，并提示重新从目标分支执行 `gerrit merge`。

## 配置

配置优先级如下：

1. 命令参数。
2. 仓库 `.gerrit-cli.json`。
3. 用户 `~/.config/gerrit-cli/config.json`。
4. Git 分支跟踪信息和安全默认值。

```json
{
  "remote": "origin",
  "targetBranch": "main",
  "syncStrategy": "ff-only",
  "webUrl": "https://gerrit.example.com",
  "reviewers": ["zhangsan"],
  "cc": ["team@example.com"]
}
```

CLI 不保存密码或 Token；Git、SCP 和 SSH 继续使用机器已有的配置与凭据。

## JSON 契约

把 `--json` 放在子命令之前，可以让 stdout 保持机器可读；进度和诊断信息写入 stderr。

成功结果：

```json
{
  "ok": true,
  "command": "status",
  "data": {}
}
```

错误结果包含稳定的错误码、消息和可操作提示：

```json
{
  "ok": false,
  "error": {
    "code": "DIRTY_WORKTREE",
    "message": "The working tree has uncommitted changes.",
    "hints": []
  }
}
```

## Codex skill

仓库在 [`skills/gerrit-cli`](../skills/gerrit-cli) 中提供配套 skill。它属于 GitHub 仓库产品，故意不
放入 npm 包。skill 会先检查本地 CLI 或公开 npm 版本是否可用，再建议执行实际命令。

## 开发

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm verify:package
pnpm release:check
```

`pnpm verify:package` 会在临时目录创建真实 npm 包，检查文件和可执行权限，把该包安装到全新消费
项目，并实际运行安装后的 CLI。

贡献说明见 [CONTRIBUTING](../CONTRIBUTING.md)，Actions-only 发布契约见
[RELEASING](../RELEASING.md)。

## 支持与安全

- 搜索已有报告后，使用 [GitHub Issues](https://github.com/cixiangtao/gerrit-cli/issues) 提交可复现
  Bug 或聚焦的功能建议。
- 使用边界见 [SUPPORT](../SUPPORT.md)。
- 不要在公开 Issue 中披露漏洞，安全报告方式见 [SECURITY](../SECURITY.md)。

## 许可证

[MIT](../LICENSE)
