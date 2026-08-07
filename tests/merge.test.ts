import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listMergeCandidates } from "../src/commands/merge.js";
import {
  addLocalCommit,
  createRepository,
  createSynchronizableRepository,
  git,
  run,
} from "./helpers.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectRoot, "dist", "cli.js");

const createDivergedBranches = async () => {
  const root = await createRepository();
  await git(root, "checkout", "-b", "feature/login");
  await addLocalCommit(root, "feature.txt");
  await git(root, "checkout", "main");
  await addLocalCommit(root, "main.txt");
  return root;
};

describe("merge command", () => {
  it("lists local and remote branches for the interactive picker", async () => {
    const root = await createRepository();
    await git(root, "branch", "feature/local");
    await git(root, "update-ref", "refs/remotes/origin/feature/remote", "HEAD");

    const candidates = await listMergeCandidates(root, "main");

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "feature/local", kind: "local" }),
        expect.objectContaining({ name: "origin/feature/remote", kind: "remote" }),
      ]),
    );
    expect(candidates.map(({ name }) => name)).not.toContain("main");
  });

  it("previews a merge without changing history", async () => {
    const root = await createDivergedBranches();
    const before = await git(root, "rev-parse", "HEAD");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "feature/login", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(await git(root, "rev-parse", "HEAD")).toBe(before);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: {
        action: "start",
        dryRun: true,
        target: "main",
        source: "feature/login",
        strategy: "no-ff",
        comparison: { relationship: "diverged", sourceCommits: 1, targetCommits: 1 },
      },
    });
  });

  it("renders the selected branches, relationship, commits, and command", async () => {
    const root = await createDivergedBranches();
    const result = await run(
      process.execPath,
      [cliPath, "-C", root, "merge", "feature/login", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("◆ Merge preview");
    expect(result.stdout).toContain("Into          main");
    expect(result.stdout).toContain("From          feature/login");
    expect(result.stdout).toContain("Relationship  diverged");
    expect(result.stdout).toContain("Incoming commits");
    expect(result.stdout).toContain("$ git merge --no-ff --no-edit --log feature/login");
  });

  it("creates an explicit merge commit when the relationship allows a fast-forward", async () => {
    const root = await createRepository();
    await git(root, "checkout", "-b", "feature/published");
    await addLocalCommit(root);
    await git(root, "checkout", "main");
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "feature/published", "--no-fetch", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: {
        strategy: "no-ff",
        comparison: { relationship: "fast-forward" },
        completed: true,
      },
    });
    expect(await git(root, "rev-list", "--parents", "-1", "HEAD")).toMatch(
      /^[0-9a-f]{40} [0-9a-f]{40} [0-9a-f]{40}$/,
    );
    expect(await git(root, "log", "-1", "--format=%B")).toContain("feat: add local.txt");
  });

  it("fetches remote branches by default before resolving the merge source", async () => {
    const { local, seed } = await createSynchronizableRepository();
    await git(seed, "checkout", "-b", "feature/remote");
    await addLocalCommit(seed, "remote-feature.txt");
    await git(seed, "push", "-u", "origin", "feature/remote");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "merge", "origin/feature/remote", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: {
        source: "origin/feature/remote",
        fetched: true,
        strategy: "no-ff",
        completed: true,
      },
    });
  });

  it("allows explicitly using existing refs without fetching", async () => {
    const root = await createRepository();
    await git(root, "checkout", "-b", "feature/local");
    await addLocalCommit(root);
    await git(root, "checkout", "main");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "feature/local", "--no-fetch", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: { dryRun: true, fetched: false },
    });
  });

  it("creates an explicit merge commit when branches have diverged", async () => {
    const root = await createDivergedBranches();
    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "feature/login", "--no-fetch", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: { completed: true },
    });
    expect(await git(root, "rev-list", "--parents", "-1", "HEAD")).toMatch(
      /^[0-9a-f]{40} [0-9a-f]{40} [0-9a-f]{40}$/,
    );
  });

  it("reports conflicts and can abort the in-progress merge", async () => {
    const root = await createRepository();
    await git(root, "checkout", "-b", "feature/conflict");
    await writeFile(join(root, "README.md"), "feature\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "feat: edit from feature");
    await git(root, "checkout", "main");
    await writeFile(join(root, "README.md"), "main\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "feat: edit from main");
    const before = await git(root, "rev-parse", "HEAD");

    const merge = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "feature/conflict", "--no-fetch", "--yes"],
      projectRoot,
    );
    expect(merge.exitCode).toBe(1);
    expect(JSON.parse(merge.stdout)).toMatchObject({
      ok: false,
      error: { code: "MERGE_CONFLICT" },
    });

    const abort = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "--abort", "--yes"],
      projectRoot,
    );
    expect(abort.exitCode).toBe(0);
    expect(JSON.parse(abort.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: { action: "abort", completed: true },
    });
    expect(await git(root, "rev-parse", "HEAD")).toBe(before);
    expect(await git(root, "status", "--porcelain=v1")).toBe("");
  });

  it("continues after conflicts are resolved and staged", async () => {
    const root = await createRepository();
    await git(root, "config", "core.editor", "true");
    await git(root, "checkout", "-b", "feature/conflict");
    await writeFile(join(root, "README.md"), "feature\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "feat: edit from feature");
    await git(root, "checkout", "main");
    await writeFile(join(root, "README.md"), "main\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-m", "feat: edit from main");
    await run(
      process.execPath,
      [cliPath, "-C", root, "merge", "feature/conflict", "--no-fetch", "--yes"],
      projectRoot,
    );
    await writeFile(join(root, "README.md"), "resolved\n");
    await git(root, "add", "README.md");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", root, "merge", "--continue", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "merge",
      data: { action: "continue", completed: true },
    });
    expect(await git(root, "rev-list", "--parents", "-1", "HEAD")).toMatch(
      /^[0-9a-f]{40} [0-9a-f]{40} [0-9a-f]{40}$/,
    );
  });
});
