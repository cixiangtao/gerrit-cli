import { describe, expect, it } from "vitest";

import { syncRepository } from "../src/commands/shared.js";
import type { RepositoryContext } from "../src/core/repository.js";
import { addLocalCommit, addRemoteCommit, createSynchronizableRepository, git } from "./helpers.js";

const context = (root: string, remoteUrl: string): RepositoryContext => ({
  root,
  branch: "main",
  remote: "origin",
  remoteUrl,
  targetBranch: "main",
  upstream: "origin/main",
  syncStrategy: "ff-only",
});

describe("repository synchronization", () => {
  it("fast-forwards when the local branch is only behind", async () => {
    const { local, remote, seed } = await createSynchronizableRepository();
    await addRemoteCommit(seed);

    const result = await syncRepository(context(local, remote), "ff-only", false);

    expect(result.before).toEqual({ ahead: 0, behind: 1 });
    expect(result.after).toEqual({ ahead: 0, behind: 0 });
    await expect(git(local, "rev-parse", "HEAD")).resolves.toBe(
      await git(seed, "rev-parse", "HEAD"),
    );
  });

  it("does not rewrite a diverged branch under ff-only", async () => {
    const { local, remote, seed } = await createSynchronizableRepository();
    await addLocalCommit(local);
    await addRemoteCommit(seed);
    const before = await git(local, "rev-parse", "HEAD");

    await expect(syncRepository(context(local, remote), "ff-only", false)).rejects.toMatchObject({
      code: "DIVERGED_BRANCH",
    });
    await expect(git(local, "rev-parse", "HEAD")).resolves.toBe(before);
  });

  it("merges only when merge is selected explicitly", async () => {
    const { local, remote, seed } = await createSynchronizableRepository();
    await addLocalCommit(local);
    await addRemoteCommit(seed);

    const result = await syncRepository(context(local, remote), "merge", false);

    expect(result.after).toEqual({ ahead: 2, behind: 0 });
    await expect(git(local, "rev-list", "--parents", "-1", "HEAD")).resolves.toMatch(
      /^[0-9a-f]{40} [0-9a-f]{40} [0-9a-f]{40}$/,
    );
  });
});
