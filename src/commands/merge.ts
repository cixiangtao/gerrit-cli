import { cancel, isCancel, select, type Option } from "@clack/prompts";

import { CliError } from "../core/errors.js";
import { runGit } from "../core/git.js";
import type { Output } from "../core/output.js";
import { formatCommand } from "../core/process.js";
import {
  assertRepositoryReady,
  getInProgressOperation,
  getWorkingTreeStatus,
  type RepositoryOverrides,
} from "../core/repository.js";
import type { GlobalOptions, MergeStrategy } from "../types.js";
import { confirmWrite, resolveRuntime } from "./shared.js";

export interface MergeOptions {
  strategy: MergeStrategy;
  fetch: boolean;
  continue: boolean;
  abort: boolean;
  dryRun: boolean;
  yes: boolean;
}

export interface MergeCandidate {
  ref: string;
  name: string;
  kind: "local" | "remote";
  oid: string;
  subject: string;
}

interface MergeComparison {
  sourceCommits: number;
  targetCommits: number;
  relationship: "up-to-date" | "fast-forward" | "diverged";
}

const STRATEGY_OPTIONS = [
  {
    value: "ff-only",
    label: "Fast-forward only",
    hint: "Stop if both branches contain unique commits",
  },
  {
    value: "ff",
    label: "Fast-forward when possible",
    hint: "Create a merge commit only when the branches diverged",
  },
  {
    value: "no-ff",
    label: "Always create a merge commit",
    hint: "Preserve the source branch as an explicit merge boundary",
  },
] satisfies Option<MergeStrategy>[];

const assertInteractive = (global: GlobalOptions) => {
  if (global.json || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new CliError("MERGE_SOURCE_REQUIRED", "A source branch is required.", {
      hints: [
        "Pass a branch explicitly, for example: gerrit merge feature/login --dry-run.",
        "Run gerrit merge in an interactive terminal to choose from a branch menu.",
      ],
    });
  }
};

const unwrapPrompt = <T>(value: T | symbol): T => {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    throw new CliError("CANCELLED", "Operation cancelled.", { exitCode: 0 });
  }
  return value;
};

/** Lists local and remote-tracking branches for the interactive merge picker. */
export const listMergeCandidates = async (root: string, currentBranch: string) => {
  const result = await runGit(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "--format=%(refname)%09%(refname:short)%09%(objectname:short)%09%(subject)",
      "refs/heads",
      "refs/remotes",
    ],
    { cwd: root },
  );

  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line): MergeCandidate | undefined => {
      const [ref = "", name = "", oid = "", ...subjectParts] = line.split("\t");
      if (!ref || !name || name.endsWith("/HEAD") || ref === `refs/heads/${currentBranch}`) {
        return undefined;
      }
      return {
        ref,
        name,
        kind: ref.startsWith("refs/remotes/") ? "remote" : "local",
        oid,
        subject: subjectParts.join("\t"),
      };
    })
    .filter((candidate): candidate is MergeCandidate => candidate !== undefined);
};

const promptFetch = async (remote: string) =>
  unwrapPrompt(
    await select<boolean>({
      message: `Refresh ${remote} before choosing a branch?`,
      options: [
        {
          value: true,
          label: "Fetch latest branches",
          hint: "Updates remote-tracking refs before the preview",
        },
        {
          value: false,
          label: "Use existing refs",
          hint: "Keeps the branch picker fully local",
        },
      ],
      initialValue: true,
    }),
  );

const promptSource = async (candidates: readonly MergeCandidate[]) => {
  if (candidates.length === 0) {
    throw new CliError("NO_MERGE_CANDIDATES", "No source branches are available to merge.", {
      hints: ["Create or fetch another branch, then retry."],
    });
  }
  return unwrapPrompt(
    await select<string>({
      message: "Select the branch to merge",
      options: candidates.map(({ ref, name, kind, oid, subject }) => ({
        value: ref,
        label: name,
        hint: `${kind} · ${oid}${subject ? ` · ${subject}` : ""}`,
      })),
      maxItems: Math.min(candidates.length, 12),
    }),
  );
};

const promptStrategy = async () =>
  unwrapPrompt(
    await select<MergeStrategy>({
      message: "Select a merge strategy",
      options: STRATEGY_OPTIONS,
      initialValue: "ff-only",
    }),
  );

const promptRecoveryAction = async () =>
  unwrapPrompt(
    await select<"continue" | "abort">({
      message: "A merge is already in progress. What should happen next?",
      options: [
        {
          value: "continue",
          label: "Continue merge",
          hint: "Complete the merge after all conflicts are resolved and staged",
        },
        {
          value: "abort",
          label: "Abort merge",
          hint: "Restore the state from before the merge started",
        },
      ],
      initialValue: "continue",
    }),
  );

