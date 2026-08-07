import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { addReviewCommit, createRepository, git, run } from "./helpers.js";

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
    expect(result.stdout).toContain("✓ Worktree");
    expect(result.stdout).toContain("! Change-Id");
    expect(result.stdout).toContain("↑ 0 ahead  ↓ 0 behind");
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
    expect(result.stdout).toContain("3 passed · 1 skipped · 1 failed");
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
