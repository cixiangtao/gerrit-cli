import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { EffectiveConfig, GerritFlowConfig, SyncStrategy } from "../types.js";
import { CliError } from "./errors.js";

const CONFIG_FILE_NAME = ".gerrit-flow.json";
const GLOBAL_CONFIG_PATH = join(homedir(), ".config", "gerrit-flow", "config.json");
const SYNC_STRATEGIES = new Set<SyncStrategy>(["ff-only", "merge", "rebase"]);

const readConfigFile = async (path: string) => {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The root value must be an object.");
    }
    return value as GerritFlowConfig;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new CliError("INVALID_CONFIG", `Unable to read configuration at ${path}.`, {
      hints: [error instanceof Error ? error.message : "Use valid JSON."],
      cause: error,
    });
  }
};

const validateConfig = (config: GerritFlowConfig, path: string) => {
  for (const key of ["remote", "targetBranch", "webUrl"] as const) {
    if (config[key] !== undefined && typeof config[key] !== "string") {
      throw new CliError("INVALID_CONFIG", `Invalid ${key} in ${path}.`, {
        hints: [`${key} must be a string.`],
      });
    }
  }
  if (config.syncStrategy && !SYNC_STRATEGIES.has(config.syncStrategy)) {
    throw new CliError("INVALID_CONFIG", `Invalid syncStrategy in ${path}.`, {
      hints: ["Use one of: ff-only, merge, rebase."],
    });
  }
  if (config.webUrl) {
    try {
      const url = new URL(config.webUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      throw new CliError("INVALID_CONFIG", `Invalid webUrl in ${path}.`, {
        hints: ["webUrl must be an absolute HTTP or HTTPS URL."],
      });
    }
  }
  for (const key of ["reviewers", "cc"] as const) {
    if (
      config[key] &&
      (!Array.isArray(config[key]) || config[key].some((value) => typeof value !== "string"))
    ) {
      throw new CliError("INVALID_CONFIG", `Invalid ${key} in ${path}.`, {
        hints: [`${key} must be an array of Gerrit account identifiers.`],
      });
    }
  }
  return config;
};

/** Loads global and repository configuration with repository values taking precedence. */
export const loadConfig = async (repositoryRoot: string): Promise<EffectiveConfig> => {
  const repositoryPath = join(repositoryRoot, CONFIG_FILE_NAME);
  const [globalConfig, repositoryConfig] = await Promise.all([
    readConfigFile(GLOBAL_CONFIG_PATH),
    readConfigFile(repositoryPath),
  ]);
  const sources: string[] = [];
  if (globalConfig) sources.push(GLOBAL_CONFIG_PATH);
  if (repositoryConfig) sources.push(repositoryPath);

  const globalValue = globalConfig ? validateConfig(globalConfig, GLOBAL_CONFIG_PATH) : {};
  const repositoryValue = repositoryConfig ? validateConfig(repositoryConfig, repositoryPath) : {};

  const remote = repositoryValue.remote ?? globalValue.remote;
  const targetBranch = repositoryValue.targetBranch ?? globalValue.targetBranch;
  const webUrl = repositoryValue.webUrl ?? globalValue.webUrl;

  return {
    ...(remote ? { remote } : {}),
    ...(targetBranch ? { targetBranch } : {}),
    syncStrategy: repositoryValue.syncStrategy ?? globalValue.syncStrategy ?? "ff-only",
    ...(webUrl ? { webUrl } : {}),
    reviewers: [...new Set(repositoryValue.reviewers ?? globalValue.reviewers ?? [])],
    cc: [...new Set(repositoryValue.cc ?? globalValue.cc ?? [])],
    sources,
  };
};

export const configPaths = {
  global: GLOBAL_CONFIG_PATH,
  repositoryFileName: CONFIG_FILE_NAME,
} as const;