const validateSource = async (root: string, source: string) => {
  if (source.startsWith("-")) {
    throw new CliError("INVALID_MERGE_SOURCE", `Invalid merge source: ${source}.`);
  }
  const result = await runGit(
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${source}^{commit}`],
    { cwd: root, allowFailure: true },
  );
  if (result.exitCode !== 0 || !result.stdout) {
    throw new CliError("MERGE_SOURCE_NOT_FOUND", `Merge source ${source} was not found.`, {
      hints: ["Fetch the remote or choose an existing local or remote-tracking branch."],
    });
  }
  return result.stdout;
};

const compareMerge = async (root: string, source: string): Promise<MergeComparison> => {
  const result = await runGit(["rev-list", "--left-right", "--count", `HEAD...${source}`], {
    cwd: root,
  });
  const [targetValue, sourceValue] = result.stdout.split(/\s+/);
  const targetCommits = Number(targetValue ?? 0);
  const sourceCommits = Number(sourceValue ?? 0);
  return {
    sourceCommits,
    targetCommits,
    relationship:
      sourceCommits === 0 ? "up-to-date" : targetCommits === 0 ? "fast-forward" : "diverged",
  };
};

const listIncomingCommits = async (root: string, source: string) => {
  const result = await runGit(["log", "--format=%h%x09%s", "--max-count=8", `HEAD..${source}`], {
    cwd: root,
  });
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [oid = "", ...subject] = line.split("\t");
      return { oid, subject: subject.join("\t") };
    });
};

const mergeArgs = (source: string, strategy: MergeStrategy) => {
  if (strategy === "ff-only") return ["merge", "--ff-only", source];
  if (strategy === "no-ff") return ["merge", "--no-ff", "--no-edit", source];
  return ["merge", "--ff", "--no-edit", source];
};

const showMergePlan = (
  output: Output,
  data: {
    dryRun: boolean;
    target: string;
    source: string;
    strategy: MergeStrategy;
    comparison: MergeComparison;
    commands: string[];
    commits: Array<{ oid: string; subject: string }>;
  },
) => {
  output.heading(data.dryRun ? "Merge preview" : "Merge plan");
  output.note(
    data.dryRun
      ? "No fetch or history update will be performed (--dry-run)."
      : "Review the selected branches and strategy before continuing.",
    data.dryRun ? "warning" : "muted",
  );
  output.blank();
  output.rows([
    { label: "Into", value: data.target, tone: "accent" },
    { label: "From", value: data.source, tone: "accent" },
    { label: "Strategy", value: data.strategy },
    { label: "Relationship", value: data.comparison.relationship },
    { label: "Incoming", value: `${data.comparison.sourceCommits} commit(s)` },
    { label: "Target only", value: `${data.comparison.targetCommits} commit(s)` },
  ]);
  if (data.commits.length > 0) {
    output.blank();
    output.note("Incoming commits", "muted");
    for (const commit of data.commits) output.note(`${commit.oid}  ${commit.subject}`);
  }
  output.blank();
  output.note(data.commands.length === 1 ? "Command" : "Commands", "muted");
  for (const command of data.commands) output.command(command);
};

const runRecovery = async (
  output: Output,
  root: string,
  action: "continue" | "abort",
  options: MergeOptions,
) => {
  const operation = await getInProgressOperation(root);
  if (operation !== "merge") {
    throw new CliError("NO_MERGE_IN_PROGRESS", "No merge is currently in progress.");
  }

  if (action === "continue") {
    const unresolved = (await getWorkingTreeStatus(root)).filter((line) =>
      /^(DD|AU|UD|UA|DU|AA|UU) /.test(line),
    );
    if (unresolved.length > 0) {
      throw new CliError("UNRESOLVED_MERGE_CONFLICTS", "Merge conflicts are still unresolved.", {
        hints: [
          ...unresolved.slice(0, 8).map((line) => `  ${line}`),
          "Resolve every conflict and stage the files before continuing.",
        ],
      });
    }
  }

  const args = ["merge", `--${action}`];
  const data = { action, dryRun: options.dryRun, command: formatCommand("git", args) };
  if (options.dryRun) {
    if (output.json) output.result("merge", data);
    else {
      output.heading(`Merge ${action} preview`);
      output.note("Repository state will not be changed (--dry-run).", "warning");
      output.blank();
      output.command(data.command);
    }
    return data;
  }

  await confirmWrite(
    action === "continue" ? "Continue and complete this merge?" : "Abort this merge?",
    options.yes,
  );
  await runGit(args, { cwd: root, stdin: "inherit" });
  const result = { ...data, completed: true };
  if (output.json) output.result("merge", result);
  else {
    output.heading("Merge recovery");
    output.note(action === "continue" ? "Merge completed." : "Merge aborted.", "success");
  }
  return result;
};

/** Plans and executes branch merges, including conflict continue/abort recovery. */
export const runMerge = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
  source: string | undefined,
  options: MergeOptions,
) => {
  if (options.continue && options.abort) {
    throw new CliError("INVALID_MERGE_ACTION", "Choose either --continue or --abort, not both.");
  }
  if ((options.continue || options.abort) && source) {
    throw new CliError("INVALID_MERGE_ACTION", "A source branch cannot be used with recovery.");
  }

  const { repository } = await resolveRuntime(global, output, overrides);
  if (options.continue || options.abort) {
    return runRecovery(output, repository.root, options.continue ? "continue" : "abort", options);
  }

  const operation = await getInProgressOperation(repository.root);
  if (!source && operation === "merge") {
    assertInteractive(global);
    return runRecovery(output, repository.root, await promptRecoveryAction(), options);
  }

  await assertRepositoryReady(repository.root);
  let shouldFetch = options.fetch;
  let selectedSource = source;
  let strategy = options.strategy;

  if (!selectedSource) {
    assertInteractive(global);
    shouldFetch = await promptFetch(repository.remote);
    if (shouldFetch && !options.dryRun) {
      await runGit(["fetch", "--prune", repository.remote], {
        cwd: repository.root,
        stdin: "inherit",
      });
    }
    selectedSource = await promptSource(
      await listMergeCandidates(repository.root, repository.branch),
    );
    strategy = await promptStrategy();
  } else if (shouldFetch && !options.dryRun) {
    await runGit(["fetch", "--prune", repository.remote], {
      cwd: repository.root,
      stdin: "inherit",
    });
  }

  const sourceOid = await validateSource(repository.root, selectedSource);
  const comparison = await compareMerge(repository.root, sourceOid);
  if (strategy === "ff-only" && comparison.relationship === "diverged") {
    throw new CliError("NON_FAST_FORWARD_MERGE", "The selected branches have diverged.", {
      hints: [
        "Choose --strategy ff to allow a merge commit when needed.",
        "Choose --strategy no-ff to always create a merge commit.",
        "No history was changed.",
      ],
    });
  }

  const fetchArgs = ["fetch", "--prune", repository.remote];
  const actualMergeArgs = mergeArgs(selectedSource, strategy);
  const commands = [
    ...(shouldFetch ? [formatCommand("git", fetchArgs)] : []),
    formatCommand("git", actualMergeArgs),
  ];
  const data = {
    action: "start" as const,
    dryRun: options.dryRun,
    target: repository.branch,
    source: selectedSource,
    sourceOid,
    strategy,
    fetched: shouldFetch && !options.dryRun,
    comparison,
    commits: await listIncomingCommits(repository.root, sourceOid),
    commands,
  };

  if (options.dryRun || comparison.relationship === "up-to-date") {
    if (output.json) output.result("merge", data);
    else {
      showMergePlan(output, data);
      if (comparison.relationship === "up-to-date") {
        output.blank();
        output.note("The current branch already contains the selected source.", "success");
      }
    }
    return data;
  }

  if (!output.json) showMergePlan(output, data);
  await confirmWrite(`Merge ${selectedSource} into ${repository.branch}?`, options.yes);
  if ((await validateSource(repository.root, selectedSource)) !== sourceOid) {
    throw new CliError("MERGE_SOURCE_CHANGED", `Merge source ${selectedSource} changed.`, {
      hints: ["Review a new --dry-run preview before merging the updated source."],
    });
  }
  const before = (await runGit(["rev-parse", "HEAD"], { cwd: repository.root })).stdout;
  try {
    await runGit(actualMergeArgs, { cwd: repository.root, stdin: "inherit" });
  } catch (error) {
    const operation = await getInProgressOperation(repository.root);
    const conflicts =
      operation === "merge"
        ? (await getWorkingTreeStatus(repository.root)).filter((line) =>
            /^(DD|AU|UD|UA|DU|AA|UU) /.test(line),
          )
        : [];
    throw new CliError(
      operation === "merge" ? "MERGE_CONFLICT" : "MERGE_FAILED",
      operation === "merge"
        ? "The merge stopped because conflicts must be resolved."
        : "The merge could not be completed.",
      {
        hints:
          operation === "merge"
            ? [
                ...conflicts.slice(0, 8).map((line) => `  ${line}`),
                "Resolve conflicts and stage the files, then run gerrit merge --continue.",
                "Run gerrit merge --abort to restore the pre-merge state.",
              ]
            : ["Inspect the Git output and repository state before retrying."],
        cause: error,
      },
    );
  }
  const after = (await runGit(["rev-parse", "HEAD"], { cwd: repository.root })).stdout;
  const result = { ...data, before, after, completed: true };
  if (output.json) output.result("merge", result);
  else {
    output.blank();
    output.note(
      before === after ? "The branch was already up to date." : "Merge completed successfully.",
      "success",
    );
    output.rows([{ label: "HEAD", value: after }]);
  }
  return result;
};
