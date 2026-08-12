import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  addReviewCommit,
  createRepository,
  createSynchronizableRepository,
  git,
  run,
} from "./helpers.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectRoot, "dist", "cli.js");

describe("CLI", () => {
  it("shows the complete command surface", async () => {
    const version = await run(process.execPath, [cliPath, "--version"], projectRoot);
    const result = await run(process.execPath, [cliPath, "--help"], projectRoot);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Gerrit CLI v${version.stdout}`);
    expect(result.stdout).toContain("Usage: gerrit");
    expect(result.stdout).toContain("doctor");
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("merge");
    expect(result.stdout).toContain("amend");
    expect(result.stdout).toContain("review");
  });

  it("shows help for a bare command outside a TTY", async () => {
    const result = await run(process.execPath, [cliPath], projectRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: gerrit");
    expect(result.stdout).toContain("Commands:");
  });

  it("keeps review dry-run read-only and returns a stable JSON envelope", async () => {
    const root = await createRepository();
    await addReviewCommit(root);
    const before = await git(root, "show-ref");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "review", "alice,bob", "--dry-run"],
      projectRoot,
    );
    const after = await git(root, "show-ref");

    expect(result.exitCode).toBe(0);
    expect(after).toBe(before);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "review",
      data: {
        dryRun: true,
        reviewers: ["alice", "bob"],
        refspec: "HEAD:refs/for/main%r=alice,r=bob",
      },
    });
  });

  it("formats repository status as aligned information and readiness sections", async () => {
    const root = await createRepository();
    const result = await run(process.execPath, [cliPath, "-C", root, "status"], projectRoot);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("◆ Repository status");
    expect(result.stdout).toContain("Repository  ");
    expect(result.stdout).toMatch(/Gerrit\s+detected \(ssh-port\)/);
    expect(result.stdout).toContain(
      "Project URL  https://gerrit.example.com/admin/repos/example/project",
    );
    expect(result.stdout).toContain("✓ Worktree");
    expect(result.stdout).toContain("! Change-Id");
    expect(result.stdout).toContain("↑ 0 ahead  ↓ 0 behind");
  });

  it.each([
    ["status", ["status"]],
    ["open", ["open", "--print"]],
    ["setup", ["setup", "--dry-run"]],
    ["sync", ["sync", "--dry-run"]],
    ["review", ["review", "--dry-run"]],
    ["amend", ["amend", "--dry-run"]],
    ["merge", ["merge", "main", "--dry-run", "--no-fetch"]],
  ])("rejects %s before running in a repository without Gerrit evidence", async (_name, args) => {
    const root = await createRepository();
    await git(root, "remote", "set-url", "origin", "https://github.com/example/project.git");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, ...args],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "NOT_A_GERRIT_REPOSITORY",
        message: "The configured remote is not identifiable as Gerrit.",
        hints: expect.arrayContaining(["Remote: https://github.com/example/project.git"]),
      },
    });
  });

  it("prints the current Gerrit project homepage without requiring a HEAD Change-Id", async () => {
    const root = await createRepository();
    await git(root, "commit", "--amend", "-m", "chore: initial without change id");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "open", "--print"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "open",
      data: {
        changeId: null,
        url: "https://gerrit.example.com/admin/repos/example/project",
        dryRun: true,
      },
    });
  });

  it("distinguishes skipped doctor checks from successful checks", async () => {
    const root = await createRepository();
    const result = await run(
      process.execPath,
      [cliPath, "-C", root, "doctor", "--offline"],
      projectRoot,
    );

    expect(result.stdout).toContain("◆ Diagnostics");
    expect(result.stdout).toContain("– SSH");
    expect(result.stdout).toContain("skipped (--offline)");
    expect(result.stdout).toContain("4 passed · 1 skipped · 1 failed");
  });

  it("reports Gerrit detection as a doctor check instead of exiting before diagnostics", async () => {
    const root = await createRepository();
    await git(root, "remote", "set-url", "origin", "https://github.com/example/project.git");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "doctor", "--offline"],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "doctor",
      data: {
        healthy: false,
        checks: expect.arrayContaining([
          {
            name: "gerrit",
            ok: false,
            message: "not identified from local configuration",
          },
          {
            name: "ssh",
            ok: true,
            skipped: true,
            message: "skipped (not identified as Gerrit)",
          },
        ]),
      },
    });
  });

  it("makes review dry-run safety and the resulting command visually explicit", async () => {
    const root = await createRepository();
    await addReviewCommit(root);
    const result = await run(
      process.execPath,
      [cliPath, "-C", root, "review", "alice", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("◆ Review preview");
    expect(result.stdout).toContain("No fetch, history update, or push will be performed");
    expect(result.stdout).toContain("Reviewers  alice");
    expect(result.stdout).toContain("$ git push origin HEAD:refs/for/main%r=alice");
  });

  it("rejects a fast-forwarded HEAD that is already published on another remote branch", async () => {
    const { local, seed } = await createSynchronizableRepository();
    await git(seed, "checkout", "-b", "feature/published");
    await addReviewCommit(seed);
    await git(seed, "push", "-u", "origin", "feature/published");
    await git(local, "fetch", "origin");
    await git(local, "merge", "--ff-only", "origin/feature/published");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "review", "--no-sync", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: {
        code: "NO_NEW_CHANGES",
        message:
          "HEAD is already published on another remote branch, so Gerrit cannot create a new change.",
        hints: [
          "Known remote branch: origin/feature/published",
          expect.stringContaining("fast-forward merge"),
          expect.stringContaining("gerrit merge"),
        ],
      },
    });
  });

  it("keeps setup dry-run read-only", async () => {
    const root = await createRepository();
    const hookPath = join(root, ".git", "hooks", "commit-msg");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "setup", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "setup",
      data: { dryRun: true },
    });
    await expect(access(hookPath)).rejects.toThrow();
  });

  it("rejects a dirty worktree before constructing a review write", async () => {
    const root = await createRepository();
    await writeFile(join(root, "dirty.txt"), "dirty\n");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "review", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "DIRTY_WORKTREE" },
    });
  });

  it("returns argument errors as JSON when requested", async () => {
    const result = await run(
      process.execPath,
      [cliPath, "--json", "sync", "--sync-strategy", "unknown"],
      projectRoot,
    );
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
  });

  it("keeps the package and binary versions aligned", async () => {
    const packageJson = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
    const result = await run(process.execPath, [cliPath, "--version"], projectRoot);
    expect(packageJson).toMatchObject({
      name: "@anys/gerrit-cli",
      bin: { gerrit: "dist/cli.js" },
    });
    expect(result.stdout).toBe(packageJson.version);
  });
});
