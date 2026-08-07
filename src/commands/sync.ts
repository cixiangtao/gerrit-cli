import type { GlobalOptions, SyncStrategy } from "../types.js";
import type { Output } from "../core/output.js";
import type { RepositoryOverrides } from "../core/repository.js";
import { resolveRuntime, syncRepository } from "./shared.js";

export const runSync = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
  options: { dryRun: boolean; strategy?: SyncStrategy },
) => {
  const { repository } = await resolveRuntime(global, output, overrides);
  const strategy = options.strategy ?? repository.syncStrategy;
  const data = await syncRepository(repository, strategy, options.dryRun);
  if (output.json) output.result("sync", data);
  else {
    output.heading(data.dryRun ? "Synchronization preview" : "Synchronization");
    output.note(
      data.dryRun
        ? "No fetch or history update will be performed (--dry-run)."
        : `Synchronized ${repository.remote}/${repository.targetBranch}.`,
      data.dryRun ? "warning" : "success",
    );
    output.blank();
    output.rows([
      { label: "Target", value: `${repository.remote}/${repository.targetBranch}` },
      { label: "Strategy", value: strategy },
      ...(data.after
        ? [
            {
              label: "Result",
              value: `↑ ${data.after.ahead} ahead  ↓ ${data.after.behind} behind`,
            },
          ]
        : []),
    ]);
    output.blank();
    output.note(data.commands.length === 1 ? "Command" : "Commands", "muted");
    for (const command of data.commands) output.command(command);
  }
  return data;
};
