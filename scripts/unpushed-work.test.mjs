import { describe, expect, it } from "vitest";

import { reasonFor, shouldBlock } from "./unpushed-work.mjs";

/**
 * Four reasons to stay quiet and one to block. The quiet cases carry the weight: a `Stop`
 * hook that fires when it should not teaches a session to stop reading hooks.
 */

const base = { remote: true, reentry: false, closing: "Done. Committed the fix.", unpushed: 2 };

describe("when the stop is blocked", () => {
  it("blocks a plain ending with commits on no remote, in a cloud container", () => {
    expect(shouldBlock(base)).toBe(true);
  });

  it("stays quiet outside a cloud container — a laptop's commits survive", () => {
    expect(shouldBlock({ ...base, remote: false })).toBe(false);
  });

  it("stays quiet on the re-entry after it already blocked once", () => {
    expect(shouldBlock({ ...base, reentry: true })).toBe(false);
  });

  it("stays quiet when everything is pushed", () => {
    expect(shouldBlock({ ...base, unpushed: 0 })).toBe(false);
    expect(shouldBlock({ ...base, unpushed: Number.NaN })).toBe(false);
  });

  it("stays quiet when the turn ends on a question or a handoff", () => {
    expect(shouldBlock({ ...base, closing: "Committed. Shall I push and open the PR?" })).toBe(
      false,
    );
    expect(shouldBlock({ ...base, closing: "Say the word and I'll push it." })).toBe(false);
    expect(shouldBlock({ ...base, closing: "Let me know which base branch you want." })).toBe(
      false,
    );
  });
});

describe("the reason", () => {
  it("names the count, the branch and the push command", () => {
    const reason = reasonFor({ unpushed: 2, branch: "claude/feature" });
    expect(reason).toContain("2 commits on `claude/feature` are on no remote branch");
    expect(reason).toContain("git push -u origin claude/feature");
  });

  it("reads correctly for one commit", () => {
    expect(reasonFor({ unpushed: 1, branch: "x" })).toContain(
      "1 commit on `x` is on no remote branch",
    );
  });
});
