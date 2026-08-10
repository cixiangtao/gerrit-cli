# Support

English | [简体中文](#简体中文)

## Where to ask

- Use [GitHub Issues](https://github.com/cixiangtao/gerrit-cli/issues) for reproducible CLI bugs and
  focused feature requests.
- Use your Gerrit administrator or internal platform team for Gerrit permissions, SSH keys, network
  access, server plugins, and organization-specific review policy.
- Use [Gerrit documentation](https://www.gerritcodereview.com/) for server administration and core
  Gerrit behavior.
- Follow [SECURITY](SECURITY.md) for vulnerabilities; never report them publicly.

Before opening an issue, run `gerrit --json doctor --offline` and remove private URLs, usernames,
emails, branch names, repository names, credentials, and commit contents from the output. Include the
CLI version, Node.js version, operating system, minimal reproduction, expected result, and sanitized
actual result.

This is a community-maintained project without guaranteed response or resolution times.

## 简体中文

- 可复现的 CLI Bug 和聚焦的功能建议请提交到 GitHub Issues。
- Gerrit 权限、SSH key、网络访问、服务端插件和组织内部送审规则，请联系 Gerrit 管理员或内部平台团队。
- 漏洞请按照 [SECURITY](SECURITY.md) 私密报告，不要公开提交。

提交 Issue 前请运行 `gerrit --json doctor --offline`，并删除输出中的私有 URL、用户名、邮箱、分支名、
仓库名、凭据和提交内容。请提供 CLI/Node.js 版本、操作系统、最小复现、预期结果和脱敏后的实际结果。
本项目由社区维护，不承诺响应或解决时限。
