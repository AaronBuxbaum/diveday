import { describe, expect, it } from "vitest";

import { decide, land, landedComment } from "./close-landed-layers.mjs";

const repo = "shop/diveday";
const merged = { number: 30, headSha: "c3" };
const pr = (number, headSha, extra = {}) => ({
  number,
  state: "open",
  headSha,
  headRef: `claude/l${number}`,
  headRepo: repo,
  baseRef: "main",
  ...extra,
});
const run = (open, ancestors) =>
  decide({ merged, open, repo, ancestors: new Set(ancestors) }).close.map((p) => p.number);

describe("decide", () => {
  it("closes the lower layers the merged head contained", () => {
    expect(run([pr(10, "c1"), pr(20, "c2")], ["c1", "c2"])).toEqual([10, 20]);
  });
  it("leaves an unrelated pull request alone", () => {
    expect(run([pr(10, "c1"), pr(99, "zz")], ["c1"])).toEqual([10]);
  });
  it("leaves a layer stacked above the merged one alone (GitHub retargets it to main)", () => {
    expect(run([pr(40, "c4", { baseRef: "claude/l30" })], [])).toEqual([]);
  });
  it("skips a pull request that is already closed", () => {
    expect(run([pr(10, "c1", { state: "closed" })], ["c1"])).toEqual([]);
  });
  it("never touches a fork pull request", () => {
    expect(run([pr(10, "c1", { headRepo: "fork/diveday" })], ["c1"])).toEqual([]);
  });
  it("never touches the merged pull request or one at the same head", () => {
    expect(run([pr(30, "c3"), pr(31, "c3")], ["c3"])).toEqual([]);
  });
  it("never touches a pull request whose head branch is main", () => {
    expect(run([pr(10, "c1", { headRef: "main" })], ["c1"])).toEqual([]);
  });
  it("does nothing when there are none", () => {
    expect(run([], [])).toEqual([]);
  });
  it("keeps a branch another open pull request is based on", () => {
    const { close } = decide({
      merged,
      repo,
      open: [pr(10, "c1"), pr(50, "c5", { baseRef: "claude/l10" })],
      ancestors: new Set(["c1"]),
    });
    expect(close).toEqual([expect.objectContaining({ number: 10, deleteBranch: false })]);
  });
  it("deletes the branch of a layer closed with the layer that was based on it", () => {
    const { close } = decide({
      merged,
      repo,
      open: [pr(10, "c1"), pr(20, "c2", { baseRef: "claude/l10" })],
      ancestors: new Set(["c1", "c2"]),
    });
    expect(close.map((p) => p.deleteBranch)).toEqual([true, true]);
  });
});

describe("land", () => {
  const env = {
    GITHUB_REPOSITORY: repo,
    PR_NUMBER: "30",
    PR_HEAD_SHA: "c3",
    PR_MERGED: "true",
    PR_BASE_REF: "main",
    DEFAULT_BRANCH: "main",
  };
  const raw = (n, sha) => ({
    number: n,
    state: "open",
    head: { sha, ref: `claude/l${n}`, repo: { full_name: repo } },
    base: { ref: "main" },
  });
  function fakeApi(rows, status) {
    const calls = [];
    const api = async (method, pathname, body) => {
      calls.push([method, pathname, body]);
      if (pathname.startsWith("pulls?")) return rows;
      if (pathname.startsWith("compare/"))
        return { status: status[pathname.split("/")[1].split("...")[0]] };
      if (pathname.startsWith("git/ref/heads/"))
        return { object: { sha: pathname.endsWith("l10") ? "c1" : "moved" } };
      return null;
    };
    return { api, calls };
  }
  it("comments, closes and deletes only the ancestor's branch", async () => {
    const { api, calls } = fakeApi([raw(10, "c1"), raw(99, "zz")], {
      c1: "ahead",
      zz: "diverged",
    });
    await land(env, api);
    expect(calls).toContainEqual(["POST", "issues/10/comments", { body: landedComment(30) }]);
    expect(calls).toContainEqual(["PATCH", "pulls/10", { state: "closed" }]);
    expect(calls).toContainEqual(["DELETE", "git/refs/heads/claude/l10", undefined]);
    expect(calls.filter(([, p]) => p.includes("99") && !p.startsWith("compare"))).toEqual([]);
  });
  it("keeps a branch that moved after the check", async () => {
    const { api, calls } = fakeApi([raw(20, "c2")], { c2: "ahead" });
    const lines = await land(env, api);
    expect(calls.some(([m]) => m === "DELETE")).toBe(false);
    expect(lines[0]).toContain("branch kept");
  });
  it("does nothing for an unmerged close or a merge into another branch", async () => {
    const { api, calls } = fakeApi([], {});
    await land({ ...env, PR_MERGED: "false" }, api);
    await land({ ...env, PR_BASE_REF: "claude/x" }, api);
    expect(calls).toEqual([]);
  });
  it("does nothing when no pull request is open", async () => {
    const { api, calls } = fakeApi([], {});
    expect(await land(env, api)).toEqual(["No open pull request was carried by this merge."]);
    expect(calls.every(([m]) => m === "GET")).toBe(true);
  });
});
