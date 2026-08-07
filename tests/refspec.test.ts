import { describe, expect, it } from "vitest";

import { CliError } from "../src/core/errors.js";
import { buildReviewRefspec, parseAccounts } from "../src/core/refspec.js";

describe("Gerrit review refspec", () => {
  it("builds reviewers, CC, topic, WIP, and notifications deterministically", () => {
    expect(
      buildReviewRefspec({
        targetBranch: "feature/app",
        reviewers: ["alice", "bob@example.com"],
        cc: ["team@example.com"],
        topic: "feature-auth",
        wip: true,
        notify: "OWNER_REVIEWERS",
      }),
    ).toBe(
      "HEAD:refs/for/feature/app%r=alice,r=bob@example.com,cc=team@example.com,topic=feature-auth,wip,notify=OWNER_REVIEWERS",
    );
  });

  it("deduplicates positional and repeated reviewer values", () => {
    expect(parseAccounts(["alice,bob", "alice", " bob "])).toEqual(["alice", "bob"]);
  });

  it("rejects conflicting WIP state", () => {
    expect(() =>
      buildReviewRefspec({
        targetBranch: "main",
        reviewers: [],
        cc: [],
        wip: true,
        ready: true,
      }),
    ).toThrowError(CliError);
  });
});
