import { resolve } from "node:path";

import type { GlobalOptions } from "../types.js";
import { getRepositoryRoot } from "../core/git.js";
import { runInstalledHook } from "../core/hooks.js";
import type { Output } from "../core/output.js";

export const runHook = async (global: GlobalOptions, output: Output, messageFile: string) => {
  const root = await getRepositoryRoot(global.cwd);
  await runInstalledHook(root, resolve(root, messageFile));
  const data = { messageFile: resolve(root, messageFile) };
  if (output.json) output.result("hook run", data);
  return data;
};
