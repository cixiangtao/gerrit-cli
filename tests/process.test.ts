import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCommand } from "../src/core/process.js";

describe("process runner", () => {
  it("passes repository-controlled text as an argument instead of shell code", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "gerrit-flow-process-"));
    const marker = join(cwd, "injected");
    const dangerous = `branch;touch ${marker}`;
    const result = await runCommand(
      process.execPath,
      ["-e", "console.log(process.argv[1])", dangerous],
      { cwd },
    );

    expect(result.stdout).toBe(dangerous);
    await expect(access(marker)).rejects.toThrow();
  });
});
