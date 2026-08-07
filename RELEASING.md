# Releasing

GitHub Actions is the sole formal publisher for npm and GitHub Releases. Local commands validate and
prepare a version change; they do not publish a package or create a release tag.

## Release contract

| Concern        | Decision                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Version owner  | Root `package.json`; the CLI reads it at runtime                                                  |
| Version policy | Semantic Versioning; versions below `1.0.0` may change public contracts                           |
| Release source | Current protected `main` commit                                                                   |
| Gate           | Required pull request checks plus a clean `pnpm release:check` in the release workflow            |
| Notes          | GitHub-generated release notes                                                                    |
| Git            | Actions creates annotated `v<version>` tags                                                       |
| Authority      | Manual dispatch of `.github/workflows/release.yml` from `main`                                    |
| Delivery       | Public npm package and GitHub Release                                                             |
| Credentials    | npm trusted publishing with GitHub Actions OIDC only                                              |
| Prereleases    | Not supported by the current workflow                                                             |
| Recovery       | Reruns accept only an existing tag at the same commit and an npm artifact with matching integrity |

## Prepare a release

1. Ensure product changes are merged into `main` through reviewed pull requests and required checks.
2. Create a release pull request from the current `main` head that changes only the version in
   `package.json`, the lockfile if required, release documentation, and intentional generated release
   metadata.
3. Run `pnpm release:check` and review the packed artifact summary.
4. Merge the release pull request after its required checks and reviews pass.
5. From the Actions tab, run **Release** on `main` and enter the exact manifest version without the
   `v` prefix.
6. Verify the workflow, `v<version>` tag, GitHub Release, npm version, npm `latest` tag, provenance,
   downloaded package integrity, and a fresh `npx @anys/gerrit-cli@<version> --version` invocation.

Before the first release, the repository owner must:

- create the public GitHub repository and push `main`;
- set the GitHub About description, topics, Issues availability, and default branch to match the
  package metadata and documentation;
- protect `main` with pull requests and the required checks `Quality (Node 22.14.0)`,
  `Quality (Node 24)`, `Package and consumer contract`, `Analyze JavaScript and TypeScript`, and
  `Dependency review`;
- enable private vulnerability reporting, dependency graph, Dependabot alerts and security updates,
  secret scanning, and push protection where available;
- configure the npm trusted publisher for package `@anys/gerrit-cli`, repository
  `cixiangtao/gerrit-cli`, workflow `release.yml`, and environment `npm`;
- create and, if desired, protect the GitHub `npm` environment.

The initial package bootstrap is complete. The repository must not define an `NPM_TOKEN` secret;
all future npm publications authenticate through the configured OIDC trusted publisher. npm package
settings require 2FA and disallow bypass-2FA tokens.

After the first successful release, evaluate a `v*` tag ruleset that permits the release workflow
to create immutable tags while preventing manual deletion or retargeting. Do not rely on that rule
until its actual bypass and workflow behavior have been tested remotely.

The repository configuration is not proof of publication. A release is complete only after every
named remote and public surface has been independently checked.

## 简体中文

GitHub Actions 是 npm 和 GitHub Release 的唯一正式发布者。本地命令只验证并准备版本改动，不发布
npm，也不创建发布 tag。

1. 所有产品改动必须通过受保护 `main` 的 Pull Request 和必需检查。
2. 从最新 `main` 创建发布 PR，只修改 `package.json` 版本、必要的 lockfile、发布文档和明确的发布元数据。
3. 运行 `pnpm release:check`，检查真实 npm 包验证结果。
4. 必需检查和审核通过后合并发布 PR。
5. 在 Actions 中从 `main` 手动运行 **Release**，输入不带 `v` 的准确版本。
6. 独立核对 workflow、tag、GitHub Release、npm 版本与 `latest`、provenance、公开包完整性和全新 `npx`。

首次发布前，仓库所有者还必须建立公开仓库与 `origin`、保护 `main`、开启私密漏洞报告和安全功能，
同步 GitHub About/Topics/Issues，并为 `@anys/gerrit-cli` 配置 workflow=`release.yml`、
environment=`npm` 的 npm trusted publisher。首次发布成功后，可以再评估只允许发布工作流创建、且禁止
手动删除或改指向的 `v*` tag ruleset；远程行为验证前不要依赖该规则。

首版引导已经完成。仓库不得再配置 `NPM_TOKEN` secret；后续 npm 发布必须使用已配置的 OIDC trusted
publisher。npm 包设置已要求 2FA 并禁止 bypass-2FA Token。
