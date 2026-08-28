import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/core/config.js";
import { inspectHook, installHook } from "../src/core/hooks.js";
import {
  getAheadBehind,
  getOutgoingCommits,
  getRemoteBranchesContainingCommit,
  resolveRepositoryContext,
} from "../src/core/repository.js";
import { addReviewCommit, createRepository, git, run } from "./helpers.js";

describe("repository inspection", () => {
  it("loads repository configuration from .gerrit-cli.json", async () => {
    const root = await createRepository();
    await writeFile(
      join(root, ".gerrit-cli.json"),
      `${JSON.stringify(
        {
          cloneBaseUrl: "ssh://alice@gerrit.example.com:29418",
          targetBranch: "develop",
          syncStrategy: "rebase",
        },
        null,
        2,
      )}\n`,
    );

    await expect(
      loadConfig(root, join(root, ".missing-global-config.json")),
    ).resolves.toMatchObject({
      cloneBaseUrl: "ssh://alice@gerrit.example.com:29418",
      targetBranch: "develop",
      syncStrategy: "rebase",
      sources: [join(root, ".gerrit-cli.json")],
    });
  });

  it("does not load the former .gerrit-flow.json filename", async () => {
    const root = await createRepository();
    await writeFile(join(root, ".gerrit-flow.json"), "not valid JSON\n");

    await expect(
      loadConfig(root, join(root, ".missing-global-config.json")),
    ).resolves.toMatchObject({ syncStrategy: "ff-only" });
  });

  it("resolves tracking metadata and outgoing Change-Ids", async () => {
    const root = await createRepository();
    await addReviewCommit(root);
    const config = await loadConfig(root, join(root, ".missing-global-config.json"));
    const repository = await resolveRepositoryContext(root, config);

    expect(repository.remote).toBe("origin");
    expect(repository.targetBranch).toBe("main");
    await expect(getAheadBehind(root, "origin/main")).resolves.toEqual({ ahead: 1, behind: 0 });
    await expect(getOutgoingCommits(root, "origin/main")).resolves.toMatchObject([
      { subject: "feat: add feature", changeId: "Iabcdef0123456789abcdef0123456789abcdef01" },
    ]);
  });

  it("finds remote branches that already contain a commit", async () => {
    const root = await createRepository();
    await git(root, "checkout", "-b", "feature/published");
    await addReviewCommit(root);
    await git(root, "update-ref", "refs/remotes/origin/feature/published", "HEAD");

    await expect(getRemoteBranchesContainingCommit(root, "origin", "HEAD")).resolves.toEqual([
      "origin/feature/published",
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

  it("composes an existing Husky hook without replacing its commands", async () => {
    const root = await createRepository();
    const storedHook = join(root, ".git", "hooks", "commit-msg");
    const activeHook = join(root, ".husky", "commit-msg");
    const messageFile = join(root, "COMMIT_EDITMSG");
    const existingContent = `#!/bin/sh\nprintf 'existing\\n' >> "$1"\n`;
    await mkdir(join(root, ".husky"), { recursive: true });
    await writeFile(storedHook, `#!/bin/sh\n# Gerrit Change-Id\nprintf 'gerrit\\n' >> "$1"\n`);
    await writeFile(activeHook, existingContent);
    await writeFile(messageFile, "message\n");
    await chmod(storedHook, 0o755);
    await git(root, "config", "core.hooksPath", ".husky");

    await installHook(root, "ssh://test@gerrit.example.com:29418/example/project", {
      dryRun: false,
      refresh: false,
    });
    const firstInstall = await readFile(activeHook, "utf8");
    await installHook(root, "ssh://test@gerrit.example.com:29418/example/project", {
      dryRun: false,
      refresh: false,
    });

    expect(firstInstall).toContain(existingContent);
    expect(firstInstall).toContain("# gerrit-cli:start");
    expect(firstInstall).toContain("git rev-parse --git-common-dir");
    expect(await readFile(activeHook, "utf8")).toBe(firstInstall);
    expect((await stat(activeHook)).mode & 0o111).not.toBe(0);
    await expect(run(activeHook, [messageFile], root)).resolves.toMatchObject({ exitCode: 0 });
    await expect(readFile(messageFile, "utf8")).resolves.toBe("message\nexisting\ngerrit\n");
    await expect(inspectHook(root)).resolves.toMatchObject({
      installed: true,
      active: true,
      bridged: true,
      ready: true,
    });
  });

  it("previews automatic composition of an existing active hook", async () => {
    const root = await createRepository();
    const activeHook = join(root, ".husky", "commit-msg");
    await mkdir(join(root, ".husky"), { recursive: true });
    await writeFile(activeHook, '#!/bin/sh\npnpm exec commitlint --edit "$1"\n', { mode: 0o755 });
    await git(root, "config", "core.hooksPath", ".husky");

    await expect(
      installHook(root, "ssh://test@gerrit.example.com:29418/example/project", {
        dryRun: true,
        refresh: false,
      }),
    ).resolves.toMatchObject({
      dryRun: true,
      wouldDownload: true,
      wouldCreateActiveWrapper: false,
      wouldComposeActiveHook: true,
    });
    expect(await readFile(activeHook, "utf8")).not.toContain("gerrit-cli:start");
  });

  it("composes the project hook instead of Husky's generated dispatcher", async () => {
    const root = await createRepository();
    const storedHook = join(root, ".git", "hooks", "commit-msg");
    const dispatcherHook = join(root, ".husky", "_", "commit-msg");
    const runtimeHook = join(root, ".husky", "_", "h");
    const projectHook = join(root, ".husky", "commit-msg");
    const dispatcherContent = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n';
    const projectContent = 'pnpm exec commitlint --edit "$1"\n';
    await mkdir(join(root, ".husky", "_"), { recursive: true });
    await writeFile(storedHook, "#!/bin/sh\n# Gerrit Change-Id\n", { mode: 0o755 });
    await writeFile(dispatcherHook, dispatcherContent, { mode: 0o755 });
    await writeFile(runtimeHook, '#!/usr/bin/env sh\n[ "${HUSKY-}" = "0" ] && exit 0\n');
    await writeFile(projectHook, projectContent);
    await git(root, "config", "core.hooksPath", ".husky/_");

    await installHook(root, "ssh://test@gerrit.example.com:29418/example/project", {
      dryRun: false,
      refresh: false,
    });

    expect(await readFile(dispatcherHook, "utf8")).toBe(dispatcherContent);
    expect(await readFile(projectHook, "utf8")).toContain(projectContent);
    expect(await readFile(projectHook, "utf8")).toContain("# gerrit-cli:start");
    await expect(inspectHook(root)).resolves.toMatchObject({
      activePath: projectHook,
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
