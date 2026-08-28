import { basename, resolve } from "node:path";

import { confirm, text } from "@clack/prompts";

import type { EffectiveConfig, GlobalOptions } from "../types.js";
import { configPaths, loadConfig, saveGlobalCloneBaseUrl } from "../core/config.js";
import { CliError } from "../core/errors.js";
import { getGitConfig, runGit } from "../core/git.js";
import type { Output } from "../core/output.js";
import { formatCommand } from "../core/process.js";
import {
  buildCloneUrl,
  deriveCloneBaseUrl,
  detectGerritRemote,
  normalizeProjectName,
} from "../core/remote.js";

export interface CloneOptions {
  baseUrl?: string;
  dryRun: boolean;
}

export type CloneBaseUrlSource = "flag" | "config" | "repository" | "prompt";

export interface CloneInteraction {
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  promptBaseUrl?: (project: string) => Promise<string | symbol>;
  confirmSave?: (baseUrl: string) => Promise<boolean | symbol>;
  saveBaseUrl?: (baseUrl: string) => Promise<string>;
}

interface CloneBaseUrlResolution {
  baseUrl: string;
  source: CloneBaseUrlSource;
  savedTo?: string;
}

const promptBaseUrl = (project: string) =>
  text({
    message: `Gerrit clone base URL for ${project}`,
    placeholder: "ssh://alice@gerrit.example.com:29418",
    validate: (value) => {
      try {
        buildCloneUrl(value, project);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : "Enter a valid Gerrit clone base URL.";
      }
    },
  });

const confirmSave = (baseUrl: string) =>
  confirm({
    message: `Save ${baseUrl} as the global clone base URL?`,
    initialValue: true,
    active: "Save",
    inactive: "Use once",
  });

/** Resolves first-use clone configuration without prompting in automation or mutating on dry-run. */
export const resolveCloneBaseUrl = async (
  project: string,
  candidates: {
    flag?: string;
    configured?: string;
    inferred?: string;
  },
  options: { dryRun: boolean; interactive: boolean },
  interaction: CloneInteraction = {},
): Promise<CloneBaseUrlResolution> => {
  if (candidates.flag) return { baseUrl: candidates.flag, source: "flag" };
  if (candidates.configured) return { baseUrl: candidates.configured, source: "config" };
  if (candidates.inferred) return { baseUrl: candidates.inferred, source: "repository" };

  if (!options.interactive) {
    throw new CliError("CLONE_URL_NOT_CONFIGURED", "No Gerrit clone base URL is configured.", {
      hints: [
        "Run gerrit clone interactively for first-time setup.",
        `Set cloneBaseUrl in ${configPaths.global}.`,
        "Or pass --base-url <url> for a one-off clone.",
      ],
    });
  }

  const entered = await (interaction.promptBaseUrl ?? promptBaseUrl)(project);
  if (typeof entered === "symbol") {
    throw new CliError("CANCELLED", "Operation cancelled.", { exitCode: 0 });
  }
  const baseUrl = entered.trim();
  buildCloneUrl(baseUrl, project);
  if (options.dryRun) return { baseUrl, source: "prompt" };

  const accepted = await (interaction.confirmSave ?? confirmSave)(baseUrl);
  if (typeof accepted === "symbol") {
    throw new CliError("CANCELLED", "Operation cancelled.", { exitCode: 0 });
  }
  if (!accepted) return { baseUrl, source: "prompt" };

  const savedTo = await (interaction.saveBaseUrl ?? saveGlobalCloneBaseUrl)(baseUrl);
  return { baseUrl, source: "prompt", savedTo };
};

