import { describe, expect, it } from "vitest";

import { cancelEndpoint, describeRun, listEndpoint, mergeRuns, parseArgs } from "./cancel-actions.mjs";

describe("parseArgs", () => {
  it("defaults to a real run on every branch", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, branch: null, help: false });
  });
  it("reads --dry-run and both --branch spellings", () => {
    expect(parseArgs(["--dry-run", "--branch", "main"])).toMatchObject({ dryRun: true, branch: "main" });
    expect(parseArgs(["--branch=claude/x"]).branch).toBe("claude/x");
  });
  it("refuses a missing branch name and unknown flags", () => {
    expect(() => parseArgs(["--branch"])).toThrow(/branch name/);
    expect(() => parseArgs(["--branch", "--dry-run"])).toThrow(/branch name/);
    expect(() => parseArgs(["--nope"])).toThrow(/unknown argument/);
  });
});

describe("endpoints", () => {
  it("lists one status page, with the branch only when given", () => {
    expect(listEndpoint("queued", { branch: null, page: 2 })).toBe(
      "repos/AaronBuxbaum/diveday/actions/runs?status=queued&per_page=100&page=2",
    );
    expect(listEndpoint("queued", { branch: "a/b", page: 1 })).toContain("branch=a%2Fb");
  });
  it("posts the cancel to the run", () => {
    expect(cancelEndpoint(7)).toBe("repos/AaronBuxbaum/diveday/actions/runs/7/cancel");
  });
});

describe("mergeRuns", () => {
  it("keeps one entry per run id, in id order", () => {
    const merged = mergeRuns([[{ id: 3 }, { id: 1 }], [{ id: 3 }, { id: 2 }]]);
    expect(merged.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("describeRun", () => {
  it("names the run, status and branch", () => {
    expect(describeRun({ id: 9, name: "CI", status: "queued", head_branch: "main", html_url: "u" })).toBe(
      "#9 CI [queued] main u",
    );
  });
});
