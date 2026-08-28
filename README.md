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

The CLI supports Node.js 14.17 or newer. Node.js 14 and 16 are legacy compatibility targets;
use a maintained Node.js release when the host project allows it.

Every invocation checks npm's `latest` tag. When a newer release exists, the CLI prints a concise
upgrade notice to stderr. Registry failures and timeouts stay silent and never block the requested
Gerrit operation; `--json` stdout remains a single machine-readable envelope.

## Quick example

```bash
# On first use, the CLI asks for the Gerrit base URL and can save it globally.
gerrit clone team/app --dry-run
gerrit clone team/app

gerrit --json doctor --offline
gerrit setup --dry-run
gerrit status
gerrit amend --dry-run
gerrit merge feature/login --dry-run
gerrit review alice,bob --dry-run
```

The first interactive `gerrit clone team/app` asks for the clone base URL and whether to save it in
`~/.config/gerrit-cli/config.json`. Later clones only need the project name. When run inside an
existing Gerrit repository, the CLI first tries to infer the base from that repository's remote.
`--dry-run` may prompt for a base but never writes the configuration.

The same setting can also be managed manually:

```json
{
  "cloneBaseUrl": "ssh://alice@gerrit.example.com:29418",
  "webUrl": "https://gerrit.example.com"
}
```

`cloneBaseUrl` also accepts HTTP or HTTPS. The CLI never stores a password, access token, or refresh
token; SSH and Git credential helpers remain responsible for authentication. OAuth refresh tokens
are provider-specific and are not a portable Gerrit authentication mechanism. Use `--base-url` for
a one-off override without changing configuration.

Repository commands reject ordinary Git remotes before planning or changing anything. The shared
offline gate recognizes an explicit Gerrit SSH port (`29418`); configure `webUrl` for HTTPS, custom
SSH ports, and SCP-like remotes. `doctor` reports this as a diagnostic and can verify live SSH
connectivity; `hook run` only executes an already installed Gerrit hook and does not inspect the
remote.

`gerrit setup` respects `core.hooksPath`. When Husky or another manager already owns the active
`commit-msg` hook, setup preserves its commands and appends an idempotent managed bridge to the
official Gerrit hook. The bridge resolves Git's common directory at commit time, so it also works in
linked worktrees and does not require a globally installed `gerrit` command. For current Husky
layouts, setup updates the project-owned `.husky/commit-msg` file rather than the generated
`.husky/_` dispatcher.

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
