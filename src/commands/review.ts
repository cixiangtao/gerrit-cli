import type { GlobalOptions, SyncStrategy } from "../types.js";
import { CliError } from "../core/errors.js";
import { runGit } from "../core/git.js";
import type { Output } from "../core/output.js";
import { formatCommand } from "../core/process.js";
import { buildReviewRefspec, parseAccounts } from "../core/refspec.js";
import {
  assertRepositoryReady,
  getHeadChangeId,
  getOutgoingCommits,
  getRemoteBranchesContainingCommit,
  type RepositoryOverrides,
} from "../core/repository.js";
import { deriveWebUrl } from "../core/remote.js";
import { confirmWrite, resolveRuntime, syncRepository } from "./shared.js";

export interface ReviewOptions {
  reviewer: string[];
  cc: string[];
  topic?: string;
  wip?: boolean;
  ready?: boolean;
  notify?: string;
  dryRun: boolean;
  yes: boolean;
  sync: boolean;
  syncStrategy?: SyncStrategy;
}

export const runReview = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
  positionalReviewers: string | undefined,
  options: ReviewOptions,
) => {
  const { config, repository } = await resolveRuntime(global, output, overrides);
  await assertRepositoryReady(repository.root);
  const reviewers = parseAccounts([
    ...config.reviewers,
    ...(positionalReviewers ? [positionalReviewers] : []),
    ...options.reviewer,
  ]);
  const cc = parseAccounts([...config.cc, ...options.cc]);
  const refspec = buildReviewRefspec({
    targetBranch: repository.targetBranch,
    reviewers,
    cc,
    ...(options.topic ? { topic: options.topic } : {}),
    ...(options.wip !== undefined ? { wip: options.wip } : {}),
    ...(options.ready !== undefined ? { ready: options.ready } : {}),
    ...(options.notify ? { notify: options.notify } : {}),
  });
  const pushArgs = ["push", repository.remote, refspec];
  const pushCommand = formatCommand("git", pushArgs);

  if (options.dryRun) {
    const data = {
      dryRun: true,
      repositoryRoot: repository.root,
      branch: repository.branch,
      remote: repository.remote,
      targetBranch: repository.targetBranch,
      sync: options.sync,
      syncStrategy: options.syncStrategy ?? repository.syncStrategy,
      reviewers,
      cc,
      refspec,
      pushCommand,
    };
    if (output.json) output.result("review", data);
    else {
      output.heading("Review preview");
      output.note("No fetch, history update, or push will be performed (--dry-run).", "warning");
      output.blank();
      output.rows([
        { label: "Source", value: repository.branch },
        { label: "Target", value: `${repository.remote}/${repository.targetBranch}` },
        {
          label: "Sync",
          value: options.sync ? (options.syncStrategy ?? repository.syncStrategy) : "disabled",
          tone: options.sync ? "default" : "muted",
        },
        {
          label: "Reviewers",
          value: reviewers.length > 0 ? reviewers.join(", ") : "none",
          tone: reviewers.length > 0 ? "default" : "muted",
        },
        {
          label: "CC",
          value: cc.length > 0 ? cc.join(", ") : "none",
          tone: cc.length > 0 ? "default" : "muted",
        },
      ]);
      output.blank();
      output.note("Command", "muted");
      output.command(pushCommand);
    }
    return data;
  }

  let syncResult;
  if (options.sync) {
    syncResult = await syncRepository(
      repository,
      options.syncStrategy ?? repository.syncStrategy,
      false,
    );
  } else {
    await runGit(["fetch", repository.remote, repository.targetBranch], {
      cwd: repository.root,
      stdin: "inherit",
    });
  }

  const commits = await getOutgoingCommits(repository.root, "FETCH_HEAD");
  if (commits.length === 0) {
    throw new CliError("NO_NEW_CHANGES", "There are no commits to submit for review.", {
      hints: [
        "Gerrit may already know the current patch set.",
        "Do not create or amend commits solely to bypass this check.",
      ],
    });
  }
  const publishedBranches = (
    await getRemoteBranchesContainingCommit(repository.root, repository.remote, "HEAD")
  ).filter((branch) => branch !== `${repository.remote}/${repository.targetBranch}`);
  if (publishedBranches.length > 0) {
    throw new CliError(
      "NO_NEW_CHANGES",
      "HEAD is already published on another remote branch, so Gerrit cannot create a new change.",
      {
        hints: [
          `Known remote branch${publishedBranches.length === 1 ? "" : "es"}: ${publishedBranches.join(", ")}`,
          "A fast-forward merge reuses the published commits without creating a reviewable merge commit.",
          "If the branch integration needs review, start again from the target branch and run gerrit merge.",
        ],
      },
    );
  }
  const missingChangeIds = commits.filter((commit) => !commit.changeId);
  if (missingChangeIds.length > 0) {
    throw new CliError(
      "MISSING_CHANGE_ID",
      "Outgoing commits are missing Gerrit Change-Id trailers.",
      {
        hints: [
          ...missingChangeIds.map((commit) => `${commit.oid.slice(0, 8)} ${commit.subject}`),
          "Run gerrit setup, then amend the affected commits intentionally.",
        ],
      },
    );
  }

  await confirmWrite(
    `Push ${commits.length} commit(s) to ${repository.remote}/${repository.targetBranch}?`,
    options.yes,
  );
  const push = await runGit(pushArgs, {
    cwd: repository.root,
    stdin: "inherit",
    allowFailure: true,
  });
  if (push.exitCode !== 0) {
    const combined = [push.stdout, push.stderr].filter(Boolean).join("\n");
    if (/no new changes/i.test(combined)) {
      throw new CliError("NO_NEW_CHANGES", "Gerrit rejected the push: no new changes.", {
        hints: [
          "The patch set is already known to Gerrit.",
          "Create a new reviewable commit only when the project history genuinely requires it.",
        ],
      });
    }
    throw new CliError("REVIEW_PUSH_FAILED", "Gerrit review push failed.", {
      hints: combined ? [combined] : [],
    });
  }

  const changeId = await getHeadChangeId(repository.root);
  const webUrl = config.webUrl ?? deriveWebUrl(repository.remoteUrl);
  const reviewUrl = changeId ? `${webUrl.replace(/\/$/, "")}/q/${changeId}` : undefined;
  const data = {
    dryRun: false,
    branch: repository.branch,
    remote: repository.remote,
    targetBranch: repository.targetBranch,
    commits,
    reviewers,
    cc,
    refspec,
    pushOutput: [push.stdout, push.stderr].filter(Boolean).join("\n"),
    ...(syncResult ? { sync: syncResult } : {}),
    ...(changeId ? { changeId } : {}),
    ...(reviewUrl ? { reviewUrl } : {}),
  };
  if (output.json) output.result("review", data);
  else {
    output.heading("Review submitted");
    output.note(`Submitted ${commits.length} commit(s) for review.`, "success");
    if (reviewUrl) {
      output.blank();
      output.rows([{ label: "Review", value: reviewUrl }]);
    }
  }
  return data;
};
