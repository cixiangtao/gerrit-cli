import { CliError } from "./errors.js";

const ACCOUNT_PATTERN = /^[A-Za-z0-9._@+-]+$/;
const TOPIC_PATTERN = /^[A-Za-z0-9._/-]+$/;
const NOTIFY_VALUES = new Set(["NONE", "OWNER", "OWNER_REVIEWERS", "ALL"]);

export interface ReviewPushOptions {
  targetBranch: string;
  reviewers: string[];
  cc: string[];
  topic?: string;
  wip?: boolean;
  ready?: boolean;
  notify?: string;
}

/** Parses comma-separated account arguments while preserving first-seen order. */
export const parseAccounts = (values: string[]) => {
  const accounts = [
    ...new Set(values.flatMap((value) => value.split(",")).map((value) => value.trim())),
  ].filter(Boolean);
  const invalid = accounts.filter((account) => !ACCOUNT_PATTERN.test(account));
  if (invalid.length > 0) {
    throw new CliError("INVALID_ACCOUNT", `Invalid Gerrit account: ${invalid.join(", ")}.`, {
      hints: ["Accounts may contain letters, numbers, dots, underscores, @, +, and hyphens."],
    });
  }
  return accounts;
};

/** Builds a Gerrit refs/for refspec without invoking a shell. */
export const buildReviewRefspec = ({
  targetBranch,
  reviewers,
  cc,
  topic,
  wip,
  ready,
  notify,
}: ReviewPushOptions) => {
  if (wip && ready) {
    throw new CliError("CONFLICTING_OPTIONS", "--wip and --ready cannot be used together.");
  }
  if (topic && !TOPIC_PATTERN.test(topic)) {
    throw new CliError("INVALID_TOPIC", `Invalid Gerrit topic: ${topic}.`, {
      hints: ["Topics may contain letters, numbers, dots, underscores, slashes, and hyphens."],
    });
  }
  if (notify && !NOTIFY_VALUES.has(notify)) {
    throw new CliError("INVALID_NOTIFY", `Invalid notify value: ${notify}.`, {
      hints: ["Use one of: NONE, OWNER, OWNER_REVIEWERS, ALL."],
    });
  }

  const pushOptions = [
    ...reviewers.map((reviewer) => `r=${reviewer}`),
    ...cc.map((account) => `cc=${account}`),
    ...(topic ? [`topic=${topic}`] : []),
    ...(wip ? ["wip"] : []),
    ...(ready ? ["ready"] : []),
    ...(notify ? [`notify=${notify}`] : []),
  ];
  const suffix = pushOptions.length > 0 ? `%${pushOptions.join(",")}` : "";
  return `HEAD:refs/for/${targetBranch}${suffix}`;
};
