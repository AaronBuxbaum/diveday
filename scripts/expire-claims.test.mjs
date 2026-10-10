import { describe, expect, it } from "vitest";

import { claimVerdict, expiryComment } from "./expire-claims.mjs";

const now = new Date("2026-10-10T12:00:00Z");
const claimed = (branch, at) => ({
  number: 1,
  comments: [
    {
      createdAt: at,
      body: `## Claim\n\n**Branch:** ${branch}\n**Worktree:** .claude/worktrees/x\n**Started:** ${at}\n**Owns:** src/lib/x.ts`,
    },
  ],
});
const facts = (branches = [], heads = []) => ({
  branches: new Set(branches),
  openHeads: new Set(heads),
  now,
});

describe("when a claim expires", () => {
  it("expires a claim whose branch never reached origin after a day's grace", () => {
    const verdict = claimVerdict(claimed("claude/gone", "2026-10-07T09:00:00Z"), facts());
    expect(verdict).toMatchObject({ expire: true, days: 3 });
    expect(verdict.reason).toContain("is not on origin");
  });

  it("keeps a fresh claim that has not pushed yet", () => {
    expect(claimVerdict(claimed("claude/new", "2026-10-10T08:00:00Z"), facts()).expire).toBe(false);
  });

  it("expires an old claim with a branch but no open pull request", () => {
    const verdict = claimVerdict(
      claimed("claude/old", "2026-09-20T09:00:00Z"),
      facts(["claude/old"]),
    );
    expect(verdict.expire).toBe(true);
    expect(verdict.reason).toMatch(/claimed 20 days ago and no open pull request/);
  });

  it("keeps an old claim whose pull request is still open", () => {
    expect(
      claimVerdict(
        claimed("claude/slow", "2026-09-20T09:00:00Z"),
        facts(["claude/slow"], ["claude/slow"]),
      ),
    ).toMatchObject({ expire: false, reason: "open pull request" });
  });

  it("leaves a label with no parseable claim to a human", () => {
    expect(claimVerdict({ number: 2, comments: [{ body: "working on it" }] }, facts())).toEqual({
      expire: false,
      days: null,
      reason: "labelled in-progress with no claim comment",
    });
  });

  it("says why on the issue and how to re-claim", () => {
    const body = expiryComment({ reason: "branch `x` is not on origin" });
    expect(body).toMatch(/^## Claim expired/);
    expect(body).toContain("branch `x` is not on origin");
    expect(body).toContain("post a fresh `## Claim` comment");
  });
});
