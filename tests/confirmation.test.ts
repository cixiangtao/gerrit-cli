import { describe, expect, it, vi } from "vitest";

import { confirmWrite } from "../src/commands/shared.js";

describe("live write confirmation", () => {
  it("skips the prompt when --yes is present", async () => {
    const prompt = vi.fn(async () => false);

    await expect(
      confirmWrite("Push this change for review?", true, {
        stdinIsTTY: false,
        stdoutIsTTY: false,
        prompt,
      }),
    ).resolves.toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("requires --yes outside an interactive terminal", async () => {
    const prompt = vi.fn(async () => true);

    await expect(
      confirmWrite("Push this change for review?", false, {
        stdinIsTTY: false,
        stdoutIsTTY: false,
        prompt,
      }),
    ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED", exitCode: 1 });
    expect(prompt).not.toHaveBeenCalled();
  });

  it("continues after explicit confirmation", async () => {
    const prompt = vi.fn(async () => true);

    await expect(
      confirmWrite("Push this change for review?", false, {
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt,
      }),
    ).resolves.toBeUndefined();
    expect(prompt).toHaveBeenCalledWith({
      message: "Push this change for review?",
      initialValue: false,
      active: "Yes",
      inactive: "No",
    });
  });

  it.each([false, Symbol("cancel")])("cancels without performing the write", async (answer) => {
    await expect(
      confirmWrite("Push this change for review?", false, {
        stdinIsTTY: true,
        stdoutIsTTY: true,
        prompt: async () => answer,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED", exitCode: 0 });
  });
});