/** Infers a clone base from the current branch's Gerrit remote when one is available. */
export const inferCloneBaseUrl = async (cwd: string, config: EffectiveConfig) => {
  const rootResult = await runGit(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true });
  if (rootResult.exitCode !== 0 || !rootResult.stdout) return undefined;

  const branchResult = await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: rootResult.stdout,
    allowFailure: true,
  });
  const branchRemote = branchResult.stdout
    ? await getGitConfig(rootResult.stdout, `branch.${branchResult.stdout}.remote`)
    : undefined;
  const remote = config.remote ?? branchRemote ?? "origin";
  const remoteResult = await runGit(["remote", "get-url", remote], {
    cwd: rootResult.stdout,
    allowFailure: true,
  });
  if (
    remoteResult.exitCode !== 0 ||
    !remoteResult.stdout ||
    !detectGerritRemote(remoteResult.stdout, config.webUrl)
  ) {
    return undefined;
  }

  try {
    return deriveCloneBaseUrl(remoteResult.stdout, config.webUrl);
  } catch {
    return undefined;
  }
};

const findRepositoryRoot = async (cwd: string) => {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd, allowFailure: true });
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
};

/** Clones a Gerrit project using a configured base URL while leaving authentication to Git. */
export const runClone = async (
  global: GlobalOptions,
  output: Output,
  project: string,
  directory: string | undefined,
  options: CloneOptions,
  interaction: CloneInteraction = {},
) => {
  const repositoryRoot = await findRepositoryRoot(global.cwd);
  const config = await loadConfig(repositoryRoot ?? global.cwd);
  const normalizedProject = normalizeProjectName(project);
  const configuredBaseUrl = config.cloneBaseUrl;
  const inferredBaseUrl =
    options.baseUrl || configuredBaseUrl ? undefined : await inferCloneBaseUrl(global.cwd, config);
  const configuredFallback = configuredBaseUrl ?? (inferredBaseUrl ? undefined : config.webUrl);
  const base = await resolveCloneBaseUrl(
    normalizedProject,
    {
      ...(options.baseUrl ? { flag: options.baseUrl } : {}),
      ...(configuredFallback ? { configured: configuredFallback } : {}),
      ...(inferredBaseUrl ? { inferred: inferredBaseUrl } : {}),
    },
    {
      dryRun: options.dryRun,
      interactive:
        !output.json &&
        (interaction.stdinIsTTY ?? process.stdin.isTTY) === true &&
        (interaction.stdoutIsTTY ?? process.stdout.isTTY) === true,
    },
    interaction,
  );
  const baseUrl = base.baseUrl;
  const cloneUrl = buildCloneUrl(baseUrl, normalizedProject);
  const destinationName = directory ?? basename(normalizedProject);
  const destination = resolve(global.cwd, destinationName);
  const args = ["clone", "--", cloneUrl, destinationName];
  const command = formatCommand("git", args);
  const data = {
    project: normalizedProject,
    url: cloneUrl,
    destination,
    dryRun: options.dryRun,
    baseUrlSource: base.source,
    configSavedTo: base.savedTo ?? null,
    command,
  };

  if (!options.dryRun) {
    await runGit(args, { cwd: global.cwd, stdin: "inherit" });
  }

  if (output.json) output.result("clone", data);
  else {
    output.heading(options.dryRun ? "Clone preview" : "Project cloned");
    output.note(
      options.dryRun
        ? "No directory or Git repository will be created (--dry-run)."
        : `Cloned ${normalizedProject}.`,
      options.dryRun ? "warning" : "success",
    );
    output.blank();
    output.rows([
      { label: "Project", value: normalizedProject },
      { label: "Source", value: cloneUrl },
      { label: "Destination", value: destination },
    ]);
    output.blank();
    output.note("Command", "muted");
    output.command(command);
    if (base.savedTo) {
      output.blank();
      output.note(`Saved the clone base URL to ${base.savedTo}.`, "success");
    } else if (base.source === "prompt" && options.dryRun) {
      output.blank();
      output.note("The clone base URL was not saved during --dry-run.", "muted");
    }
    if (!options.dryRun) {
      output.blank();
      output.note("Next", "muted");
      output.command(formatCommand("gerrit", ["-C", destination, "setup", "--dry-run"]));
    }
  }
  return data;
};
