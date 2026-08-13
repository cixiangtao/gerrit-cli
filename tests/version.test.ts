import { describe, expect, it, vi } from "vitest";

import { checkForUpdate, formatUpdateNotice, isNewerVersion } from "../src/core/version.js";

describe("version updates", () => {
  it.each([
    ["1.2.1", "1.2.0"],
    ["1.3.0", "1.2.9"],
    ["2.0.0", "1.99.99"],
    ["1.2.0", "1.2.0-beta.1"],
    ["1.2.0-beta.2", "1.2.0-beta.1"],
    ["1.2.0-rc.1", "1.2.0-beta.9"],
  ])("recognizes %s as newer than %s", (latest, current) => {
    expect(isNewerVersion(latest, current)).toBe(true);
  });

  it.each([
    ["1.2.0", "1.2.0"],
    ["1.1.9", "1.2.0"],
    ["1.2.0-beta.1", "1.2.0"],
    ["1.2.0-beta.1", "1.2.0-beta.2"],
    ["latest", "1.2.0"],
  ])("does not treat %s as newer than %s", (latest, current) => {
    expect(isNewerVersion(latest, current)).toBe(false);
  });

  it("returns an actionable notice when the registry has a newer version", async () => {
    const getLatestVersion = vi.fn().mockResolvedValue("1.3.0");
    const update = await checkForUpdate("1.2.0", getLatestVersion);

    expect(getLatestVersion).toHaveBeenCalledOnce();
    expect(update).toEqual({ currentVersion: "1.2.0", latestVersion: "1.3.0" });
    expect(formatUpdateNotice(update!)).toBe(
      "A newer Gerrit CLI version is available: 1.2.0 -> 1.3.0. " +
        "Upgrade @anys/gerrit-cli to the latest version.",
    );
  });

  it("keeps the original command usable when the registry check fails", async () => {
    await expect(
      checkForUpdate("1.2.0", vi.fn().mockRejectedValue(new Error("offline"))),
    ).resolves.toBeNull();
  });
});
