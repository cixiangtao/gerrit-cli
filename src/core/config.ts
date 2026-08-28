import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { EffectiveConfig, GerritCliConfig, SyncStrategy } from "../types.js";
import { CliError } from "./errors.js";

const CONFIG_FILE_NAME = ".gerrit-cli.json";
const DEFAULT_GLOBAL_CONFIG_PATH = join(homedir(), ".config", "gerrit-cli", "config.json");
const SYNC_STRATEGIES = new Set<SyncStrategy>(["ff-only", "merge", "rebase"]);

const getGlobalConfigPath = () =>
  process.env.GERRIT_CLI_CONFIG_PATH
    ? resolve(process.env.GERRIT_CLI_CONFIG_PATH)
    : DEFAULT_GLOBAL_CONFIG_PATH;

const readConfigFile = async (path: string) => {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The root value must be an object.");
    }
    return value as GerritCliConfig;
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

const validateConfig = (config: GerritCliConfig, path: string) => {
  for (const key of ["cloneBaseUrl", "remote", "targetBranch", "webUrl"] as const) {
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
  if (config.cloneBaseUrl) {
    try {
      const url = new URL(config.cloneBaseUrl);
      if (
        !["ssh:", "https:", "http:"].includes(url.protocol) ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error();
      }
    } catch {
      throw new CliError("INVALID_CONFIG", `Invalid cloneBaseUrl in ${path}.`, {
        hints: [
          "cloneBaseUrl must be an absolute SSH, HTTP, or HTTPS URL without a password, query, or hash.",
        ],
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
export const loadConfig = async (
  repositoryRoot: string,
  globalConfigPath = getGlobalConfigPath(),
): Promise<EffectiveConfig> => {
  const repositoryPath = join(repositoryRoot, CONFIG_FILE_NAME);
  const [globalConfig, repositoryConfig] = await Promise.all([
    readConfigFile(globalConfigPath),
    readConfigFile(repositoryPath),
  ]);
  const sources: string[] = [];
  if (globalConfig) sources.push(globalConfigPath);
  if (repositoryConfig) sources.push(repositoryPath);

  const globalValue = globalConfig ? validateConfig(globalConfig, globalConfigPath) : {};
  const repositoryValue = repositoryConfig ? validateConfig(repositoryConfig, repositoryPath) : {};

  const remote = repositoryValue.remote ?? globalValue.remote;
  const targetBranch = repositoryValue.targetBranch ?? globalValue.targetBranch;
  const webUrl = repositoryValue.webUrl ?? globalValue.webUrl;
  const cloneBaseUrl = repositoryValue.cloneBaseUrl ?? globalValue.cloneBaseUrl;

  return {
    ...(cloneBaseUrl ? { cloneBaseUrl } : {}),
    ...(remote ? { remote } : {}),
    ...(targetBranch ? { targetBranch } : {}),
    syncStrategy: repositoryValue.syncStrategy ?? globalValue.syncStrategy ?? "ff-only",
    ...(webUrl ? { webUrl } : {}),
    reviewers: [...new Set(repositoryValue.reviewers ?? globalValue.reviewers ?? [])],
    cc: [...new Set(repositoryValue.cc ?? globalValue.cc ?? [])],
    sources,
  };
};

/** Persists the default clone base while preserving the user's other global settings. */
export const saveGlobalCloneBaseUrl = async (cloneBaseUrl: string) => {
  const globalConfigPath = getGlobalConfigPath();
  const current = (await readConfigFile(globalConfigPath)) ?? {};
  const next = validateConfig({ ...current, cloneBaseUrl }, globalConfigPath);
  await mkdir(dirname(globalConfigPath), { recursive: true, mode: 0o700 });
  await writeFile(globalConfigPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return globalConfigPath;
};

export const configPaths = {
  get global() {
    return getGlobalConfigPath();
  },
  repositoryFileName: CONFIG_FILE_NAME,
} as const;
