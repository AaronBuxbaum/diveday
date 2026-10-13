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

  it("keeps a label with no parseable claim while its date is unknown", () => {
    expect(claimVerdict({ number: 2, comments: [{ body: "working on it" }] }, facts())).toEqual({
      expire: false,
      days: null,
      reason: "labelled in-progress with no claim comment",
    });
  });

  it("keeps a young label with no claim yet, so a session that labels first is not raced", () => {
    const issue = { number: 2, comments: [], labelledAt: "2026-10-09T12:00:00Z" };
    expect(claimVerdict(issue, facts())).toMatchObject({ expire: false, days: 1 });
  });

  it("expires a label with no parseable claim once it is older than MAX_CLAIM_DAYS", () => {
    const issue = { number: 2, comments: [{ body: "on it" }], labelledAt: "2026-09-30T12:00:00Z" };
    const verdict = claimVerdict(issue, facts());
    expect(verdict).toMatchObject({ expire: true, days: 10 });
    expect(verdict.reason).toMatch(/no parseable `## Claim` comment/);
  });

  // #2233, verbatim: the bullet-form claim the 2026-10-10 sweep posted, on a branch that merged
  // and left origin. Before claims.mjs read the bullet form this was "no claim" and stayed.
  it("expires the real bullet-form claim whose branch left origin", () => {
    const issue = {
      number: 2233,
      comments: [
        {
          createdAt: "2026-10-10T09:46:10Z",
          body: "## Claim\n\n- Branch: `claude/project-thread-f9bes8` (sub-branch `claude/project-thread-f9bes8-l2-core`)\n- Worktree: `/home/claude/wt-rfa8-core`\n- Started: 2026-10-10T09:46Z\n- Owned paths: server actions under src/app (formData.get -> parseForm), src/lib/form-parse.ts\n",
        },
      ],
    };
    const verdict = claimVerdict(issue, { ...facts(), now: new Date("2026-10-12T12:00:00Z") });
    expect(verdict).toMatchObject({ expire: true, branch: "claude/project-thread-f9bes8" });
  });

  it("says why on the issue and how to re-claim", () => {
    const body = expiryComment({ reason: "branch `x` is not on origin" });
    expect(body).toMatch(/^## Claim expired/);
    expect(body).toContain("branch `x` is not on origin");
    expect(body).toContain("post a fresh `## Claim` comment");
  });
});

describe("a claim whose work arrived on another branch", () => {
  const aliased = (at) => ({
    number: 2284,
    comments: [
      {
        createdAt: at,
        body: `## Claim\n\n- Branch: \`claude/f9-s3-gear\` (assembled into \`claude/f9\`)\n- Worktree: /w\n- Started: ${at}\n`,
      },
    ],
  });

  it("is kept while any branch it names is on origin with an open pull request", () => {
    const verdict = claimVerdict(
      aliased("2026-09-20T09:00:00Z"),
      facts(["claude/f9"], ["claude/f9"]),
    );
    expect(verdict.expire).toBe(false);
  });

  it("names the merged pull request from an alias when it expires, first in the comment", () => {
    const mergedByHead = new Map([["claude/f9", { number: 2368, url: "https://x/2368" }]]);
    const verdict = claimVerdict(aliased("2026-10-07T09:00:00Z"), { ...facts(), mergedByHead });
    expect(verdict).toMatchObject({ expire: true, merged: { number: 2368, head: "claude/f9" } });
    const comment = expiryComment(verdict);
    expect(comment.split("\n")[2]).toMatch(/^#2368 merged from `claude\/f9`/);
    expect(comment).toContain("close this issue");
  });

  it("says nothing about a merge when none of its branches merged", () => {
    const verdict = claimVerdict(aliased("2026-10-07T09:00:00Z"), facts());
    expect(verdict.merged).toBeUndefined();
    expect(expiryComment(verdict).split("\n")[2]).toMatch(/^The `in-progress` label is removed/);
  });
});
