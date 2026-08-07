# @anys/gerrit-cli

A safe local Git workflow CLI for [Gerrit Code Review](https://www.gerritcodereview.com/).

`@anys/gerrit-cli` focuses on the repository-side workflow that generic Gerrit API clients do not cover: Change-Id hook setup, local diagnostics, explicit synchronization, and safe `refs/for/*` review pushes.

> Unofficial community project. It is not affiliated with or endorsed by the Gerrit project.

[简体中文文档](https://github.com/cixiangtao/gerrit-flow/blob/main/docs/README.zh-CN.md)

## Install

Run it directly without a permanent install:

```bash
npx @anys/gerrit-cli --help
```

Or add it to a project:

```bash
pnpm add -D @anys/gerrit-cli
```

Add convenient project scripts:

```json
{
  "scripts": {
    "gerrit": "gerrit",
    "review": "gerrit review"
  }
}
```

The published CLI requires Node.js 18 or newer.

## Interactive command menu

Run the CLI without arguments in a terminal to select a command with the arrow keys and execute it
with Enter:

```bash
gerrit
# Or without installing it:
npx @anys/gerrit-cli
```

Each option describes its purpose and whether it reads or writes state. Bare invocations outside a
TTY show help instead, so CI and piped commands never wait for interactive input. Automation should
continue to use explicit commands and `--json`.

Human-readable output groups aligned fields, readiness checks, skipped checks, summaries, and
commands into distinct sections. Restrained ANSI colors emphasize state rather than labels when the
terminal supports them. Set `NO_COLOR=1` to disable colors. JSON never includes ANSI sequences;
non-TTY output stays plain unless color is explicitly forced.

## Quick start

```bash
# Inspect local configuration without making a network request.
pnpm gerrit --json doctor --offline

# Preview and install the official Gerrit Change-Id hook.
pnpm gerrit setup --dry-run
pnpm gerrit setup

# Inspect the local review state.
pnpm gerrit status

# Preview, then push a review.
pnpm review alice,bob --dry-run
pnpm review alice,bob
```

## Commands

| Command                          | Purpose                                                                      | Writes state               |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------- |
| `doctor [--offline]`             | Check Git, repository, hook, remote, and SSH readiness                       | No                         |
| `status`                         | Show local branch, upstream, ahead/behind, outgoing commits, and hook status | No                         |
| `setup [--dry-run]`              | Download and compose the official Gerrit `commit-msg` hook                   | Yes                        |
| `sync [--dry-run]`               | Fetch and synchronize the target branch explicitly                           | Yes                        |
| `review [reviewers] [--dry-run]` | Preflight, optionally synchronize, and push to `refs/for/*`                  | Yes                        |
| `open [--print]`                 | Open the Gerrit change referenced by HEAD's Change-Id                        | Opens a browser            |
| `hook run <file>`                | Adapter for Husky and other hook managers                                    | Updates the commit message |

Run `gerrit <command> --help` for every option. Without a local or global install, replace
`gerrit` with `npx @anys/gerrit-cli`.

## Review options

```bash
gerrit review alice,bob
gerrit review -r alice -r bob --cc carol
gerrit review --topic feature-auth --wip
gerrit review --sync-strategy merge
gerrit review --no-sync
gerrit review --dry-run
```

The default synchronization strategy is `ff-only`. Choose `merge` or `rebase` explicitly when local and remote history diverge. The CLI never amends commits or creates a synthetic merge to bypass Gerrit's `no new changes` response.

## Configuration

Configuration precedence is:

1. Command flags.
2. Repository `.gerrit-flow.json`.
3. User `~/.config/gerrit-flow/config.json`.
4. Git branch tracking metadata and safe defaults.

```json
{
  "remote": "origin",
  "targetBranch": "main",
  "syncStrategy": "ff-only",
  "webUrl": "https://gerrit.example.com",
  "reviewers": ["alice"],
  "cc": ["team@example.com"]
}
```

Secrets are not stored. Git and SCP use the SSH configuration and credentials already available on the machine.

## JSON contract

Pass `--json` before the command to keep stdout machine-readable. Progress and diagnostics go to stderr.

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

## Safety model

- Child processes are started with argument arrays and never through a shell.
- `setup`, `sync`, `review`, and `open` expose preview or print modes.
- A live review push requires interactive confirmation unless `--yes` is explicit.
- Existing non-Gerrit hooks are never overwritten.
- `review` rejects detached HEAD, dirty worktrees, incomplete Git operations, empty outgoing ranges, and missing Change-Id trailers.
- Native `git`, `scp`, and Gerrit SSH commands remain the documented low-level escape hatch.

## Development

```bash
pnpm install
pnpm check
pnpm build
pnpm release:check
pnpm link --global
```

Before publishing, inspect the packed npm contents produced by `pnpm check:package`.

## License

[MIT](LICENSE)
