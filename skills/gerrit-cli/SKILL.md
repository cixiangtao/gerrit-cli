---
name: gerrit-cli
description: Use @anys/gerrit-cli through npx or the installed gerrit command to inspect Git repositories, verify Gerrit readiness, preview or recover branch merges, synchronize safely, and submit Gerrit reviews. Use this skill whenever a user wants the gerrit CLI to inspect, merge, sync, set up, or submit repository changes.
---

# Gerrit CLI

Prefer the installed command when it is available:

```bash
command -v gerrit
gerrit --json doctor --offline
gerrit --json status
```

Otherwise confirm that the public package is available before invoking it through npx:

```bash
npm view @anys/gerrit-cli version
npx --yes @anys/gerrit-cli --json doctor --offline
npx --yes @anys/gerrit-cli --json status
```

If neither the installed command nor the public package is available, explain that the CLI must be
installed or published before continuing. Do not guess a source checkout path or run an unrelated
package with a similar name.

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

For a branch merge, preview the source, relationship, commits, and strategy first:

```bash
gerrit --json merge feature/login --strategy no-ff --dry-run
gerrit merge feature/login --strategy no-ff
```

If a merge stops on conflicts, resolve and stage every file before continuing, or abort it:

```bash
gerrit merge --continue
gerrit merge --abort
```

Rules:

- Prefer `--json` for inspection and automation.
- Use explicit subcommands in automation; reserve the bare interactive menu for human terminal use.
- Use `npx --yes @anys/gerrit-cli` only after verifying that the public package exists.
- Run `doctor --offline` and `status` before write commands.
- Use `--dry-run` before `setup`, `merge`, `sync`, `review`, or `open`.
- Keep the default `ff-only` merge strategy unless the user explicitly chooses `ff` or `no-ff`.
- Do not pass `--yes`, perform a live merge, change history strategy, install hooks, or push a review without user authorization.
- Do not manufacture a commit or merge to bypass `NO_NEW_CHANGES`.
- Use native `git` and Gerrit SSH commands only when the high-level command cannot express a required recovery step.
