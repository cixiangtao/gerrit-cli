import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { CliError } from "./errors.js";
import { formatCommand, runCommand } from "./process.js";
import { getActiveHooksDirectory, getGitCommonDirectory, readHook } from "./repository.js";
import { parseGerritSshRemote } from "./remote.js";

const GERRIT_HOOK_MARKER = "Change-Id";
const BRIDGE_START_MARKER = "# gerrit-cli:start";
const BRIDGE_END_MARKER = "# gerrit-cli:end";
const createBridge = (exec = false) =>
  `${BRIDGE_START_MARKER}\nhook="$(git rev-parse --git-common-dir)/hooks/commit-msg"\n${exec ? "exec " : ""}"$hook" "$1"\n${BRIDGE_END_MARKER}\n`;

/** Resolves the project-owned hook behind Husky's generated dispatch directory when present. */
const resolveActiveHookPath = async (activeHooksDirectory: string) => {
  const dispatcherPath = join(activeHooksDirectory, "commit-msg");
  if (basename(activeHooksDirectory) !== "_") return dispatcherPath;

  const [dispatcherContent, runtimeContent] = await Promise.all([
    readHook(dispatcherPath),
    readHook(join(activeHooksDirectory, "h")),
  ]);
  const isHuskyDispatcher = Boolean(
    dispatcherContent?.includes('/h"') && runtimeContent?.includes("HUSKY"),
  );
  return isHuskyDispatcher ? join(dirname(activeHooksDirectory), "commit-msg") : dispatcherPath;
};

export interface HookStatus {
  installedPath: string;
  activePath: string;
  installed: boolean;
  /** Whether the project-owned active hook file already exists. */
  activeExists: boolean;
  active: boolean;
  bridged: boolean;
  ready: boolean;
}

const isExecutable = async (path: string) => {
  try {
    const value = await stat(path);
    return (value.mode & 0o111) !== 0;
  } catch {
    return false;
  }
};

const isDirectory = async (path: string) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/** Inspects both the stored Gerrit hook and Git's active hook path. */
export const inspectHook = async (root: string): Promise<HookStatus> => {
  const [commonDirectory, activeHooksDirectory] = await Promise.all([
    getGitCommonDirectory(root),
    getActiveHooksDirectory(root),
  ]);
  const installedPath = join(commonDirectory, "hooks", "commit-msg");
  const activePath = await resolveActiveHookPath(activeHooksDirectory);
  const [
    installedContent,
    activeContent,
    installedExecutable,
    activeExecutable,
    dotGitIsDirectory,
  ] = await Promise.all([
    readHook(installedPath),
    readHook(activePath),
    isExecutable(installedPath),
    isExecutable(activePath),
    isDirectory(join(root, ".git")),
  ]);
  const installed = Boolean(installedContent?.includes(GERRIT_HOOK_MARKER) && installedExecutable);
  const samePath = installedPath === activePath;
  const bridgeMarkers = [
    "gerrit hook run",
    installedPath,
    "--git-common-dir",
    ...(dotGitIsDirectory ? [".git/hooks/commit-msg"] : []),
  ];
  const bridged = Boolean(
    samePath || (activeContent && bridgeMarkers.some((marker) => activeContent.includes(marker))),
  );
  const activeExists = activeContent !== undefined;
  const active = Boolean(activeContent && activeExecutable);

  return {
    installedPath,
    activePath,
    installed,
    activeExists,
    active,
    bridged,
    ready: installed && active && bridged,
  };
};

const assertGerritHook = async (path: string) => {
  const content = await readFile(path, "utf8");
  if (!content.includes(GERRIT_HOOK_MARKER)) {
    throw new CliError("INVALID_HOOK", "The downloaded hook is not a Gerrit commit-msg hook.");
  }
};

/** Downloads the official hook and safely composes it with Git's active hook. */
export const installHook = async (
  root: string,
  remoteUrl: string,
  options: { dryRun: boolean; refresh: boolean },
) => {
  const before = await inspectHook(root);
  const remote = parseGerritSshRemote(remoteUrl);
  const wouldDownload = !before.installed || options.refresh;
  const scpArgs = [
    "-O",
    "-P",
    String(remote.port),
    "--",
    `${remote.user}@${remote.host}:hooks/commit-msg`,
    before.installedPath,
  ];

  if (options.dryRun) {
    const wouldCreateActiveWrapper =
      !before.activeExists && before.activePath !== before.installedPath;
    return {
      dryRun: true,
      command: wouldDownload ? formatCommand("scp", scpArgs) : null,
      wouldDownload,
      hook: before,
      wouldCreateActiveWrapper,
      wouldComposeActiveHook:
        before.activePath !== before.installedPath && before.activeExists && !before.bridged,
    };
  }

  const existingContent = await readHook(before.installedPath);
  if (existingContent && !existingContent.includes(GERRIT_HOOK_MARKER)) {
    throw new CliError("HOOK_CONFLICT", `A non-Gerrit hook exists at ${before.installedPath}.`, {
      hints: ["Move or compose the existing hook manually; gerrit will not overwrite it."],
    });
  }

  if (wouldDownload) {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "gerrit-cli-hook-"));
    const temporaryHook = join(temporaryDirectory, "commit-msg");
    try {
      const result = await runCommand(
        "scp",
        [
          "-O",
          "-P",
          String(remote.port),
          "--",
          `${remote.user}@${remote.host}:hooks/commit-msg`,
          temporaryHook,
        ],
        { cwd: root, stdin: "inherit", allowFailure: true },
      );
      if (result.exitCode !== 0) {
        throw new CliError("HOOK_DOWNLOAD_FAILED", "Unable to download the Gerrit hook.", {
          hints: [result.stderr || "Verify your SSH key, Gerrit user, host, and port."],
        });
      }
      await assertGerritHook(temporaryHook);
      await mkdir(dirname(before.installedPath), { recursive: true });
      await copyFile(temporaryHook, before.installedPath);
      await chmod(before.installedPath, 0o755);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  const afterInstall = await inspectHook(root);
  if (afterInstall.activePath !== afterInstall.installedPath) {
    await mkdir(dirname(afterInstall.activePath), { recursive: true });
    const activeContent = await readHook(afterInstall.activePath);
    if (!afterInstall.bridged) {
      const separator = activeContent?.endsWith("\n") ? "\n" : "\n\n";
      const nextContent = activeContent
        ? `${activeContent}${separator}${createBridge()}`
        : `#!/bin/sh\n${createBridge(true)}`;
      await writeFile(afterInstall.activePath, nextContent, { mode: 0o755 });
    }
    if (activeContent !== undefined || !afterInstall.bridged) {
      await chmod(afterInstall.activePath, 0o755);
    }
  }

  return {
    dryRun: false,
    command: formatCommand("scp", scpArgs),
    hook: await inspectHook(root),
    adapter: createBridge().trim(),
  };
};

/** Runs the installed Gerrit hook for composition from Husky or another hooks manager. */
export const runInstalledHook = async (root: string, messageFile: string) => {
  const { installedPath, installed } = await inspectHook(root);
  if (!installed) {
    throw new CliError("HOOK_NOT_INSTALLED", "The Gerrit commit-msg hook is not installed.", {
      hints: ["Run gerrit setup first."],
    });
  }
  const result = await runCommand(installedPath, [messageFile], {
    cwd: root,
    stdin: "inherit",
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    throw new CliError("HOOK_FAILED", "The Gerrit commit-msg hook failed.", {
      hints: [result.stderr].filter(Boolean),
    });
  }
};
