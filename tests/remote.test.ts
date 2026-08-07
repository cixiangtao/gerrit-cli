import { describe, expect, it } from "vitest";

import { deriveWebUrl, parseGerritSshRemote } from "../src/core/remote.js";

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
  });
});
