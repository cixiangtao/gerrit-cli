import { describe, expect, it } from "vitest";

import {
  assertGerritRemote,
  buildCloneUrl,
  deriveCloneBaseUrl,
  detectGerritRemote,
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

  it("builds clone URLs from SSH and nested HTTPS bases", () => {
    expect(buildCloneUrl("ssh://alice@gerrit.example.com:29418", "team/app")).toBe(
      "ssh://alice@gerrit.example.com:29418/team/app",
    );
    expect(buildCloneUrl("https://gerrit.example.com/gerrit", "team/app.git")).toBe(
      "https://gerrit.example.com/gerrit/team/app",
    );
    expect(buildCloneUrl("https://gerrit.example.com", "team/app name")).toBe(
      "https://gerrit.example.com/team/app%20name",
    );
  });

  it("derives clone bases from existing Gerrit remotes", () => {
    expect(deriveCloneBaseUrl("ssh://alice@gerrit.example.com:29418/team/app")).toBe(
      "ssh://alice@gerrit.example.com:29418",
    );
    expect(deriveCloneBaseUrl("alice@gerrit.example.com:team/app")).toBe(
      "ssh://alice@gerrit.example.com:29418",
    );
    expect(
      deriveCloneBaseUrl(
        "https://gerrit.example.com/gerrit/a/team/app.git",
        "https://gerrit.example.com/gerrit",
      ),
    ).toBe("https://gerrit.example.com/gerrit/a");
  });

  it.each(["", ".", "/app", "app/", "../app", "team//app", "team\\app"])(
    "rejects an invalid clone project name: %s",
    (project) => {
      expect(() => buildCloneUrl("ssh://alice@gerrit.example.com:29418", project)).toThrowError(
        expect.objectContaining({ code: "INVALID_PROJECT" }),
      );
    },
  );

  it("rejects credentials embedded in a clone base URL", () => {
    expect(() => buildCloneUrl("https://alice:secret@gerrit.example.com", "team/app")).toThrowError(
      expect.objectContaining({ code: "INVALID_CLONE_BASE_URL" }),
    );
  });

  it("returns a stable error for a malformed clone base URL", () => {
    expect(() => buildCloneUrl("not a URL", "team/app")).toThrowError(
      expect.objectContaining({ code: "INVALID_CLONE_BASE_URL" }),
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

  it("detects an explicit Gerrit SSH port or configured web URL", () => {
    expect(detectGerritRemote("ssh://alice@gerrit.example.com:29418/team/app")).toEqual({
      detected: true,
      evidence: "ssh-port",
    });
    expect(
      detectGerritRemote("alice@gerrit.example.com:team/app", "https://gerrit.example.com"),
    ).toEqual({ detected: true, evidence: "configured-web-url" });
  });

  it("rejects ordinary Git remotes without Gerrit-specific evidence", () => {
    expect(detectGerritRemote("https://github.com/example/project.git")).toBeUndefined();
    expect(detectGerritRemote("https://github.com/a/project.git")).toBeUndefined();
    expect(detectGerritRemote("https://gerrit.example.com/a/team/app")).toBeUndefined();
    expect(detectGerritRemote("git@github.com:example/project.git")).toBeUndefined();
    expect(() => assertGerritRemote("ssh://git@github.com:22/example/project.git")).toThrowError(
      expect.objectContaining({ code: "NOT_A_GERRIT_REPOSITORY" }),
    );
  });
});
