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
gerrit merge feature/login --dry-run
gerrit review alice,bob --dry-run
```

The CLI defaults to previews, explicit synchronization strategies, and interactive confirmation
before a live merge or review push. Run `gerrit merge` in a terminal to choose the source branch,
refresh behavior, and merge strategy from visual menus. Use explicit commands and `--json` in
automation.

## License

[MIT](https://github.com/cixiangtao/gerrit-cli/blob/main/LICENSE)
