import { describe, expect, it } from "vitest";

import { countUnpushed, reasonFor, shouldBlock } from "./unpushed-work.mjs";

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
    // Only when the question is the last sentence: a question with a sign-off after it is not.
    expect(shouldBlock({ ...base, closing: "Committed. Which base should this stack on?**" })).toBe(
      false,
    );
    expect(
      shouldBlock({ ...base, closing: "Committed. Which base should this stack on? It waits." }),
    ).toBe(true);
  });
});

describe("the reason", () => {
  it("names the count, the branch and the push command", () => {
    const reason = reasonFor({ unpushed: 2, branch: "claude/feature" });
    expect(reason).toContain("2 commits on `claude/feature` are on no remote branch");
    expect(reason).toContain("git push -u origin claude/feature");
  });

  it("is one command to run, so the extra turn a block costs is a single tool call", () => {
    const reason = reasonFor({ unpushed: 2, branch: "claude/feature" });
    expect(reason).toContain("`git push -u origin claude/feature`");
    expect(reason.split("\n").length).toBeLessThanOrEqual(3);
    expect(reason.length).toBeLessThan(500);
  });

  it("on a detached HEAD, says to make a branch first, never to push `HEAD`", () => {
    const reason = reasonFor({ unpushed: 1, branch: "HEAD" });
    expect(reason).toContain("detached HEAD");
    expect(reason).toContain("git switch -c");
    expect(reason).not.toContain("git push -u origin HEAD");
  });

  it("reads correctly for one commit", () => {
    expect(reasonFor({ unpushed: 1, branch: "x" })).toContain(
      "1 commit on `x` is on no remote branch",
    );
  });
});

describe("what counts as unpushed", () => {
  // A stub git: each answer keyed by its argv, `null` for a command that failed.
  const stub = (answers) => (args) => answers[args.join(" ")] ?? null;

  it("counts against the branch's own upstream, not every remote ref", () => {
    // On a stale container `--not --remotes` reported hundreds of phantom
    // commits because origin/main was days old (issue #2355).
    const git = stub({
      "rev-parse --abbrev-ref HEAD": "feature",
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/feature",
      "rev-list --count @{u}..HEAD": "2",
      "rev-list --count HEAD --not --remotes": "650",
    });
    expect(countUnpushed(git)).toBe(2);
  });

  it("falls back to every remote ref for a branch with no upstream yet", () => {
    const git = stub({
      "rev-parse --abbrev-ref HEAD": "feature",
      "rev-list --count HEAD --not --remotes": "3",
    });
    expect(countUnpushed(git)).toBe(3);
  });

  it("counts a detached HEAD's commits that are on no remote branch", () => {
    // session-context fast-forwards the shared checkout and leaves it detached, and fetches
    // first, so `--not --remotes` reads current refs there. A commit made on it is lost with
    // the container like any other (security review of #2584, finding 1).
    const git = stub({
      "rev-parse --abbrev-ref HEAD": "HEAD",
      "rev-list --count HEAD --not --remotes": "1",
    });
    expect(countUnpushed(git)).toBe(1);
  });

  it("counts nothing when git does not answer", () => {
    expect(countUnpushed(stub({}))).toBe(0);
  });
});
