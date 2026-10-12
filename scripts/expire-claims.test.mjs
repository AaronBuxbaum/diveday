import { describe, expect, it } from "vitest";

import {
  claimVerdict,
  expireClaim,
  expiryComment,
  readInProgressIssues,
  readOpenHeads,
} from "./expire-claims.mjs";

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

describe("reading and writing through REST when GraphQL is refused", () => {
  // A cloud container's proxy 403s gh's GraphQL commands but serves `gh api`
  // REST, so every call falls back rather than leaving the script CI-only
  // (issue #2355). The stub refuses anything that is not `gh api`.
  const restOnly =
    (answers, calls = []) =>
    (command, args) => {
      calls.push([command, ...args].join(" "));
      if (args[0] !== "api") throw new Error("HTTP 403: GraphQL refused");
      const key = args.find((arg) => arg.startsWith("repos/")) ?? "";
      if (!(key in answers)) throw new Error(`stub miss: ${key}`);
      return answers[key];
    };

  it("reads in-progress issues and their comments in the GraphQL shape", () => {
    const run = restOnly({
      "repos/{owner}/{repo}/issues?labels=in-progress&state=open&per_page=100":
        '{"number":7,"title":"Seven"}\n',
      "repos/{owner}/{repo}/issues/7/comments?per_page=100":
        '{"body":"hi","createdAt":"2026-10-10T00:00:00Z"}\n{"body":"two","createdAt":"2026-10-11T00:00:00Z"}\n',
    });
    expect(readInProgressIssues(run)).toEqual([
      {
        number: 7,
        title: "Seven",
        comments: [
          { body: "hi", createdAt: "2026-10-10T00:00:00Z" },
          { body: "two", createdAt: "2026-10-11T00:00:00Z" },
        ],
      },
    ]);
  });

  it("reads open pull request heads", () => {
    const run = restOnly({
      "repos/{owner}/{repo}/pulls?state=open&per_page=100": "claude/a\nclaude/b\n",
    });
    expect(readOpenHeads(run)).toEqual(["claude/a", "claude/b"]);
  });

  it("prefers GraphQL when it answers", () => {
    const run = (_command, args) =>
      args[0] === "pr" ? '[{"headRefName":"claude/x"}]' : "unexpected";
    expect(readOpenHeads(run)).toEqual(["claude/x"]);
  });

  it("removes the label and comments through REST", () => {
    const calls = [];
    const run = restOnly(
      {
        "repos/{owner}/{repo}/issues/7/labels/in-progress": "[]",
        "repos/{owner}/{repo}/issues/7/comments": "{}",
      },
      calls,
    );
    expireClaim(run, 7, { reason: "branch `x` is not on origin" });
    const rest = calls.filter((call) => call.startsWith("gh api"));
    expect(rest[0]).toBe("gh api --method DELETE repos/{owner}/{repo}/issues/7/labels/in-progress");
    expect(rest[1]).toContain(
      "--method POST repos/{owner}/{repo}/issues/7/comments -f body=## Claim expired",
    );
  });
});
