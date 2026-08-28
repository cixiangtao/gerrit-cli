# @anys/gerrit-cli

English | [简体中文](../docs/README.zh-CN.md)

A safe local Git workflow CLI for [Gerrit Code Review](https://www.gerritcodereview.com/).

`@anys/gerrit-cli` covers the repository-side workflow that generic Gerrit API clients usually do
not: Change-Id hook setup, local diagnostics, explicit synchronization, and safe `refs/for/*`
review pushes.

> Unofficial community project. It is not affiliated with or endorsed by the Gerrit project.

## Status

The project is available as a public npm package. Versions below `1.0.0` may refine command and
JSON contracts. Each version becomes publicly installable only after the release workflow has
completed and the registry version has been verified.

## Why this CLI

Gerrit review submission is more than a custom `git push`. A safe local workflow needs to understand
the tracked target branch, protect local history, install the official `commit-msg` hook without
overwriting other hook managers, and construct review refspecs predictably.

This CLI keeps those decisions visible:

- diagnostics are read-only and support offline mode;
- state-changing commands provide previews;
- synchronization defaults to `ff-only` and never guesses how to resolve divergence;
- live review pushes require confirmation unless `--yes` is explicit;
- branch integration always creates an explicit merge commit with an included-commit log;
- existing Gerrit Changes can be amended and uploaded as a new Patch Set without changing Change-Id;
- JSON output has a stable envelope and never contains ANSI sequences;
- child processes use argument arrays rather than a shell.

## Requirements

- Node.js 14.17 or newer (Node.js 14 and 16 are legacy compatibility targets; prefer a maintained
  release when the host project allows it)
- Git
- SSH access to the target Gerrit server for live connectivity, hook download, and review pushes

## Install

Run the CLI without a permanent install:

```bash
npx @anys/gerrit-cli --help
```

Or add it to a project:

```bash
pnpm add -D @anys/gerrit-cli
```

Add convenient scripts when the project wants stable local entry points:

```json
{
  "scripts": {
    "gerrit": "gerrit",
    "review": "gerrit review"
  }
}
```

## Interactive command menu

Run the CLI without arguments in a terminal to choose a command with the arrow keys:

```bash
gerrit
# Or without installing it:
npx @anys/gerrit-cli
```

Each option describes its purpose and whether it writes state. Bare invocations outside a TTY show
help instead, so CI and piped commands never wait for interactive input. Automation should use
explicit commands and `--json`.

Human-readable output groups checks, summaries, and commands into distinct sections. Set
`NO_COLOR=1` to disable color. JSON output never contains ANSI sequences.

## Quick start

```bash
# First use can prompt for and save the Gerrit base URL.
gerrit clone team/app --dry-run
gerrit clone team/app

# Inspect local configuration without making a network request.
gerrit --json doctor --offline

# Preview and install the official Gerrit Change-Id hook.
gerrit setup --dry-run
gerrit setup

# Inspect local review state.
gerrit status

# Amend staged changes and upload a new Patch Set for the same Gerrit Change.
git add src/example.ts
gerrit amend --dry-run
gerrit amend

# Create a reviewable merge commit from a feature branch.
gerrit merge feature/login --dry-run
gerrit merge feature/login

# Preview, then submit a review.
gerrit review alice,bob --dry-run
gerrit review alice,bob
```

## Commands

| Command                          | Purpose                                                                      | Writes state               |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| `doctor [--offline]`             | Check Git, repository, hook, remote, and SSH readiness                       | No                         |
| `status`                         | Show local branch, upstream, ahead/behind, outgoing commits, and hook status | No                         |
| `setup [--dry-run]`              | Download and compose the official Gerrit `commit-msg` hook                   | Yes                        |
| `amend [--dry-run]`              | Update HEAD and upload a new Patch Set for the same Gerrit Change            | Yes                        |
| `merge [source] [--dry-run]`     | Create an explicit merge commit from a local or remote branch                | Yes                        |
| `sync [--dry-run]`               | Fetch and synchronize the target branch explicitly                           | Yes                        |
| `review [reviewers] [--dry-run]` | Preflight, optionally synchronize, and push to `refs/for/*`                  | Yes                        |
| `open [--print]`                 | Open the Gerrit change referenced by HEAD's Change-Id                        | Opens a browser            |
| `hook run <file>`                | Adapter for Husky and other hook managers                                    | Updates the commit message |

Run `gerrit <command> --help` for the full option contract.

## Update an existing Change

Stage only the files intended for the next Patch Set, then run `gerrit amend`. The command preserves
HEAD's Change-Id, refuses unstaged or untracked files, and uploads the amended commit to the same
Gerrit Change by default. It never stages files automatically.

```bash
git add src/example.ts
gerrit amend --dry-run
gerrit amend
```

Use `--edit-message` for a manual message-only update or `--no-review` to keep the amendment local.
For a two-parent merge commit, `gerrit amend --merge-log` regenerates an `Included commits:` body
from `HEAD^1..HEAD^2`, preserves the existing Change-Id, and uploads the result as a new Patch Set.

## Merge a branch for review

`gerrit merge` refreshes the configured remote by default and always runs
`git merge --no-ff --no-edit --log`. This keeps branch integration as an explicit merge commit and
records the incoming commit subjects in its message. Use `--no-fetch` for existing refs or offline
work, and use `gerrit sync` when the intended operation is fast-forward synchronization.

```bash
gerrit merge origin/feature/login --dry-run
gerrit merge origin/feature/login
gerrit merge feature/login --no-fetch
```

## Review options

```bash
gerrit review alice,bob
gerrit review -r alice -r bob --cc carol
gerrit review --topic feature-auth --wip
gerrit review --sync-strategy merge
gerrit review --no-sync
gerrit review --dry-run
```

The default synchronization strategy is `ff-only`. Choose `merge` or `rebase` explicitly when local
and remote history diverge. The CLI never amends commits or creates a synthetic merge to bypass
Gerrit's `no new changes` response. Review preflight also stops when HEAD is already known on another
remote-tracking branch; start again from the target branch and use `gerrit merge` when that branch
integration itself needs review.

## Configuration

Configuration precedence is:

1. Command flags.
2. Repository `.gerrit-cli.json`.
3. User `~/.config/gerrit-cli/config.json`.
4. Git branch tracking metadata and safe defaults.

```json
{
  "cloneBaseUrl": "ssh://alice@gerrit.example.com:29418",
  "remote": "origin",
  "targetBranch": "main",
  "syncStrategy": "ff-only",
  "webUrl": "https://gerrit.example.com",
  "reviewers": ["alice"],
  "cc": ["team@example.com"]
}
```

On the first interactive use, `gerrit clone team/app` asks for the clone base URL and whether to save
it globally. Later clones only need the project name. Inside an existing Gerrit repository, the CLI
first tries to infer the base from the current branch's remote. `--dry-run` never saves configuration,
and non-interactive or JSON runs return setup guidance instead of prompting.

SSH, HTTP, and HTTPS bases are supported; when `cloneBaseUrl` is omitted, `webUrl` can be used as an
HTTPS clone base. Passwords cannot be embedded in the URL. Use `--base-url` for a one-off override.

The CLI does not store passwords or tokens. Git, SCP, and SSH continue to use credentials already
configured on the machine. Gerrit does not define one portable refresh-token flow for Git clone;
OAuth refresh tokens remain specific to an identity provider.

## JSON contract

Pass `--json` before the command to keep stdout machine-readable. Progress and diagnostics go to
stderr.

Successful commands return:

```json
{
  "ok": true,
  "command": "status",
  "data": {}
}
```

Errors return a stable code, message, and actionable hints:

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

The repository includes a companion skill in [`skills/gerrit-cli`](../skills/gerrit-cli). It is a
repository product and is intentionally excluded from the npm package. The skill checks for an
installed CLI or a publicly available npm version before suggesting live commands.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm verify:package
pnpm release:check
```

`pnpm verify:package` creates a real npm archive in a temporary directory, verifies its contents and
executable mode, installs that archive into a fresh consumer, and exercises the installed CLI.

See [CONTRIBUTING](../CONTRIBUTING.md) for contribution guidance and [RELEASING](../RELEASING.md)
for the Actions-only release contract.

## Support and security

- Use [GitHub Issues](https://github.com/cixiangtao/gerrit-cli/issues) for reproducible bugs and
  focused feature requests after searching existing reports.
- Read [SUPPORT](../SUPPORT.md) for usage boundaries.
- Do not disclose vulnerabilities in public issues. Follow [SECURITY](../SECURITY.md).

## License

[MIT](../LICENSE)
