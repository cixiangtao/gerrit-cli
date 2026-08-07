import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { addReviewCommit, createSynchronizableRepository, git, run } from "./helpers.js";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectRoot, "dist", "cli.js");

describe("amend command", () => {
  it("previews staged changes without rewriting HEAD or pushing", async () => {
    const { local } = await createSynchronizableRepository();
    await addReviewCommit(local);
    await writeFile(join(local, "feature.txt"), "updated\n");
    await git(local, "add", "feature.txt");
    const beforeHead = await git(local, "rev-parse", "HEAD");
    const beforeIndex = await git(local, "diff", "--cached");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(await git(local, "rev-parse", "HEAD")).toBe(beforeHead);
    expect(await git(local, "diff", "--cached")).toBe(beforeIndex);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "amend",
      data: {
        dryRun: true,
        changeId: "Iabcdef0123456789abcdef0123456789abcdef01",
        upload: true,
        staged: ["M\tfeature.txt"],
      },
    });
  });

  it("preserves the Change-Id and uploads a new Patch Set by default", async () => {
    const { local, remote } = await createSynchronizableRepository();
    await writeFile(
      join(local, ".gerrit-cli.json"),
      `${JSON.stringify({ webUrl: "https://gerrit.example.com" }, null, 2)}\n`,
    );
    await git(local, "add", ".gerrit-cli.json");
    await git(local, "commit", "-m", "test: configure Gerrit web URL");
    await git(local, "push", "origin", "main");
    await addReviewCommit(local);
    const before = await git(local, "rev-parse", "HEAD");
    await writeFile(join(local, "feature.txt"), "updated\n");
    await git(local, "add", "feature.txt");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--yes"],
      projectRoot,
    );
    const data = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(data).toMatchObject({
      ok: true,
      command: "amend",
      data: {
        before,
        changeId: "Iabcdef0123456789abcdef0123456789abcdef01",
        review: expect.objectContaining({ targetBranch: "main" }),
      },
    });
    expect(data.data.after).not.toBe(before);
    expect(await git(local, "log", "-1", "--format=%B")).toContain(
      "Change-Id: Iabcdef0123456789abcdef0123456789abcdef01",
    );
    expect(await git(local, "status", "--porcelain=v1")).toBe("");
    expect(await git(remote, "rev-parse", "refs/for/main")).toBe(data.data.after);
    expect(await readFile(join(local, "feature.txt"), "utf8")).toBe("updated\n");
  });

  it("can amend locally without uploading", async () => {
    const { local, remote } = await createSynchronizableRepository();
    await addReviewCommit(local);
    await writeFile(join(local, "feature.txt"), "local-only\n");
    await git(local, "add", "feature.txt");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--no-review", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "amend",
      data: { upload: false },
    });
    const reviewRef = await run("git", ["rev-parse", "--verify", "refs/for/main"], remote);
    expect(reviewRef.exitCode).toBe(128);
  });

  it("rejects unstaged or untracked changes", async () => {
    const { local } = await createSynchronizableRepository();
    await addReviewCommit(local);
    await writeFile(join(local, "feature.txt"), "unstaged\n");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--yes"],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "UNSTAGED_CHANGES" },
    });
  });

  it("regenerates a merge commit body and preserves its Change-Id", async () => {
    const { local } = await createSynchronizableRepository();
    await git(local, "switch", "-c", "feature/merge-log");
    await writeFile(join(local, "one.txt"), "one\n");
    await git(local, "add", "one.txt");
    await git(local, "commit", "-m", "feat: add one");
    await writeFile(join(local, "two.txt"), "two\n");
    await git(local, "add", "two.txt");
    await git(local, "commit", "-m", "fix: add two");
    await git(local, "switch", "main");
    await git(
      local,
      "merge",
      "--no-ff",
      "-m",
      "Merge branch 'feature/merge-log'\nChange-Id: I1111111111111111111111111111111111111111",
      "feature/merge-log",
    );
    const before = await git(local, "rev-parse", "HEAD");
    const beforeParents = await git(local, "show", "-s", "--format=%P", "HEAD");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--merge-log", "--no-review", "--yes"],
      projectRoot,
    );
    const data = JSON.parse(result.stdout);
    const message = await git(local, "log", "-1", "--format=%B");

    expect(result.exitCode).toBe(0);
    expect(data).toMatchObject({
      ok: true,
      command: "amend",
      data: {
        before,
        mergeLog: true,
        upload: false,
        includedCommits: [{ subject: "feat: add one" }, { subject: "fix: add two" }],
      },
    });
    expect(data.data.after).not.toBe(before);
    expect(await git(local, "show", "-s", "--format=%P", "HEAD")).toBe(beforeParents);
    expect(message).toContain("Included commits:\n");
    expect(message).toMatch(/^Merge branch 'feature\/merge-log'\n\nIncluded commits:/);
    expect(message).toContain("feat: add one");
    expect(message).toContain("fix: add two");
    expect(message).toContain("Change-Id: I1111111111111111111111111111111111111111");
    expect(message.match(/Change-Id:/g)).toHaveLength(1);
  });

  it("previews a generated merge body without rewriting HEAD", async () => {
    const { local } = await createSynchronizableRepository();
    await git(local, "switch", "-c", "feature/merge-preview");
    await writeFile(join(local, "preview.txt"), "preview\n");
    await git(local, "add", "preview.txt");
    await git(local, "commit", "-m", "feat: preview merge summary");
    await git(local, "switch", "main");
    await git(
      local,
      "merge",
      "--no-ff",
      "-m",
      "Merge branch 'feature/merge-preview'\n\nChange-Id: I2222222222222222222222222222222222222222",
      "feature/merge-preview",
    );
    const before = await git(local, "rev-parse", "HEAD");

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--merge-log", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(0);
    expect(await git(local, "rev-parse", "HEAD")).toBe(before);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "amend",
      data: {
        dryRun: true,
        mergeLog: true,
        includedCommits: [{ subject: "feat: preview merge summary" }],
      },
    });
  });

  it("requires a merge commit when regenerating the merge log", async () => {
    const { local } = await createSynchronizableRepository();
    await addReviewCommit(local);

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--merge-log", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "MERGE_COMMIT_REQUIRED" },
    });
  });

  it("rejects automatic and manual message updates together", async () => {
    const { local } = await createSynchronizableRepository();
    await addReviewCommit(local);

    const result = await run(
      process.execPath,
      [cliPath, "--json", "-C", local, "amend", "--merge-log", "--edit-message", "--dry-run"],
      projectRoot,
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "CONFLICTING_AMEND_OPTIONS" },
    });
  });
});
