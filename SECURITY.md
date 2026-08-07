# Security Policy

## Supported versions

Security fixes are provided for the latest version published under the npm `latest` tag. Pre-release
or older versions may be asked to upgrade before a fix is evaluated.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull request, or log.

Use GitHub's private vulnerability reporting through the repository's **Security → Report a
vulnerability** entry. Private reporting must be enabled before the first public release. If that
entry is unavailable, do not publish exploit details; wait for the repository owner to enable the
private channel.

Include only the information needed to reproduce and assess the report:

- affected version and platform;
- impact and prerequisites;
- minimal reproduction or proof of concept;
- whether credentials, repositories, hooks, or Gerrit review pushes are involved;
- suggested mitigation, when known.

Remove real credentials, private repository data, and identifiable production logs. Reports are
acknowledged and handled on a best-effort basis; this project does not promise a response SLA.

## Trust boundaries

The CLI executes local `git`, `ssh`, and `scp` programs with the current user's environment and
credentials. `gerrit setup` downloads Gerrit's official `commit-msg` hook from the configured Gerrit
SSH remote and can execute it during commits. Review target repositories, SSH configuration, hook
content, and local Git configuration are therefore trusted inputs controlled by the user or their
organization.

## 简体中文

请勿在公开 Issue、Discussion、Pull Request 或日志中披露疑似漏洞。

请使用仓库 **Security → Report a vulnerability** 提交私密报告；首次公开发布前必须启用 GitHub
私密漏洞报告。如果入口尚不可用，请不要公开利用细节，等待仓库所有者启用私密渠道。

报告应包含受影响版本与平台、影响与前置条件、最小复现，以及是否涉及凭据、仓库、hook 或 Gerrit
送审。请移除真实凭据、私有仓库数据和可识别的生产日志。本项目尽力处理报告，但不承诺响应 SLA。
