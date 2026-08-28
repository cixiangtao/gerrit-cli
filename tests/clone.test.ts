import { describe, expect, it, vi } from "vitest";

import { resolveCloneBaseUrl } from "../src/commands/clone.js";

describe("clone base URL onboarding", () => {
  it("uses configured and inferred bases without prompting", async () => {
    const promptBaseUrl = vi.fn(async () => "ssh://prompt@gerrit.example.com:29418");

    await expect(
      resolveCloneBaseUrl(
        "team/app",
        {
          configured: "ssh://configured@gerrit.example.com:29418",
          inferred: "ssh://inferred@gerrit.example.com:29418",
        },
        { dryRun: false, interactive: true },
        { promptBaseUrl },
      ),
    ).resolves.toEqual({
      baseUrl: "ssh://configured@gerrit.example.com:29418",
      source: "config",
    });
    expect(promptBaseUrl).not.toHaveBeenCalled();
  });

  it("prompts once and saves an accepted global default", async () => {
    const saveBaseUrl = vi.fn(async () => "/tmp/gerrit-cli/config.json");

    await expect(
      resolveCloneBaseUrl(
        "team/app",
        {},
        { dryRun: false, interactive: true },
        {
          promptBaseUrl: async () => " ssh://alice@gerrit.example.com:29418 ",
          confirmSave: async () => true,
          saveBaseUrl,
        },
      ),
    ).resolves.toEqual({
      baseUrl: "ssh://alice@gerrit.example.com:29418",
      source: "prompt",
      savedTo: "/tmp/gerrit-cli/config.json",
    });
    expect(saveBaseUrl).toHaveBeenCalledWith("ssh://alice@gerrit.example.com:29418");
  });

  it("keeps first-use dry-runs free of configuration writes", async () => {
    const confirmSave = vi.fn(async () => true);
    const saveBaseUrl = vi.fn(async () => "/tmp/gerrit-cli/config.json");

    await expect(
      resolveCloneBaseUrl(
        "team/app",
        {},
        { dryRun: true, interactive: true },
        {
          promptBaseUrl: async () => "ssh://alice@gerrit.example.com:29418",
          confirmSave,
          saveBaseUrl,
        },
      ),
    ).resolves.toEqual({
      baseUrl: "ssh://alice@gerrit.example.com:29418",
      source: "prompt",
    });
    expect(confirmSave).not.toHaveBeenCalled();
    expect(saveBaseUrl).not.toHaveBeenCalled();
  });

  it("returns actionable configuration guidance outside an interactive terminal", async () => {
    await expect(
      resolveCloneBaseUrl("team/app", {}, { dryRun: false, interactive: false }),
    ).rejects.toMatchObject({
      code: "CLONE_URL_NOT_CONFIGURED",
      hints: expect.arrayContaining(["Run gerrit clone interactively for first-time setup."]),
    });
  });
});
