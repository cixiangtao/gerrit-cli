import { confirm, type ConfirmOptions } from "@clack/prompts";

import type { EffectiveConfig, GlobalOptions, SyncStrategy } from "../types.js";
import { loadConfig } from "../core/config.js";
import { CliError } from "../core/errors.js";
import { getRepositoryRoot, runGit } from "../core/git.js";
import type { Output } from "../core/output.js";
import { formatCommand } from "../core/process.js";
import {
  assertRepositoryReady,
  getAheadBehind,
  getInProgressOperation,
  resolveRepositoryContext,
  type RepositoryContext,
  type RepositoryOverrides,
} from "../core/repository.js";

export interface RuntimeContext {
  global: GlobalOptions;
  config: EffectiveConfig;
  repository: RepositoryContext;
  output: Output;
}

export const resolveRuntime = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides = {},
): Promise<RuntimeContext> => {
  const root = await getRepositoryRoot(global.cwd);
  const config = await loadConfig(root);
  const repository = await resolveRepositoryContext(root, config, overrides);
  return { global, config, repository, output };
};

export interface SyncResult {
  dryRun: boolean;
  strategy: SyncStrategy;
  before?: { ahead: number; behind: number };
  after?: { ahead: number; behind: number };
  commands: string[];
}

/** Fetches and synchronizes the target branch using one explicit strategy. */
export const syncRepository = async (
  repository: RepositoryContext,
  strategy: SyncStrategy,
  dryRun: boolean,
): Promise<SyncResult> => {
  const fetchArgs = ["fetch", repository.remote, repository.targetBranch];
  const commands = [formatCommand("git", fetchArgs)];
  if (dryRun) return { dryRun: true, strategy, commands };

  await assertRepositoryReady(repository.root);
  await runGit(fetchArgs, { cwd: repository.root, stdin: "inherit" });
  const before = await getAheadBehind(repository.root, "FETCH_HEAD");
  if (!before) {
    throw new CliError("REMOTE_COMPARISON_FAILED", "Unable to compare HEAD with FETCH_HEAD.");
  }

  if (before.behind > 0) {
    let syncArgs: string[];
    if (strategy === "ff-only") {
      if (before.ahead > 0) {
        throw new CliError("DIVERGED_BRANCH", "Local and remote branches have diverged.", {
          hints: [
            "Choose --sync-strategy merge or --sync-strategy rebase explicitly.",
            "No history was changed.",
          ],
        });
      }
      syncArgs = ["merge", "--ff-only", "FETCH_HEAD"];
    } else if (strategy === "merge") {
      syncArgs = ["merge", "--no-edit", "FETCH_HEAD"];
    } else {
      syncArgs = ["rebase", "FETCH_HEAD"];
    }
    commands.push(formatCommand("git", syncArgs));
    try {
      await runGit(syncArgs, { cwd: repository.root, stdin: "inherit" });
    } catch (error) {
      const operation = await getInProgressOperation(repository.root);
      throw new CliError("SYNC_FAILED", "Unable to synchronize the target branch.", {
        hints: operation
          ? [
              `A ${operation} is now in progress. Resolve it or run git ${operation === "merge" ? "merge" : "rebase"} --abort.`,
            ]
          : ["Inspect the Git output and repository state before retrying."],
        cause: error,
      });
    }
  }

  await assertRepositoryReady(repository.root);
  const after = await getAheadBehind(repository.root, "FETCH_HEAD");
  return {
    dryRun: false,
    strategy,
    before,
    ...(after ? { after } : {}),
    commands,
  };
};

export interface ConfirmationContext {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  prompt?: (options: ConfirmOptions) => Promise<boolean | symbol>;
}

/** Requires an explicit confirmation before a live review push. */
export const confirmWrite = async (
  message: string,
  yes: boolean,
  context: ConfirmationContext = {},
) => {
  if (yes) return;
  const stdinIsTTY = context.stdinIsTTY ?? process.stdin.isTTY;
  const stdoutIsTTY = context.stdoutIsTTY ?? process.stdout.isTTY;
  if (!stdinIsTTY || !stdoutIsTTY) {
    throw new CliError("CONFIRMATION_REQUIRED", "Live writes require confirmation.", {
      hints: ["Run interactively or pass --yes after reviewing --dry-run output."],
    });
  }

  const accepted = await (context.prompt ?? confirm)({
    message,
    initialValue: false,
    active: "Yes",
    inactive: "No",
  });
  if (typeof accepted === "symbol" || !accepted) {
    throw new CliError("CANCELLED", "Operation cancelled.", { exitCode: 0 });
  }
};
