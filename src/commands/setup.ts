import type { GlobalOptions } from "../types.js";
import { installHook } from "../core/hooks.js";
import type { Output } from "../core/output.js";
import type { RepositoryOverrides } from "../core/repository.js";
import { resolveRuntime } from "./shared.js";

export const runSetup = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
  options: { dryRun: boolean; refresh: boolean },
) => {
  const { repository } = await resolveRuntime(global, output, overrides);
  const data = await installHook(repository.root, repository.remoteUrl, options);
  if (output.json) output.result("setup", data);
  else {
    output.heading(options.dryRun ? "Hook setup preview" : "Hook setup");
    output.note(
      options.dryRun
        ? "No hook will be downloaded or changed (--dry-run)."
        : "Gerrit Change-Id hook checked.",
      options.dryRun ? "warning" : "success",
    );
    output.blank();
    output.rows([
      { label: "Stored hook", value: data.hook.installedPath },
      { label: "Active hook", value: data.hook.activePath },
      {
        label: "Ready",
        value: data.hook.ready ? "yes" : "no",
        status: data.hook.ready ? "success" : "warning",
        tone: data.hook.ready ? "success" : "warning",
      },
    ]);
    if (!data.hook.ready) {
      output.blank();
      output.note(
        options.dryRun
          ? "The active commit-msg hook will be preserved and composed automatically."
          : "The active commit-msg hook could not be composed automatically.",
        "warning",
      );
    }
  }
  if (!options.dryRun && !data.hook.ready) process.exitCode = 1;
  return data;
};
