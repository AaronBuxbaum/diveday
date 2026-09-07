import { describe, expect, it } from "vitest";

import { checkoutState, promptLine, sessionBlock } from "./session-context.mjs";

/**
 * The hook's only job is to state facts a session would otherwise spend tool calls on, so
 * the tests are about two things: it reads git correctly, and it says nothing when git could
 * not answer. A line that is missing costs a few tokens; a line that is wrong costs a wrong
 * push.
 */

/** A stand-in `git` that answers from a table, and returns null for anything else. */
const gitFrom = (answers) => (args) => answers[args.join(" ")] ?? null;

const tracked = gitFrom({
  "rev-parse --abbrev-ref HEAD": "claude/feature",
  "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/claude/feature",
  "rev-list --left-right --count @{u}...HEAD": "1\t3",
  "rev-list --count HEAD --not --remotes": "3",
  "status --porcelain": " M src/a.ts\n?? src/b.ts",
  "log -1 --format=%h %s": "abc1234 feat: the thing",
});

describe("reading the checkout", () => {
  it("reports branch, upstream, ahead/behind, unpushed, uncommitted and HEAD", () => {
    expect(checkoutState(tracked)).toEqual({
      branch: "claude/feature",
      upstream: "origin/claude/feature",
      ahead: 3,
      behind: 1,
      unpushed: 3,
      uncommitted: 2,
      head: "abc1234 feat: the thing",
    });
  });

  it("copes with a branch that has no upstream yet", () => {
    const state = checkoutState(
      gitFrom({
        "rev-parse --abbrev-ref HEAD": "claude/new",
        "rev-list --count HEAD --not --remotes": "2",
        "status --porcelain": "",
        "log -1 --format=%h %s": "def5678 wip",
      }),
    );
    expect(state.upstream).toBeNull();
    expect(state.ahead).toBeNull();
    expect(state.unpushed).toBe(2);
    expect(state.uncommitted).toBe(0);
  });

  it("returns null when this is not a repository at all", () => {
    expect(checkoutState(() => null)).toBeNull();
  });
});

describe("the one-line prompt context", () => {
  it("says branch, tree state and what is unpushed, and nothing when there is nothing", () => {
    expect(promptLine(checkoutState(tracked))).toBe(
      "git: claude/feature · 2 uncommitted · 3 unpushed commits · 1 behind origin/claude/feature",
    );
    expect(
      promptLine({
        branch: "main",
        upstream: "origin/main",
        ahead: 0,
        behind: 0,
        unpushed: 0,
        uncommitted: 0,
        head: "x",
      }),
    ).toBe("git: main · clean tree");
    expect(promptLine(null)).toBe("");
  });
});

describe("the session-start block", () => {
  it("states the checkout and warns about commits on no remote", () => {
    const block = sessionBlock(checkoutState(tracked), { source: "startup" });
    expect(block).toContain(
      "branch claude/feature, upstream origin/claude/feature (3 ahead, 1 behind), 2 uncommitted paths",
    );
    expect(block).toContain("HEAD abc1234 feat: the thing");
    expect(block).toMatch(/3 local commits are on no remote branch/);
    expect(block).not.toContain("After compaction");
  });

  it("adds the post-compaction reminders only after a compaction", () => {
    const block = sessionBlock(checkoutState(tracked), { source: "compact" });
    expect(block).toContain("After compaction");
    expect(block).toContain("test:changed");
    expect(block).toContain("needs-triage");
  });

  it("mentions the Node mismatch only when there is one, and the install only when it ran", () => {
    const state = checkoutState(tracked);
    expect(sessionBlock(state, { nodeMajor: 24, pinnedMajor: 24 })).not.toContain("Node 24");
    expect(sessionBlock(state, { nodeMajor: 22, pinnedMajor: 24 })).toContain(
      "Node 22 here, repo pins 24",
    );
    expect(sessionBlock(state, { installed: "installed" })).toContain("`pnpm install` ran");
    expect(sessionBlock(state, { installed: "failed" })).toContain("failed");
    expect(sessionBlock(state, { installed: null })).not.toContain("node_modules");
  });

  it("still says where the rules and hooks live when git could not answer", () => {
    const block = sessionBlock(null, { source: "resume" });
    expect(block).not.toContain("Checkout");
    expect(block).toContain(".claude/rules/");
  });
});
