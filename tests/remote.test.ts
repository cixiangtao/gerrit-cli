import { describe, expect, it } from "vitest";

import {
  deriveProjectName,
  deriveProjectWebUrl,
  deriveWebUrl,
  parseGerritSshRemote,
} from "../src/core/remote.js";

describe("Gerrit SSH remote", () => {
  it("parses a full SSH URL", () => {
    expect(parseGerritSshRemote("ssh://alice@gerrit.example.com:29418/team/app")).toEqual({
      user: "alice",
      host: "gerrit.example.com",
      port: 29418,
      project: "team/app",
    });
  });

  it("parses SCP-like syntax with Gerrit's conventional port", () => {
    expect(parseGerritSshRemote("alice@gerrit.example.com:team/app")).toEqual({
      user: "alice",
      host: "gerrit.example.com",
      port: 29418,
      project: "team/app",
    });
  });

  it("derives browser origins from SSH and HTTPS remotes", () => {
    expect(deriveWebUrl("ssh://alice@gerrit.example.com:29418/team/app")).toBe(
      "https://gerrit.example.com",
    );
    expect(deriveWebUrl("https://gerrit.example.com/team/app")).toBe("https://gerrit.example.com");
    expect(deriveWebUrl("https://gerrit.example.com/gerrit/a/team/app")).toBe(
      "https://gerrit.example.com/gerrit",
    );
  });

  it("derives project names from SSH and authenticated HTTPS remotes", () => {
    expect(deriveProjectName("ssh://alice@gerrit.example.com:29418/team/app.git")).toBe("team/app");
    expect(
      deriveProjectName(
        "https://gerrit.example.com/gerrit/a/team/app.git",
        "https://gerrit.example.com/gerrit",
      ),
    ).toBe("team/app");
  });

  it("derives encoded Gerrit project homepage URLs", () => {
    expect(deriveProjectWebUrl("ssh://alice@gerrit.example.com:29418/team/my app")).toBe(
      "https://gerrit.example.com/admin/repos/team/my%20app",
    );
    expect(deriveProjectWebUrl("https://gerrit.example.com/gerrit/a/team/app.git")).toBe(
      "https://gerrit.example.com/gerrit/admin/repos/team/app",
    );
  });
});
