import type { GlobalOptions } from "../types.js";
import { inspectHook } from "../core/hooks.js";
import type { Output } from "../core/output.js";
import {
  getAheadBehind,
  getInProgressOperation,
  getOutgoingCommits,
  getWorkingTreeStatus,
  type RepositoryOverrides,
} from "../core/repository.js";
import { deriveProjectWebUrl } from "../core/remote.js";
import { resolveRuntime } from "./shared.js";

export const runStatus = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
) => {
  const { config, repository, gerrit } = await resolveRuntime(global, output, overrides);
  const base = repository.upstream;
  const projectUrl = deriveProjectWebUrl(repository.remoteUrl, config.webUrl);
  const [changes, operation, hook, distance, commits] = await Promise.all([
    getWorkingTreeStatus(repository.root),
    getInProgressOperation(repository.root),
    inspectHook(repository.root),
    base ? getAheadBehind(repository.root, base) : undefined,
    base ? getOutgoingCommits(repository.root, base) : [],
  ]);
  const data = {
    repositoryRoot: repository.root,
    branch: repository.branch,
    upstream: repository.upstream ?? null,
    remote: repository.remote,
    remoteUrl: repository.remoteUrl,
    gerrit,
    projectUrl,
    targetBranch: repository.targetBranch,
    syncStrategy: repository.syncStrategy,
    clean: changes.length === 0,
    changes,
    operation: operation ?? null,
    ahead: distance?.ahead ?? null,
    behind: distance?.behind ?? null,
    outgoingCommits: commits,
    hook,
    configSources: config.sources,
  };

  if (output.json) output.result("status", data);
  else {
    const distanceStatus =
      data.ahead === null || data.behind === null
        ? "warning"
        : data.ahead > 0 && data.behind > 0
          ? "error"
          : data.behind > 0
            ? "warning"
            : "success";
    output.heading("Repository status");
    output.rows([
      { label: "Repository", value: data.repositoryRoot },
      { label: "Gerrit", value: `detected (${data.gerrit.evidence})` },
      { label: "Project URL", value: data.projectUrl },
      { label: "Branch", value: data.branch },
      {
        label: "Upstream",
        value: data.upstream ?? "not configured",
        tone: data.upstream ? "default" : "warning",
      },
      { label: "Review", value: `${data.remote} → ${data.targetBranch}` },
      { label: "Sync", value: data.syncStrategy },
    ]);
    output.blank();
    output.rows([
      {
        label: "Worktree",
        value: data.clean ? "clean" : `${changes.length} change(s)`,
        status: data.clean ? "success" : "warning",
        tone: data.clean ? "success" : "warning",
      },
      {
        label: "Operation",
        value: data.operation ?? "none",
        status: data.operation ? "warning" : "success",
        tone: data.operation ? "warning" : "success",
      },
      {
        label: "Distance",
        value: `↑ ${data.ahead ?? "?"} ahead  ↓ ${data.behind ?? "?"} behind`,
        status: distanceStatus,
        tone: distanceStatus === "error" ? "danger" : distanceStatus,
      },
      {
        label: "Change-Id",
        value: hook.ready ? "ready" : "setup required",
        status: hook.ready ? "success" : "warning",
        tone: hook.ready ? "success" : "warning",
      },
    ]);
  }
  return data;
};
