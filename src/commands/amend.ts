import { CliError } from "../core/errors.js";
import { runGit } from "../core/git.js";
import type { Output } from "../core/output.js";
import { formatCommand } from "../core/process.js";
import { buildReviewRefspec, parseAccounts } from "../core/refspec.js";
import {
  getHeadChangeId,
  getInProgressOperation,
  type RepositoryOverrides,
} from "../core/repository.js";
import type { GlobalOptions } from "../types.js";
import { runReview } from "./review.js";
import { confirmWrite, resolveRuntime } from "./shared.js";

export interface AmendOptions {
  editMessage: boolean;
  mergeLog: boolean;
  review: boolean;
  dryRun: boolean;
  yes: boolean;
}

interface IncludedCommit {
  hash: string;
  subject: string;
}

const splitLines = (value: string) => value.split("\n").filter(Boolean);

const inspectAmendChanges = async (root: string) => {
  const [staged, unstaged, untracked] = await Promise.all([
    runGit(["diff", "--cached", "--name-status"], { cwd: root }),
    runGit(["diff", "--name-status"], { cwd: root }),
    runGit(["ls-files", "--others", "--exclude-standard"], { cwd: root }),
  ]);
  return {
    staged: splitLines(staged.stdout),
    unstaged: [
      ...splitLines(unstaged.stdout),
      ...splitLines(untracked.stdout).map((path) => `??\t${path}`),
    ],
  };
};

const buildMergeMessage = async (root: string, changeId: string) => {
  const revision = await runGit(["rev-list", "--parents", "-1", "HEAD"], { cwd: root });
  const [, ...parents] = revision.stdout.split(" ");
  if (parents.length !== 2) {
    throw new CliError(
      "MERGE_COMMIT_REQUIRED",
      "HEAD must be a two-parent merge commit to regenerate its merge log.",
      {
        hints: ["Check out the merge commit that belongs to the Gerrit Change."],
      },
    );
  }

  const [targetParent, sourceParent] = parents;
  const [messageResult, logResult] = await Promise.all([
    runGit(["log", "-1", "--format=%B", "HEAD"], { cwd: root }),
    runGit(["log", "--reverse", "--format=%h%x09%s", `${targetParent}..${sourceParent}`], {
      cwd: root,
    }),
  ]);
  const includedCommits: IncludedCommit[] = splitLines(logResult.stdout).map((line) => {
    const separator = line.indexOf("\t");
    return separator === -1
      ? { hash: line, subject: "" }
      : { hash: line.slice(0, separator), subject: line.slice(separator + 1) };
  });
  if (includedCommits.length === 0) {
    throw new CliError("EMPTY_MERGE_LOG", "The merge commit has no incoming commits to list.", {
      hints: ["Verify that HEAD's second parent contains commits not already in its first parent."],
    });
  }

  const subject = messageResult.stdout.split("\n").find(Boolean);
  if (!subject) {
    throw new CliError("EMPTY_COMMIT_SUBJECT", "HEAD does not have a commit subject.");
  }
  const summary = includedCommits.map(({ hash, subject }) => `- ${hash} ${subject}`.trimEnd());
  return {
    includedCommits,
    message: [subject, "", "Included commits:", ...summary, "", `Change-Id: ${changeId}`].join(
      "\n",
    ),
  };
};

