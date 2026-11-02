import { describe, expect, it } from "vitest";

import { gitFor, renderWarnings, stackWarnings } from "./stack-warnings.mjs";

const pr = (number, head, base, extra = {}) => ({
  number,
  headRefName: head,
  baseRefName: base,
  mergedAt: null,
  mergeCommitSha: null,
  headSha: `${head}-tip`,
  ...extra,
});
const merged = (number, head, base, extra = {}) =>
  pr(number, head, base, {
    mergedAt: "2026-11-01T10:00:00Z",
    mergeCommitSha: `m${number}`,
    ...extra,
  });

/** A git stand-in: `ancestors` are "a>b" pairs that hold, `known` the shas it has objects for. */
function git({ ancestors = [], known = [], tips = {}, contains = [] } = {}) {
  return {
    isAncestor: (a, b) => {
      if (!known.includes(a) && !ancestors.includes(`${a}>${b}`)) return null;
      return ancestors.includes(`${a}>${b}`);
    },
    tip: (branch) => tips[branch] ?? null,
    contains: (branch, sha) => contains.includes(`${branch}>${sha}`),
  };
}

describe("a merged pull request that never reached main", () => {
  it("warns when it merged into a branch and its commits are not in main", () => {
    const warnings = stackWarnings({
      merged: [merged(3579, "l1", "side")],
      open: [],
      git: git({ known: ["m3579"] }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/#3579 merged into side, not main/);
    expect(warnings[0]).toMatch(/not in origin\/main/);
  });

  it("is quiet for a pull request that merged into main", () => {
    expect(
      stackWarnings({ merged: [merged(1, "a", "main")], open: [], git: git({ known: ["m1"] }) }),
    ).toEqual([]);
  });

  it("is quiet when its merge commit is an ancestor of main", () => {
    const g = git({ ancestors: ["m2>origin/main"] });
    expect(stackWarnings({ merged: [merged(2, "a", "side")], open: [], git: g })).toEqual([]);
  });

  it("is quiet when the base branch's own pull request landed with this merge inside it", () => {
    const side = merged(3587, "side", "main", { headSha: "side-final" });
    const g = git({ ancestors: ["m3579>side-final"], known: ["m3587"] });
    // side's own PR merged into main; the merge commit sits in side's final head
    const landed = stackWarnings({ merged: [merged(3579, "l1", "side"), side], open: [], git: g });
    expect(landed).toEqual([]);
  });

  it("warns when the base branch moved after the merge (#3579 to #3583 into a branch later moved)", () => {
    const side = merged(3587, "side", "main", { headSha: "side-final" });
    const g = git({ known: ["m3579", "m3587"] });
    const warnings = stackWarnings({
      merged: [merged(3579, "l1", "side"), side],
      open: [],
      git: g,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/#3579/);
    expect(warnings[0]).toMatch(/#3587/);
    expect(warnings[0]).toMatch(/not in its final head/);
  });

  it("says nothing it cannot know: a merge commit git has no object for", () => {
    expect(stackWarnings({ merged: [merged(9, "a", "side")], open: [], git: git() })).toEqual([]);
  });

  it("does not loop on two branches that name each other", () => {
    const a = merged(1, "a", "b");
    const b = merged(2, "b", "a");
    expect(() =>
      stackWarnings({ merged: [a, b], open: [], git: git({ known: ["m1", "m2"] }) }),
    ).not.toThrow();
  });
});

describe("open pull requests", () => {
  it("warns when two open pull requests share a base that is not main", () => {
    const warnings = stackWarnings({
      merged: [],
      open: [pr(10, "x", "base"), pr(11, "y", "base"), pr(12, "z", "main"), pr(13, "w", "main")],
      git: git(),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/#10, #11 both stack on base/);
  });

  it("warns when a branch with open children moved past them", () => {
    const warnings = stackWarnings({
      merged: [],
      open: [pr(20, "child", "layer")],
      git: git({ tips: { layer: "layer-new" }, contains: [] }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/#20 \(child\) does not contain layer's tip/);
    expect(warnings[0]).toMatch(/pnpm stack:sync/);
  });

  it("is quiet when the child contains its base's tip, or the base has no remote tip", () => {
    const g = git({ tips: { layer: "layer-new" }, contains: ["child>layer-new"] });
    expect(stackWarnings({ merged: [], open: [pr(20, "child", "layer")], git: g })).toEqual([]);
    expect(stackWarnings({ merged: [], open: [pr(21, "c", "gone")], git: git() })).toEqual([]);
  });
});

describe("the real git adapter", () => {
  // `read` answers from a table of command strings; anything else is a non-zero exit (null).
  const reader = (table) => (args) => table[args.join(" ")] ?? null;
  const has = (sha) => `cat-file -e ${sha}^{commit}`;

  it("treats a commit this clone never had as not an ancestor (the #3579 case)", () => {
    const git = gitFor(reader({ [has("origin/main")]: "" }));
    expect(git.isAncestor("lost", "origin/main")).toBe(false);
  });

  it("answers null when there is nothing to compare against", () => {
    expect(gitFor(reader({})).isAncestor("a", "origin/main")).toBeNull();
  });

  it("asks git when both exist", () => {
    const table = { [has("a")]: "", [has("b")]: "", "merge-base --is-ancestor a b": "" };
    expect(gitFor(reader(table)).isAncestor("a", "b")).toBe(true);
    expect(gitFor(reader({ [has("a")]: "", [has("b")]: "" })).isAncestor("a", "b")).toBe(false);
  });
});

describe("rendering", () => {
  it("never fails: it only prints", () => {
    expect(renderWarnings([])).toBe("");
    const text = renderWarnings(["one", "two"]);
    expect(text).toContain("warning: one");
    expect(text).toContain("warning: two");
    expect(text).toMatch(/advice, not a gate/);
  });
});
