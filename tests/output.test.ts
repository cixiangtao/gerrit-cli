import { afterEach, describe, expect, it, vi } from "vitest";

import { CliError } from "../src/core/errors.js";
import { createOutput } from "../src/core/output.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("human output colors", () => {
  it("distinguishes headings, fields, and checks when color is enabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const output = createOutput(false, { color: true });

    output.heading("Repository status");
    output.rows([
      { label: "Worktree", value: "clean", status: "success", tone: "success" },
      { label: "Change-Id", value: "setup required", status: "warning", tone: "warning" },
    ]);

    const text = log.mock.calls.flat().join("\n");
    expect(text).toContain("\u001B[");
    expect(text).toContain("Repository status");
    expect(text).toContain("Worktree");
    expect(text).toContain("clean");
  });

  it("keeps human output plain when color is disabled", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const output = createOutput(false, { color: false });

    output.heading("Repository status");
    output.rows([
      { label: "Worktree", value: "clean", status: "success", tone: "success" },
      { label: "仓库", value: "/tmp/repository" },
    ]);

    expect(log.mock.calls.flat()).toEqual([
      "◆ Repository status",
      "  ✓ Worktree  clean",
      "    仓库      /tmp/repository",
    ]);
  });

  it("gives human errors a stable title and separated suggestions", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const output = createOutput(false, { color: false });

    output.failure(
      new CliError("DIRTY_WORKTREE", "The working tree has uncommitted changes.", {
        hints: ["Commit or stash the changes before retrying."],
      }),
    );

    expect(error.mock.calls.flat()).toEqual([
      "✖ Error [DIRTY_WORKTREE]",
      "  The working tree has uncommitted changes.",
      "  Suggestions",
      "  → Commit or stash the changes before retrying.",
    ]);
  });

  it("keeps JSON output free of ANSI sequences", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const output = createOutput(true, { color: true });

    output.result("status", { clean: true });

    const text = String(log.mock.calls[0]?.[0]);
    expect(text).not.toContain("\u001B[");
    expect(JSON.parse(text)).toEqual({ ok: true, command: "status", data: { clean: true } });
  });
});
