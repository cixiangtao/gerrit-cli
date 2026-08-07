import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { EffectiveConfig, SyncStrategy } from "../types.js";
import { CliError } from "./errors.js";
import { getCurrentBranch, getGitConfig, getRepositoryRoot, runGit } from "./git.js";

const CHANGE_ID_PATTERN = /^Change-Id:\s+(I[0-9a-f]{40})\s*$/im;

export interface RepositoryContext {
  root: string;
  branch: string;
  remote: string;
  remoteUrl: string;
  targetBranch: string;
  upstream?: string;
  syncStrategy: SyncStrategy;
}

export interface RepositoryOverrides {
  remote?: string;
  targetBranch?: string;
  syncStrategy?: SyncStrategy;
}

export interface CommitInfo {
  oid: string;
  subject: string;
  changeId?: string;
}

const pathExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const resolveGitPath = async (root: string, name: string) => {
  const result = await runGit(["rev-parse", "--git-path", name], { cwd: root });
  return resolve(root, result.stdout);
};

/** Resolves remote and target branch from flags, config, and branch tracking metadata. */
export const resolveRepositoryContext = async (
  cwd: string,
  config: EffectiveConfig,
  overrides: RepositoryOverrides = {},
): Promise<RepositoryContext> => {
  const root = await getRepositoryRoot(cwd);
  const branch = await getCurrentBranch(root);
  const branchRemote = await getGitConfig(root, `branch.${branch}.remote`);
  const branchMerge = await getGitConfig(root, `branch.${branch}.merge`);
  const upstreamResult = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd: root, allowFailure: true },
  );
  const upstream = upstreamResult.exitCode === 0 ? upstreamResult.stdout : undefined;
  const remote = overrides.remote ?? config.remote ?? branchRemote ?? "origin";
  const targetBranch =
    overrides.targetBranch ??
    config.targetBranch ??
    branchMerge?.replace(/^refs\/heads\//, "") ??
    branch;

  if (remote === ".") {
    throw new CliError("LOCAL_UPSTREAM", "The current branch tracks a local branch.", {
      hints: ["Pass --remote <name> and --target <branch> for the Gerrit remote."],
    });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote)) {
    throw new CliError("INVALID_REMOTE", `Invalid Git remote name: ${remote}.`, {
      hints: ["Use a normal Git remote name such as origin or gerrit."],
    });
  }

  const remoteResult = await runGit(["remote", "get-url", remote], {
    cwd: root,
    allowFailure: true,
  });
  if (remoteResult.exitCode !== 0 || !remoteResult.stdout) {
    throw new CliError("REMOTE_NOT_FOUND", `Git remote ${remote} was not found.`, {
      hints: ["Configure a remote, add it to .gerrit-flow.json, or pass --remote <name>."],
    });
  }
  const branchCheck = await runGit(["check-ref-format", "--branch", targetBranch], {
    cwd: root,
    allowFailure: true,
  });
  if (branchCheck.exitCode !== 0) {
    throw new CliError("INVALID_TARGET_BRANCH", `Invalid target branch: ${targetBranch}.`);
  }

  const context: RepositoryContext = {
    root,
    branch,
    remote,
    remoteUrl: remoteResult.stdout,
    targetBranch,
    syncStrategy: overrides.syncStrategy ?? config.syncStrategy,
  };
  if (upstream) context.upstream = upstream;
  return context;
};

/** Returns a concise porcelain status, including untracked files. */
export const getWorkingTreeStatus = async (root: string) => {
  await runGit(["update-index", "-q", "--refresh"], { cwd: root, allowFailure: true });
  const result = await runGit(["status", "--porcelain=v1"], { cwd: root });
  return result.stdout ? result.stdout.split("\n") : [];
};

/** Detects Git operations that should finish before synchronizing or reviewing. */
export const getInProgressOperation = async (root: string) => {
  const candidates = [
    ["MERGE_HEAD", "merge"],
    ["rebase-merge", "rebase"],
    ["rebase-apply", "rebase"],
    ["CHERRY_PICK_HEAD", "cherry-pick"],
    ["REVERT_HEAD", "revert"],
    ["BISECT_LOG", "bisect"],
  ] as const;

  for (const [gitPath, operation] of candidates) {
    if (await pathExists(await resolveGitPath(root, gitPath))) return operation;
  }
  return undefined;
};

/** Fails when synchronization could overwrite or combine unresolved local state. */
export const assertRepositoryReady = async (root: string) => {
  const [changes, operation] = await Promise.all([
    getWorkingTreeStatus(root),
    getInProgressOperation(root),
  ]);
  if (operation) {
    throw new CliError("GIT_OPERATION_IN_PROGRESS", `A Git ${operation} is in progress.`, {
      hints: [`Complete or abort the ${operation} before continuing.`],
    });
  }
  if (changes.length > 0) {
    throw new CliError("DIRTY_WORKTREE", "The working tree has uncommitted changes.", {
      hints: [
        ...changes.slice(0, 8).map((line) => `  ${line}`),
        ...(changes.length > 8 ? [`  ... ${changes.length - 8} more files`] : []),
        "Commit or stash all tracked and untracked changes before continuing.",
      ],
    });
  }
};

/** Calculates commits missing on each side of a two-dot comparison. */
export const getAheadBehind = async (root: string, base: string) => {
  const result = await runGit(["rev-list", "--left-right", "--count", `${base}...HEAD`], {
    cwd: root,
    allowFailure: true,
  });
  if (result.exitCode !== 0) return undefined;
  const [behindValue, aheadValue] = result.stdout.split(/\s+/);
  return {
    behind: Number(behindValue ?? 0),
    ahead: Number(aheadValue ?? 0),
  };
};

/** Lists commits that would be submitted above a fetched or tracking base. */
export const getOutgoingCommits = async (root: string, base: string) => {
  const format = "%H%x1f%s%x1f%B%x1e";
  const result = await runGit(["log", `--format=${format}`, `${base}..HEAD`], { cwd: root });
  return result.stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record): CommitInfo => {
      const [oid = "", subject = "", body = ""] = record.split("\x1f");
      const changeId = body.match(CHANGE_ID_PATTERN)?.[1];
      return changeId ? { oid, subject, changeId } : { oid, subject };
    });
};

/** Reads the Change-Id trailer from HEAD when present. */
export const getHeadChangeId = async (root: string) => {
  const result = await runGit(["log", "-1", "--format=%B"], { cwd: root });
  return result.stdout.match(CHANGE_ID_PATTERN)?.[1];
};

/** Resolves Git's common directory, which remains correct inside worktrees. */
export const getGitCommonDirectory = async (root: string) => {
  const result = await runGit(["rev-parse", "--git-common-dir"], { cwd: root });
  return resolve(root, result.stdout);
};

/** Resolves the active hooks directory while respecting core.hooksPath. */
export const getActiveHooksDirectory = async (root: string) => {
  const result = await runGit(["rev-parse", "--git-path", "hooks"], { cwd: root });
  return resolve(root, result.stdout);
};

export const readHook = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
};
