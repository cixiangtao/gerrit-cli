# Releasing

English | [简体中文](#简体中文)

GitHub Actions is the sole npm and GitHub Release publisher. Release Please automatically creates
or updates the release pull request; local commands never publish, create release tags, or bump the
public version manually.

## Release contract

| Concern        | Decision                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Version owner  | Root `package.json`; Release Please synchronizes `.release-please-manifest.json`                   |
| Version policy | Stable Semantic Versioning; versions below `1.0.0` may change public contracts                     |
| Release source | The exact merge commit of an automated release PR into protected `main`                            |
| Gate           | Required PR checks, release-only file allowlist, `pnpm release:check`, and package consumer checks |
| Notes          | Release Please-managed `CHANGELOG.md` plus GitHub-generated release notes                          |
| Git            | Actions creates annotated `v<version>` tags at the accepted release merge                          |
| Authority      | `.github/workflows/release.yml`; generic pushes cannot publish, and recovery re-proves the same PR |
| Delivery       | Public npm package and GitHub Release                                                              |
| Credentials    | GitHub App for release PRs; npm trusted publishing with GitHub Actions OIDC                        |
| Prereleases    | Not supported by the current workflow                                                              |
| Recovery       | Retry only after checking the PR merge, tag, npm integrity, provenance, and GitHub Release         |

## Normal flow

1. Merge ordinary changes into protected `main` through pull requests and required checks. Unrelated
   open pull requests may remain open.
2. Release Please creates or updates one PR from a
   `release-please--branches--main--...` branch. Conventional commit or squash-merge titles determine
   the proposed version and changelog (`fix` = patch, `feat` = minor, and `!` or
   `BREAKING CHANGE` = major).
3. Review the release-only diff, proposed version, `CHANGELOG.md`, checks, and approval, then manually
   merge that release PR when the version should be published.
4. The Release workflow revalidates that exact merge, packs and verifies one immutable artifact,
   creates `vX.Y.Z`, publishes through npm trusted publishing, and creates the matching GitHub
   Release.
5. Verify the tag target, GitHub Release, npm version and `latest`, provenance, public tarball, and a
   fresh `npx @anys/gerrit-cli@<version> --version` invocation.

Do not bump versions, create tags, dispatch a parallel publisher, or publish from a workstation.
Configuration, implementation, documentation, and dependency changes belong in ordinary PRs, not
the automated release PR. The Release workflow's manual input is only a recovery entry point for the
exact merge SHA of an already merged automated release PR on `main`; it runs the same admission gate
and Actions-owned publisher rather than creating a second publication path.

## Automation and recovery

The repository defines `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY` for the
`cixiangtao-release-controller` GitHub App. The App has Contents, Issues, and Pull requests
read/write permissions only for selected repositories, allowing release PR checks to start without
using a long-lived personal token.

The npm trusted publisher remains scoped to package `@anys/gerrit-cli`, repository
`cixiangtao/gerrit-cli`, workflow `release.yml`, environment `npm`, and the `npm publish` action.
The repository must not define an `NPM_TOKEN` secret.

If publication partially fails, inspect the merged release PR, workflow jobs, tag target, GitHub
Release, npm version, `latest`, integrity, and provenance first. After fixing the workflow through an
ordinary PR, dispatch **Release** from `main` with the exact merge SHA of the same automated release
PR. The gate rejects other commits, non-`main` refs, non-release diffs, and version inconsistencies.
Never reuse, delete, overwrite, or republish an existing version as recovery.

## 简体中文

GitHub Actions 是 npm 和 GitHub Release 的唯一正式发布者，Release Please 自动创建或更新发布
PR。本地命令不发布 npm、不创建发布 Tag，也不手动修改公开版本号。

1. 普通改动必须通过受保护 `main` 的 PR、必需检查和审核；无关的开放 PR 不会阻塞发版。
2. Release Please 根据 Conventional Commit 或 squash merge 标题维护唯一的发布 PR，并自动更新
   版本号和 `CHANGELOG.md`。
3. 确认版本、发布记录、检查和审批后，由维护者手动合并该发布 PR；这次合并就是正式发版开关。
4. Release 工作流验证该发布 PR 的准确身份和文件边界，然后打包一次、创建 `vX.Y.Z`、通过 npm
   Trusted Publishing 发布，并创建对应 GitHub Release。
5. 最后独立核对 Tag 指向、GitHub Release、npm 版本与 `latest`、provenance、公开包完整性和全新
   `npx` 调用。

不要在本地改版本、打发布 Tag、上传 npm，也不要保留可绕过发布 PR 的手动工作流入口。`Release`
的手动输入仅用于恢复已经合并的自动发布 PR：必须从 `main` 提供该 PR 的准确合并 SHA，并重新执行
同一套身份、文件和版本校验。失败重试前必须先核对 PR、工作流、Tag、GitHub Release 和 npm 的
实际状态。
