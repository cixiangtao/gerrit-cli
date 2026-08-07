import { platform } from "node:os";

import type { GlobalOptions } from "../types.js";
import { CliError } from "../core/errors.js";
import type { Output } from "../core/output.js";
import { formatCommand, runCommand } from "../core/process.js";
import { getHeadChangeId, type RepositoryOverrides } from "../core/repository.js";
import { deriveWebUrl } from "../core/remote.js";
import { resolveRuntime } from "./shared.js";

const browserCommand = (url: string) => {
  if (platform() === "darwin") return { command: "open", args: [url] };
  if (platform() === "win32") return { command: "explorer.exe", args: [url] };
  return { command: "xdg-open", args: [url] };
};

export const runOpen = async (
  global: GlobalOptions,
  output: Output,
  overrides: RepositoryOverrides,
  options: { dryRun: boolean; print: boolean },
) => {
  const { config, repository } = await resolveRuntime(global, output, overrides);
  const changeId = await getHeadChangeId(repository.root);
  if (!changeId) {
    throw new CliError("MISSING_CHANGE_ID", "HEAD does not contain a Gerrit Change-Id.");
  }
  const webUrl = config.webUrl ?? deriveWebUrl(repository.remoteUrl);
  const url = `${webUrl.replace(/\/$/, "")}/q/${changeId}`;
  const browser = browserCommand(url);
  const data = {
    changeId,
    url,
    dryRun: options.dryRun || options.print,
    command: formatCommand(browser.command, browser.args),
  };

  if (!options.dryRun && !options.print) {
    const result = await runCommand(browser.command, browser.args, {
      cwd: repository.root,
      allowFailure: true,
    });
    if (result.exitCode !== 0) {
      throw new CliError("OPEN_FAILED", "Unable to open the Gerrit review in a browser.", {
        hints: [url, result.stderr].filter(Boolean),
      });
    }
  }

  if (output.json) output.result("open", data);
  else {
    output.heading("Gerrit review");
    if (!options.print && !options.dryRun) {
      output.note("Opened the Gerrit review in your browser.", "success");
      output.blank();
    }
    output.rows([{ label: "Review", value: url }]);
  }
  return data;
};
