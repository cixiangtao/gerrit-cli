## Summary / 概要

Describe the user-visible change and why it is needed. / 说明用户可见改动及原因。

## Risk / 风险

Call out effects on Git history, hooks, remotes, review pushes, JSON output, packaging, or releases.
说明对 Git 历史、hook、remote、送审、JSON、打包或发布的影响。

## Verification / 验证

- [ ] Tests cover changed behavior when applicable. / 必要时已补充行为测试。
- [ ] `pnpm check`
- [ ] `pnpm verify:package` when packaging or CLI startup is affected. / 影响打包或 CLI 启动时执行。
- [ ] No credentials or private repository data are included. / 未包含凭据或私有仓库数据。
- [ ] This pull request does not publish npm or create a release tag. / 本 PR 不发布 npm、不创建发布 tag。
