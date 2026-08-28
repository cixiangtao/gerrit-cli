import { describe, expect, it, vi } from "vitest";

import {
  COMMAND_MENU_OPTIONS,
  formatInteractiveTitle,
  resolveRootArguments,
} from "../src/interactive.js";

describe("interactive root command", () => {
  it("routes a bare TTY invocation to the selected command", async () => {
    const result = await resolveRootArguments([], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      version: "0.1.0",
      selectCommand: async () => "status",
    });

    expect(result).toEqual(["status"]);
  });

  it("collects a project name after clone is selected", async () => {
    const result = await resolveRootArguments([], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      version: "0.1.0",
      selectCommand: async () => "clone",
      selectCloneProject: async () => " team/app ",
    });

    expect(result).toEqual(["clone", "team/app"]);
  });

  it("shows help instead of prompting outside a TTY", async () => {
    const selectCommand = vi.fn(async () => "status" as const);
    const result = await resolveRootArguments([], {
      stdinIsTTY: false,
      stdoutIsTTY: false,
      version: "0.1.0",
      selectCommand,
    });

    expect(result).toEqual(["--help"]);
    expect(selectCommand).not.toHaveBeenCalled();
  });

  it("leaves explicit commands unchanged", async () => {
    const result = await resolveRootArguments(["--json", "status"], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      version: "0.1.0",
    });

    expect(result).toEqual(["--json", "status"]);
  });

  it("exits cleanly when the menu is cancelled", async () => {
    const result = await resolveRootArguments([], {
      stdinIsTTY: true,
      stdoutIsTTY: true,
      version: "0.1.0",
      selectCommand: async () => Symbol("cancel"),
    });

    expect(result).toBeNull();
  });

  it("includes the CLI version in the menu title", () => {
    expect(formatInteractiveTitle("0.1.0")).toBe("Gerrit CLI v0.1.0");
  });

  it("describes every primary command and its effect", () => {
    expect(COMMAND_MENU_OPTIONS.map(({ value }) => value)).toEqual([
      "status",
      "doctor",
      "clone",
      "review",
      "amend",
      "merge",
      "sync",
      "setup",
      "open",
      "--help",
    ]);
    expect(COMMAND_MENU_OPTIONS.every(({ hint }) => hint.length > 0)).toBe(true);
  });
});
