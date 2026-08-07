# @anys/gerrit-cli

A safe local Git workflow CLI for [Gerrit Code Review](https://www.gerritcodereview.com/).

> Unofficial community project. It is not affiliated with or endorsed by the Gerrit project.

## Documentation

- [Full documentation](https://github.com/cixiangtao/gerrit-cli)
- [简体中文](https://github.com/cixiangtao/gerrit-cli/blob/main/docs/README.zh-CN.md)

## Install

```bash
npx @anys/gerrit-cli --help
```

Or add it to a project:

```bash
pnpm add -D @anys/gerrit-cli
```

The CLI requires Node.js 22.14 or newer.

## Quick example

```bash
gerrit --json doctor --offline
gerrit setup --dry-run
gerrit status
gerrit amend --dry-run
gerrit merge feature/login --dry-run
gerrit review alice,bob --dry-run
```

The CLI defaults to previews, explicit synchronization strategies, and interactive confirmation
before a live merge or review push. Run `gerrit merge` in a terminal to refresh the remote and choose
the source branch. Remote refresh is the default; pass `--no-fetch` to use existing refs. Merge
always uses `--no-ff --log` so branch integration remains an explicit, reviewable commit whose
message summarizes the source commits; use `gerrit sync` for fast-forward synchronization. Use
explicit commands and `--json` in automation. Review preflight stops before pushing when HEAD is
already known on another remote-tracking branch.

Use `gerrit amend` after staging changes to preserve HEAD's Change-Id and upload a new Patch Set for
the same Gerrit Change. For a merge commit, `gerrit amend --merge-log` automatically regenerates
the body from the commits reachable from its second parent but not its first parent. It preserves
the existing Change-Id and uploads the result as a new Patch Set. The command never stages files
automatically; pass `--edit-message` for a manual message-only update or `--no-review` to keep the
amendment local.

## License

[MIT](https://github.com/cixiangtao/gerrit-cli/blob/main/LICENSE)
