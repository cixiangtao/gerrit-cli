---
name: gerrit-cli
description: Use @anys/gerrit-cli through npx or the installed gerrit command to inspect a Git repository, verify Gerrit readiness, preview synchronization, and submit Gerrit reviews safely.
---

# Gerrit CLI

Prefer the installed command when it is available:

```bash
command -v gerrit
gerrit --json doctor --offline
gerrit --json status
```

Otherwise invoke the published package through npx:

```bash
npx --yes @anys/gerrit-cli --json doctor --offline
npx --yes @anys/gerrit-cli --json status
```

For first-time setup, preview before installing the Change-Id hook:

```bash
gerrit --json setup --dry-run
gerrit setup
```

For a review push, preview the exact target and refspec first:

```bash
gerrit --json review alice,bob --dry-run
gerrit review alice,bob
```

Rules:

- Prefer `--json` for inspection and automation.
- Use explicit subcommands in automation; reserve the bare interactive menu for human terminal use.
- Use `npx --yes @anys/gerrit-cli` in place of `gerrit` when the command is not installed.
- Run `doctor --offline` and `status` before write commands.
- Use `--dry-run` before `setup`, `sync`, `review`, or `open`.
- Do not pass `--yes`, change history strategy, install hooks, or push a review without user authorization.
- Do not manufacture a commit or merge to bypass `NO_NEW_CHANGES`.
- Use native `git` and Gerrit SSH commands only when the high-level command cannot express a required recovery step.
