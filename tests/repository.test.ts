import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/core/config.js";
import { inspectHook } from "../src/core/hooks.js";
import {
  getAheadBehind,
  getOutgoingCommits,
  resolveRepositoryContext,
} from "../src/core/repository.js";
import { addReviewCommit, createRepository, git } from "./helpers.js";

describe("repository inspection", () => {
  it("resolves tracking metadata and outgoing Change-Ids", async () => {
    const root = await createRepository();
    await addReviewCommit(root);
    const config = await loadConfig(root);
    const repository = await resolveRepositoryContext(root, config);

    expect(repository.remote).toBe("origin");
    expect(repository.targetBranch).toBe("main");
    await expect(getAheadBehind(root, "origin/main")).resolves.toEqual({ ahead: 1, behind: 0 });
    await expect(getOutgoingCommits(root, "origin/main")).resolves.toMatchObject([
      { subject: "feat: add feature", changeId: "Iabcdef0123456789abcdef0123456789abcdef01" },
    ]);
  });

  it("recognizes a Husky-style bridge to the stored Gerrit hook", async () => {
    const root = await createRepository();
    const storedHook = join(root, ".git", "hooks", "commit-msg");
    const activeHook = join(root, ".husky", "commit-msg");
    await mkdir(join(root, ".husky"), { recursive: true });
    await writeFile(storedHook, "#!/bin/sh\n# Gerrit Change-Id\n");
    await writeFile(activeHook, '#!/bin/sh\n.git/hooks/commit-msg "$1"\n');
    await Promise.all([chmod(storedHook, 0o755), chmod(activeHook, 0o755)]);
    await git(root, "config", "core.hooksPath", ".husky");

    await expect(inspectHook(root)).resolves.toMatchObject({
      installed: true,
      active: true,
      bridged: true,
      ready: true,
    });
  });

  it("does not treat a .git/hooks bridge as valid inside a linked worktree", async () => {
    const root = await createRepository();
    const worktree = `${root}-worktree`;
    const storedHook = join(root, ".git", "hooks", "commit-msg");
    await writeFile(storedHook, "#!/bin/sh\n# Gerrit Change-Id\n");
    await chmod(storedHook, 0o755);
    await git(root, "config", "core.hooksPath", ".husky");
    await git(root, "worktree", "add", "-b", "worktree-test", worktree);
    await mkdir(join(worktree, ".husky"), { recursive: true });
    const activeHook = join(worktree, ".husky", "commit-msg");
    await writeFile(activeHook, '#!/bin/sh\n.git/hooks/commit-msg "$1"\n');
    await chmod(activeHook, 0o755);

    await expect(inspectHook(worktree)).resolves.toMatchObject({
      installed: true,
      active: true,
      bridged: false,
      ready: false,
    });
  });
});
