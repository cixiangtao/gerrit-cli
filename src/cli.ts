#!/usr/bin/env node

import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { Command, Option } from "commander";
import pc from "picocolors";

import { runAmend, type AmendOptions } from "./commands/amend.js";
import { runDoctor } from "./commands/doctor.js";
import { runHook } from "./commands/hook.js";
import { runMerge, type MergeOptions } from "./commands/merge.js";
import { runOpen } from "./commands/open.js";
import { runReview, type ReviewOptions } from "./commands/review.js";
import { runSetup } from "./commands/setup.js";
import { runStatus } from "./commands/status.js";
import { runSync } from "./commands/sync.js";
import { CliError, toCliError } from "./core/errors.js";
import { createOutput } from "./core/output.js";
import { resolveRootArguments } from "./interactive.js";
import type { GlobalOptions, SyncStrategy } from "./types.js";

const readPackageVersion = async () => {
  const manifest: unknown = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("package.json must contain a string version.");
  }
  return manifest.version;
};

// package.json is the single public version owner for source and packed executions.
const VERSION = await readPackageVersion();
const SYNC_STRATEGIES = ["ff-only", "merge", "rebase"] as const;
const NOTIFY_VALUES = ["NONE", "OWNER", "OWNER_REVIEWERS", "ALL"] as const;
const helpColors = pc.createColors(pc.isColorSupported);

interface SharedRepositoryOptions {
  remote?: string;
  target?: string;
}

const collect = (value: string, previous: string[]) => [...previous, value];

const addRepositoryOptions = (command: Command) =>
  command
    .option("--remote <name>", "Git remote used for Gerrit")
    .option("--target <branch>", "Gerrit target branch");

const getGlobalOptions = (command: Command): GlobalOptions => {
  const options = command.optsWithGlobals<{ cwd: string; json: boolean }>();
  return {
    cwd: resolve(process.cwd(), options.cwd),
    json: options.json,
  };
};

const getOverrides = (options: SharedRepositoryOptions & { syncStrategy?: SyncStrategy }) => ({
  ...(options.remote ? { remote: options.remote } : {}),
  ...(options.target ? { targetBranch: options.target } : {}),
  ...(options.syncStrategy ? { syncStrategy: options.syncStrategy } : {}),
});

const run = async (
  command: Command,
  action: (global: GlobalOptions, output: ReturnType<typeof createOutput>) => Promise<unknown>,
) => {
  const global = getGlobalOptions(command);
  const output = createOutput(global.json);
  try {
    await action(global, output);
  } catch (error) {
    const cliError = toCliError(error);
    output.failure(cliError);
    process.exitCode = cliError.exitCode;
  }
};

const program = new Command()
  .name("gerrit")
  .description("A safe local Git workflow CLI for Gerrit Code Review.")
  .version(VERSION)
  .option("-C, --cwd <path>", "Run as if started in this directory", ".")
  .option("--json", "Emit a stable JSON envelope", false)
  .exitOverride()
  .showHelpAfterError()
  .configureHelp({
    styleTitle: (value) => helpColors.bold(helpColors.magenta(value)),
    styleUsage: (value) => helpColors.bold(value),
    styleCommandText: (value) => helpColors.cyan(value),
    styleOptionText: (value) => helpColors.cyan(value),
  })
  .addHelpText(
    "beforeAll",
    `${helpColors.magenta("◆")} ${helpColors.bold(`Gerrit CLI v${VERSION}`)}\n`,
  );

program
  .command("doctor")
  .description("Check Git, repository, hook, remote, and SSH readiness")
  .option("--offline", "Skip the live SSH connectivity check", false)
  .action(async (options: { offline: boolean }, command: Command) => {
    await run(command, (global, output) => runDoctor(global, output, options));
  });

addRepositoryOptions(
  program.command("status").description("Show local repository and Gerrit review readiness"),
).action(async (options: SharedRepositoryOptions, command: Command) => {
  await run(command, (global, output) => runStatus(global, output, getOverrides(options)));
});

addRepositoryOptions(
  program
    .command("amend")
    .description("Amend HEAD and upload a new Patch Set for the same Gerrit Change")
    .option("--edit-message", "Open the editor to update the commit message", false)
    .option("--merge-log", "Regenerate a merge commit body from its incoming commits", false)
    .option("--no-review", "Amend locally without uploading a new Patch Set")
    .option("--dry-run", "Show the amend and review plan without changing state", false)
    .option("-y, --yes", "Skip the amend and upload confirmation", false),
).action(async (options: SharedRepositoryOptions & AmendOptions, command: Command) => {
  await run(command, (global, output) => runAmend(global, output, getOverrides(options), options));
});

