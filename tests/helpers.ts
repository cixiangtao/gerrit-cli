import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHANGE_ID = "I0123456789abcdef0123456789abcdef01234567";

export const run = async (command: string, args: string[], cwd: string) => {
  try {
    const result = await execFileAsync(command, args, { cwd, encoding: "utf8" });
    return { exitCode: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "number" &&
      "stdout" in error &&
      "stderr" in error
    ) {
      return {
        exitCode: error.code,
        stdout: String(error.stdout).trim(),
        stderr: String(error.stderr).trim(),
      };
    }
    throw error;
  }
};

export const git = async (cwd: string, ...args: string[]) => {
  const result = await run("git", args, cwd);
  if (result.exitCode !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  return result.stdout;
};

export const createRepository = async () => {
  const root = await mkdtemp(join(tmpdir(), "gerrit-flow-test-"));
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Test User");
  await git(root, "config", "user.email", "test@example.com");
  await writeFile(join(root, "README.md"), "initial\n");
  await git(root, "add", "README.md");
  await git(root, "commit", "-m", `chore: initial\n\nChange-Id: ${CHANGE_ID}`);
  await git(root, "remote", "add", "origin", "ssh://test@gerrit.example.com:29418/example/project");
  await git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  await git(root, "branch", "--set-upstream-to=origin/main", "main");
  return root;
};

export const addReviewCommit = async (root: string) => {
  await writeFile(join(root, "feature.txt"), "feature\n");
  await git(root, "add", "feature.txt");
  await git(
    root,
    "commit",
    "-m",
    "feat: add feature\n\nChange-Id: Iabcdef0123456789abcdef0123456789abcdef01",
  );
};

export const createSynchronizableRepository = async () => {
  const base = await mkdtemp(join(tmpdir(), "gerrit-flow-sync-"));
  const remote = join(base, "remote.git");
  const seed = join(base, "seed");
  const local = join(base, "local");
  await git(base, "init", "--bare", remote);
  await git(base, "init", "-b", "main", seed);
  await git(seed, "config", "user.name", "Test User");
  await git(seed, "config", "user.email", "test@example.com");
  await writeFile(join(seed, "README.md"), "initial\n");
  await git(seed, "add", "README.md");
  await git(seed, "commit", "-m", "chore: initial");
  await git(seed, "remote", "add", "origin", remote);
  await git(seed, "push", "-u", "origin", "main");
  await git(base, "--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main");
  await git(base, "clone", remote, local);
  await git(local, "config", "user.name", "Test User");
  await git(local, "config", "user.email", "test@example.com");
  return { base, remote, seed, local };
};

export const addRemoteCommit = async (seed: string, name = "remote.txt") => {
  await writeFile(join(seed, name), `${name}\n`);
  await git(seed, "add", name);
  await git(seed, "commit", "-m", `feat: add ${name}`);
  await git(seed, "push", "origin", "main");
};

export const addLocalCommit = async (local: string, name = "local.txt") => {
  await writeFile(join(local, name), `${name}\n`);
  await git(local, "add", name);
  await git(local, "commit", "-m", `feat: add ${name}`);
};