/** Amends HEAD while preserving its Change-Id and optionally uploads a new Patch Set. */
export const runAmend = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
  options: AmendOptions,
) => {
  const { config, repository } = await resolveRuntime(global, output, overrides);
  if (options.editMessage && options.mergeLog) {
    throw new CliError(
      "CONFLICTING_AMEND_OPTIONS",
      "--edit-message and --merge-log cannot be used together.",
      {
        hints: [
          "Use --merge-log for an automatic merge summary or --edit-message for manual editing.",
        ],
      },
    );
  }
  const operation = await getInProgressOperation(repository.root);
  if (operation) {
    throw new CliError("GIT_OPERATION_IN_PROGRESS", `A Git ${operation} is in progress.`, {
      hints: [`Complete or abort the ${operation} before amending HEAD.`],
    });
  }

  const { staged, unstaged } = await inspectAmendChanges(repository.root);
  if (unstaged.length > 0) {
    throw new CliError(
      "UNSTAGED_CHANGES",
      "Unstaged or untracked changes would remain outside the updated Patch Set.",
      {
        hints: [
          ...unstaged.slice(0, 8).map((line) => `  ${line}`),
          "Stage the intended files or stash unrelated work before running gerrit amend.",
        ],
      },
    );
  }
  if (staged.length === 0 && !options.editMessage && !options.mergeLog) {
    throw new CliError("NOTHING_TO_AMEND", "There are no staged changes to amend.", {
      hints: [
        "Stage the intended files with git add.",
        "Use --edit-message when only the commit message needs to change.",
        "Use --merge-log to regenerate a merge commit's included commit list.",
      ],
    });
  }

  const changeId = await getHeadChangeId(repository.root);
  if (!changeId) {
    throw new CliError("MISSING_CHANGE_ID", "HEAD does not contain a Gerrit Change-Id.", {
      hints: ["Only amend a commit that already belongs to a Gerrit Change."],
    });
  }

  const before = (await runGit(["rev-parse", "HEAD"], { cwd: repository.root })).stdout;
  const mergeMessage = options.mergeLog
    ? await buildMergeMessage(repository.root, changeId)
    : undefined;
  const commitArgs = mergeMessage
    ? ["commit", "--amend", "--message", mergeMessage.message]
    : ["commit", "--amend", options.editMessage ? "--edit" : "--no-edit"];
  const reviewers = parseAccounts(config.reviewers);
  const cc = parseAccounts(config.cc);
  const refspec = buildReviewRefspec({
    targetBranch: repository.targetBranch,
    reviewers,
    cc,
  });
  const pushArgs = ["push", repository.remote, refspec];
  const data = {
    dryRun: options.dryRun,
    branch: repository.branch,
    remote: repository.remote,
    targetBranch: repository.targetBranch,
    changeId,
    staged,
    editMessage: options.editMessage,
    mergeLog: options.mergeLog,
    ...(mergeMessage ? { includedCommits: mergeMessage.includedCommits } : {}),
    upload: options.review,
    before,
    commitCommand: formatCommand("git", commitArgs),
    ...(options.review ? { pushCommand: formatCommand("git", pushArgs), refspec } : {}),
  };

  if (options.dryRun) {
    if (output.json) output.result("amend", data);
    else {
      output.heading("Amend preview");
      output.note("No commit or Gerrit Patch Set will be changed (--dry-run).", "warning");
      output.blank();
      output.rows([
        { label: "Branch", value: repository.branch },
        { label: "Target", value: `${repository.remote}/${repository.targetBranch}` },
        { label: "Change-Id", value: changeId },
        { label: "Staged", value: `${staged.length} change(s)` },
        {
          label: "Message",
          value: options.mergeLog ? "regenerate merge log" : options.editMessage ? "edit" : "keep",
        },
        { label: "Upload", value: options.review ? "new Patch Set" : "disabled" },
      ]);
      if (staged.length > 0) {
        output.blank();
        output.note("Staged changes", "muted");
        for (const change of staged) output.note(change);
      }
      if (mergeMessage) {
        output.blank();
        output.note("Included commits", "muted");
        for (const commit of mergeMessage.includedCommits) {
          output.note(`${commit.hash}  ${commit.subject}`);
        }
      }
      output.blank();
      output.note(options.review ? "Commands" : "Command", "muted");
      output.command(data.commitCommand);
      if (data.pushCommand) output.command(data.pushCommand);
    }
    return data;
  }

  await confirmWrite(
    options.review
      ? `Amend ${changeId} and upload a new Patch Set to ${repository.remote}/${repository.targetBranch}?`
      : `Amend ${changeId} locally?`,
    options.yes,
  );
  await runGit(commitArgs, { cwd: repository.root, stdin: "inherit" });

  const after = (await runGit(["rev-parse", "HEAD"], { cwd: repository.root })).stdout;
  const amendedChangeId = await getHeadChangeId(repository.root);
  if (amendedChangeId !== changeId) {
    throw new CliError("CHANGE_ID_CHANGED", "The amended commit did not preserve its Change-Id.", {
      hints: [
        `Expected: ${changeId}`,
        `Found: ${amendedChangeId ?? "none"}`,
        "Restore the original Change-Id before uploading a new Patch Set.",
      ],
    });
  }

  const amended = { ...data, dryRun: false, after };
  if (!options.review) {
    if (output.json) output.result("amend", amended);
    else {
      output.heading("Amend completed");
      output.note("HEAD was amended locally with the original Change-Id.", "success");
      output.rows([
        { label: "Before", value: before },
        { label: "After", value: after },
        { label: "Next", value: `gerrit review --target ${repository.targetBranch}` },
      ]);
    }
    return amended;
  }

  if (!output.json) {
    output.heading("Amend completed");
    output.note(
      "HEAD was amended with the original Change-Id; uploading the new Patch Set.",
      "success",
    );
  }
  const reviewOutput: Output = output.json
    ? {
        ...output,
        result(_command, review) {
          output.result("amend", { ...amended, review });
        },
      }
    : output;
  const review = await runReview(global, reviewOutput, overrides, undefined, {
    reviewer: [],
    cc: [],
    dryRun: false,
    yes: true,
    sync: false,
  });
  return { ...amended, review };
};
