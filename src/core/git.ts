import { CliError } from "./errors.js";
import { runCommand } from "./process.js";

export interface GitOptions {
  cwd: string;
  allowFailure?: boolean;
  stdin?: "ignore" | "inherit";
}

/** Runs Git with argument boundaries preserved and returns trimmed process output. */
export const runGit = (args: string[], options: GitOptions) => runCommand("git", args, options);

/** Resolves the repository root for a working directory. */
export const getRepositoryRoot = async (cwd: string) => {
  const result = await runGit(["rev-parse", "--show-toplevel"], {
    cwd,
    allowFailure: true,
  });

  if (result.exitCode !== 0 || !result.stdout) {
    throw new CliError("NOT_A_GIT_REPOSITORY", "No Git repository was found.", {
      hints: ["Run this command inside a Git working tree or pass --cwd <path>."],
    });
  }

  return result.stdout;
};

/** Returns the current symbolic branch and rejects detached HEAD. */
export const getCurrentBranch = async (cwd: string) => {
  const result = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd,
    allowFailure: true,
  });

  if (result.exitCode !== 0 || !result.stdout) {
    throw new CliError("DETACHED_HEAD", "The repository is in detached HEAD state.", {
      hints: ["Check out a local branch before syncing or pushing a review."],
    });
  }

  return result.stdout;
};

/** Reads a Git configuration value without treating a missing key as an error. */
export const getGitConfig = async (cwd: string, key: string) => {
  const result = await runGit(["config", "--get", key], { cwd, allowFailure: true });
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
};
