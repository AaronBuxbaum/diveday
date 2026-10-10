import { describe, expect, it } from "vitest";

import { ownedPaths, readStack, renderStack, stackSummary } from "./stack-map.mjs";

/** A stand-in `git` answering from a table; anything else fails, as a non-zero exit would. */
const gitFrom = (answers) => (args) => answers[args.join(" ")] ?? null;
const FORMAT = "--format=%(refname:short)%09%(objectname)";

/**
 * A four-layer thread: t-1 (merged into nothing yet), t-2 with a sub-branch `t-2-core` merged in
 * through a second parent, and t-3, t-4 above. HEAD is t-2.
 */
const thread = {
  "rev-parse HEAD": "h2",
  "rev-parse --verify --quiet origin/main": "m",
  "rev-parse --abbrev-ref HEAD": "claude/t-2",
  [`for-each-ref ${FORMAT} --merged HEAD --no-merged origin/main refs/remotes/origin`]:
    "origin/claude/t-1\th1\norigin/claude/t-2-core\tc1\norigin/claude/t-2\th2\norigin/HEAD\tm",
  [`for-each-ref ${FORMAT} --contains HEAD refs/remotes/origin`]:
    "origin/claude/t-2\th2\norigin/claude/t-4\th4\norigin/claude/t-3\th3",
  "rev-list --first-parent origin/main..HEAD": "h2\nmerge1\nh1\nx0",
  "merge-base --is-ancestor h3 h4": "",
  "rev-list --count origin/main..h1": "3",
  "rev-list --count origin/main..h2": "6",
  "rev-list --count origin/main..h3": "8",
  "rev-list --count origin/main..h4": "10",
  "rev-list --first-parent origin/main..h4": "h4\nh3\nh2\nmerge1\nh1",
};

describe("deriving the stack from git", () => {
  it("orders layers bottom to top, marks HEAD, and separates merged sub-branches", () => {
    const stack = readStack(gitFrom(thread));
    expect(stack.layers.map((layer) => layer.name)).toEqual([
      "origin/claude/t-1",
      "claude/t-2",
      "origin/claude/t-3",
      "origin/claude/t-4",
    ]);
    expect(stack.current).toBe(1);
    expect(stack.top).toBe("origin/claude/t-4");
    expect(stack.subBranches).toEqual(["origin/claude/t-2-core"]);
    expect(stack.forks).toEqual([]);
    expect(stackSummary(stack)).toBe("stack: layer 2 of 4, top origin/claude/t-4");
  });

  it("reports a second tip above HEAD as a fork rather than guessing an order", () => {
    const forked = {
      ...thread,
      [`for-each-ref ${FORMAT} --contains HEAD refs/remotes/origin`]:
        "origin/claude/t-3\th3\norigin/claude/other\th5",
      "rev-list --count origin/main..h5": "7",
      "rev-list --first-parent origin/main..h3": "h3\nh2",
    };
    const stack = readStack(gitFrom(forked));
    expect(stack.top).toBe("origin/claude/t-3");
    expect(stack.forks).toEqual(["origin/claude/other"]);
    expect(stackSummary(stack)).toContain("1 other tip(s) above");
  });

  it("says HEAD is the top when nothing is above it", () => {
    const alone = {
      ...thread,
      [`for-each-ref ${FORMAT} --contains HEAD refs/remotes/origin`]: "origin/claude/t-2\th2",
    };
    expect(stackSummary(readStack(gitFrom(alone)))).toBe("stack: layer 2 of 2 (top)");
  });

  it("is silent for a branch in no stack, and null without git or origin/main", () => {
    const single = {
      ...thread,
      [`for-each-ref ${FORMAT} --merged HEAD --no-merged origin/main refs/remotes/origin`]: "",
      [`for-each-ref ${FORMAT} --contains HEAD refs/remotes/origin`]: "",
    };
    expect(stackSummary(readStack(gitFrom(single)))).toBe("");
    expect(readStack(() => null)).toBeNull();
    expect(readStack(gitFrom({ "rev-parse HEAD": "h2" }))).toBeNull();
    expect(stackSummary(null)).toBe("");
    expect(renderStack(null)).toContain("could not answer");
  });

  it("names each layer's own paths when asked", () => {
    const withDiffs = {
      ...thread,
      "merge-base origin/main h1": "m",
      "diff --name-only m..h1": "src/db/a.ts\nsrc/db/b.ts\nAGENTS.md",
      "diff --name-only h1..h2": "scripts/x.mjs",
      "diff --name-only h2..h3": "",
      "diff --name-only h3..h4": "e2e/visual.spec.ts",
    };
    const stack = readStack(gitFrom(withDiffs), { paths: true });
    expect(stack.layers[0].paths).toEqual(["src/db/", "AGENTS.md"]);
    expect(renderStack(stack)).toContain("2. claude/t-2 (6 commits)  <- HEAD");
  });
});

describe("folding a diff into owned paths", () => {
  it("keeps two leading segments, most-touched first, capped", () => {
    expect(ownedPaths(["src/lib/a.ts", "src/lib/b.ts", "docs/x.md", "README.md"], 2)).toEqual([
      "src/lib/",
      "docs/x.md",
    ]);
  });
});