addRepositoryOptions(
  program
    .command("setup")
    .description("Install and verify the official Gerrit Change-Id hook")
    .option("--dry-run", "Show hook changes without downloading or writing", false)
    .option("--refresh", "Redownload an existing Gerrit hook", false),
).action(
  async (
    options: SharedRepositoryOptions & { dryRun: boolean; refresh: boolean },
    command: Command,
  ) => {
    await run(command, (global, output) =>
      runSetup(global, output, getOverrides(options), options),
    );
  },
);

program
  .command("merge")
  .description("Create an explicit merge commit from a local or remote branch")
  .argument("[source]", "Local or remote branch to merge")
  .option("--remote <name>", "Git remote to refresh before selecting a branch")
  .option("--no-fetch", "Use existing refs without refreshing the selected remote")
  .option("--continue", "Continue an in-progress merge after resolving conflicts", false)
  .option("--abort", "Abort an in-progress merge and restore the pre-merge state", false)
  .option("--dry-run", "Show the merge plan without fetching or changing history", false)
  .option("-y, --yes", "Skip the final merge, continue, or abort confirmation", false)
  .action(
    async (
      source: string | undefined,
      options: MergeOptions & { remote?: string },
      command: Command,
    ) => {
      await run(command, (global, output) =>
        runMerge(global, output, options.remote ? { remote: options.remote } : {}, source, options),
      );
    },
  );

addRepositoryOptions(
  program
    .command("sync")
    .description("Fetch and synchronize the Gerrit target branch")
    .addOption(
      new Option("--sync-strategy <strategy>", "History synchronization strategy").choices(
        SYNC_STRATEGIES,
      ),
    )
    .option("--dry-run", "Show Git commands without fetching or changing history", false),
).action(
  async (
    options: SharedRepositoryOptions & {
      dryRun: boolean;
      syncStrategy?: SyncStrategy;
    },
    command: Command,
  ) => {
    await run(command, (global, output) =>
      runSync(global, output, getOverrides(options), {
        dryRun: options.dryRun,
        ...(options.syncStrategy ? { strategy: options.syncStrategy } : {}),
      }),
    );
  },
);

addRepositoryOptions(
  program
    .command("review")
    .description("Preflight, synchronize, and push commits to Gerrit refs/for")
    .argument("[reviewers]", "Comma-separated Gerrit reviewer accounts")
    .option("-r, --reviewer <account>", "Add a reviewer; repeatable", collect, [])
    .option("--cc <account>", "Add a CC recipient; repeatable", collect, [])
    .option("--topic <topic>", "Set the Gerrit topic")
    .option("--wip", "Mark the change as work in progress")
    .option("--ready", "Mark the change as ready for review")
    .addOption(new Option("--notify <level>", "Gerrit notification level").choices(NOTIFY_VALUES))
    .addOption(
      new Option("--sync-strategy <strategy>", "History synchronization strategy").choices(
        SYNC_STRATEGIES,
      ),
    )
    .option("--no-sync", "Fetch for comparison but do not update local history")
    .option(
      "--dry-run",
      "Show the review plan without fetching, changing history, or pushing",
      false,
    )
    .option("-y, --yes", "Skip the live push confirmation", false),
).action(
  async (
    reviewers: string | undefined,
    options: SharedRepositoryOptions & ReviewOptions,
    command: Command,
  ) => {
    await run(command, (global, output) =>
      runReview(global, output, getOverrides(options), reviewers, options),
    );
  },
);

addRepositoryOptions(
  program
    .command("open")
    .description("Open the Gerrit change referenced by HEAD's Change-Id")
    .option("--print", "Print the URL instead of opening a browser", false)
    .option("--dry-run", "Show the browser command without opening it", false),
).action(
  async (
    options: SharedRepositoryOptions & { dryRun: boolean; print: boolean },
    command: Command,
  ) => {
    await run(command, (global, output) => runOpen(global, output, getOverrides(options), options));
  },
);

const hook = program.command("hook").description("Compose Gerrit's hook with another hook manager");
hook
  .command("run")
  .description("Run the installed Gerrit commit-msg hook")
  .argument("<message-file>", "Commit message file passed by Git")
  .action(async (messageFile: string, _options: object, command: Command) => {
    await run(command, (global, output) => runHook(global, output, messageFile));
  });

let activeArgv = process.argv;

try {
  const rootArguments = await resolveRootArguments(process.argv.slice(2), {
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
    version: VERSION,
  });
  if (rootArguments) {
    activeArgv = [...process.argv.slice(0, 2), ...rootArguments];
    await program.parseAsync(activeArgv);
  }
} catch (error) {
  if (
    error instanceof Error &&
    "code" in error &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version")
  ) {
    process.exitCode = 0;
  } else {
    const output = createOutput(activeArgv.includes("--json"));
    const cliError = toCliError(error);
    output.failure(
      new CliError("INVALID_ARGUMENT", cliError.message, {
        hints: ["Run gerrit --help to inspect the command contract."],
        cause: cliError,
      }),
    );
    process.exitCode = 1;
  }
}
