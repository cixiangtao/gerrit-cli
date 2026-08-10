# Contributing

English | [简体中文](#简体中文)

Thank you for helping improve `@anys/gerrit-cli`. Small, focused changes with reproducible evidence
are easiest to review.

## Before opening a change

1. Search existing issues and pull requests.
2. Open an issue first when a change alters command behavior, the JSON contract, Git history
   semantics, hook installation, or the release model.
3. Never include credentials, private Gerrit URLs, repository contents, or production logs that
   identify users or organizations.

## Development

Use Node.js 24 and the pinned pnpm version:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm verify:package
```

Add or update behavior-focused tests for code changes. Use temporary repositories and mocked process
boundaries; tests must not contact a real Gerrit server or push to a remote repository.

Before requesting review, run:

```bash
pnpm release:check
git diff --check
```

Keep commits focused on one durable intent. Generated `dist/` files and local package archives are
ignored and must not be committed.

## Pull requests

Describe the user-visible behavior, risk, and verification. Call out changes that can modify Git
history, hooks, remotes, or review pushes. A pull request should not publish npm packages, create
release tags, or change GitHub settings.

## 简体中文

感谢参与改进 `@anys/gerrit-cli`。请优先提交范围聚焦、证据可复现的改动。

1. 先搜索已有 Issue 和 Pull Request。
2. 如果改动命令行为、JSON 契约、Git 历史语义、hook 安装或发布模型，请先开 Issue 讨论。
3. 不要提交凭据、私有 Gerrit 地址、敏感仓库内容或能够识别用户和组织的生产日志。
4. 使用 Node.js 24 和项目固定的 pnpm，运行 `pnpm release:check` 与 `git diff --check`。
5. 代码改动应包含面向行为的测试；测试不得连接真实 Gerrit 服务器或推送远端仓库。
6. Pull Request 不应发布 npm、创建发布 tag 或修改 GitHub 远程设置。
