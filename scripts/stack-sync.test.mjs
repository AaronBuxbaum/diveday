import { describe, expect, it } from "vitest";

import { chainFor, stackSync, syncLayer, worktreesByBranch } from "./stack-sync.mjs";

const pull = (number, head, base) => ({ number, headRefName: head, baseRefName: base });
const STACK = [
  pull(1, "claude/s-1", "main"),
  pull(2, "claude/s-2", "claude/s-1"),
  pull(3, "claude/s-3", "claude/s-2"),
  pull(9, "claude/other", "main"),
];

describe("the open chain through a branch", () => {
  it("walks down through base refs to main and up through the one layer on top of each", () => {
    expect(chainFor(STACK, "claude/s-2")).toEqual({
      layers: [
        { branch: "claude/s-1", number: 1, base: "main" },
        { branch: "claude/s-2", number: 2, base: "claude/s-1" },
        { branch: "claude/s-3", number: 3, base: "claude/s-2" },
      ],
      index: 1,
      forks: [],
    });
  });

  it("stops walking up at a fork and names both tips", () => {
    const forked = [...STACK, pull(4, "claude/s-3b", "claude/s-2")];
    const chain = chainFor(forked, "claude/s-1");
    expect(chain.layers.map((layer) => layer.branch)).toEqual(["claude/s-1", "claude/s-2"]);
    expect(chain.forks).toEqual(["claude/s-3", "claude/s-3b"]);
  });

  it("has no layers for a branch with no open pull request, and survives a cycle", () => {
    expect(chainFor(STACK, "claude/none").index).toBe(-1);
    const cycle = [pull(5, "a", "b"), pull(6, "b", "a")];
    expect(chainFor(cycle, "a").layers.map((layer) => layer.branch)).toEqual(["b", "a"]);
  });
});

it("reads which worktree has which branch checked out", () => {
  const porcelain = [
    "worktree /home/claude/diveday",
    "HEAD aaa",
    "branch refs/heads/main",
    "",
    "worktree /home/claude/wt-s-2",
    "HEAD bbb",
    "branch refs/heads/claude/s-2",
    "",
    "worktree /home/claude/wt-detached",
    "HEAD ccc",
    "detached",
  ].join("\n");
  expect([...worktreesByBranch(porcelain)]).toEqual([
    ["main", "/home/claude/diveday"],
    ["claude/s-2", "/home/claude/wt-s-2"],
  ]);
});

/**
 * A fake git over named worktrees: `state[dir]` holds what that checkout answers, and every call
 * is recorded so a test can say what was (and was not) run.
 */
function fakeGit(state) {
  const calls = [];
  const git = (dir, args) => {
    calls.push([dir, ...args]);
    const here = state[dir] ?? {};
    const key = args.join(" ");
    const ok = (stdout = "") => ({ status: 0, stdout });
    const no = { status: 1, stdout: "" };
    if (key === "rev-parse --abbrev-ref HEAD") return here.branch ? ok(here.branch) : no;
    if (key.startsWith("fetch ")) return here.fetchFails ? no : ok();
    if (key === "worktree list --porcelain") return ok(state.porcelain ?? "");
    if (key.startsWith("rev-parse --verify --quiet ") && key.endsWith("^{commit}")) {
      return (here.missing ?? []).some((ref) => key.includes(ref)) ? no : ok("sha");
    }
    if (key === "status --porcelain --untracked-files=no") return ok(here.dirty ?? "");
    if (key === "rev-parse --verify --quiet MERGE_HEAD") return here.merging ? ok("sha") : no;
    if (key.startsWith("rev-parse --verify --quiet origin/")) return ok("sha");
    if (key.startsWith("merge-base --is-ancestor ")) {
      const [, , a, b] = args;
      return (here.contains ?? []).includes(`${a}<${b}`) ? ok() : no;
    }
    if (key.startsWith("rev-list --count ")) return ok("3");
    if (key.startsWith("merge --no-edit ")) return here.conflict ? no : ok();
    if (key === "diff --name-only --diff-filter=U") return ok(here.conflict ?? "");
    if (key.startsWith("config --get ")) return no;
    return no;
  };
  return { git, calls };
}

const run = (state, args = [], pulls = () => STACK) => {
  const { git, calls } = fakeGit(state);
  const lines = [];
  const code = stackSync({ git, pulls, cwd: "/wt/s-2", args, log: (line) => lines.push(line) });
  return { code, lines, calls, text: lines.join("\n") };
};

const isMerge = (call) => call[1] === "merge";
const isPush = (call) => call.includes("push");

describe("stack:sync on the current layer", () => {
  const base = {
    "/wt/s-2": {
      branch: "claude/s-2",
      contains: ["origin/claude/s-2<HEAD", "origin/main<origin/claude/s-1"],
    },
  };

  it("merges the layer below, pushes nothing, and prints the next commands for each layer", () => {
    const { code, calls, text } = run(base);
    expect(code).toBe(0);
    expect(calls.filter(isMerge)).toEqual([["/wt/s-2", "merge", "--no-edit", "origin/claude/s-1"]]);
    expect(calls.some(isPush)).toBe(false);
    expect(text).toContain("merged 3 commit(s) from origin/claude/s-1");
    expect(text).toContain("cd /wt/s-2 && pnpm regen (commit what it changed) && git push");
    expect(text).toMatch(/claude\/s-3: in its worktree: pnpm stack:sync/);
  });

  it("merges origin/main into the bottom layer", () => {
    const { calls } = run({
      "/wt/s-2": { branch: "claude/s-1", contains: ["origin/claude/s-1<HEAD"] },
    });
    expect(calls.filter(isMerge)).toEqual([["/wt/s-2", "merge", "--no-edit", "origin/main"]]);
  });

  it("says when the layer below is itself behind main, and still merges what it has", () => {
    const { text, code } = run({
      "/wt/s-2": { branch: "claude/s-2", contains: ["origin/claude/s-2<HEAD"] },
    });
    expect(code).toBe(0);
    expect(text).toContain("claude/s-1 (#1) is itself behind main. It syncs first");
  });

  it("stops on a conflict with the merge left open and the files named", () => {
    const { code, text, calls } = run({
      "/wt/s-2": { ...base["/wt/s-2"], conflict: "src/a.ts\nsrc/b.ts" },
    });
    expect(code).toBe(1);
    expect(text).toContain("stopped on conflicts in src/a.ts, src/b.ts");
    expect(text).toContain("git merge --abort");
    expect(calls.some((call) => call.includes("--abort"))).toBe(false);
  });

  it("refuses uncommitted changes, a merge in progress, and a branch behind its own remote", () => {
    expect(run({ "/wt/s-2": { ...base["/wt/s-2"], dirty: " M src/a.ts" } }).text).toContain(
      "uncommitted changes",
    );
    expect(run({ "/wt/s-2": { ...base["/wt/s-2"], merging: true } }).text).toContain(
      "a merge is already in progress",
    );
    const behind = run({ "/wt/s-2": { branch: "claude/s-2", contains: [] } });
    expect(behind.code).toBe(1);
    expect(behind.text).toContain("behind origin/claude/s-2");
    expect(behind.calls.some(isMerge)).toBe(false);
  });

  it("says so when there is nothing to merge", () => {
    const current = {
      "/wt/s-2": {
        ...base["/wt/s-2"],
        contains: [...base["/wt/s-2"].contains, "origin/claude/s-1<HEAD"],
      },
    };
    const { code, text, calls } = run(current);
    expect(code).toBe(0);
    expect(text).toContain("already contains origin/claude/s-1");
    expect(calls.some(isMerge)).toBe(false);
  });

  it("changes nothing with --plan", () => {
    const { calls, text } = run(base, ["--plan"]);
    expect(calls.some(isMerge)).toBe(false);
    expect(text).toContain("would merge 3 commit(s) from origin/claude/s-1");
  });

  it("falls back to main without a pull request, and goes on when the fetch fails", () => {
    const { calls, text } = run(
      {
        "/wt/s-2": {
          branch: "claude/solo",
          fetchFails: true,
          contains: ["origin/claude/solo<HEAD"],
        },
      },
      [],
      () => {
        throw new Error("gh: 403");
      },
    );
    expect(text).toContain("could not list the open pull requests (gh: 403)");
    expect(text).toContain("the fetch failed");
    expect(calls.filter(isMerge)).toEqual([["/wt/s-2", "merge", "--no-edit", "origin/main"]]);
  });
});

describe("stack:sync --chain", () => {
  const porcelain = [
    "worktree /wt/s-1",
    "branch refs/heads/claude/s-1",
    "",
    "worktree /wt/s-2",
    "branch refs/heads/claude/s-2",
    "",
  ].join("\n");

  it("syncs bottom first in the worktrees that hold each layer, each from the one just synced", () => {
    const { code, calls, text } = run(
      {
        porcelain,
        "/wt/s-1": { branch: "claude/s-1", contains: ["origin/claude/s-1<HEAD"] },
        "/wt/s-2": { branch: "claude/s-2", contains: ["origin/claude/s-2<HEAD"] },
      },
      ["--chain"],
    );
    expect(calls.filter(isMerge)).toEqual([
      ["/wt/s-1", "merge", "--no-edit", "origin/main"],
      ["/wt/s-2", "merge", "--no-edit", "claude/s-1"],
    ]);
    expect(text).toContain("no local worktree has claude/s-3 checked out");
    expect(code).toBe(1);
    expect(calls.some(isPush)).toBe(false);
  });

  it("stops at the first layer it cannot sync, before touching the ones above", () => {
    const { calls, code } = run(
      {
        porcelain,
        "/wt/s-1": { branch: "claude/s-1", dirty: " M x" },
        "/wt/s-2": { branch: "claude/s-2" },
      },
      ["--chain"],
    );
    expect(code).toBe(1);
    expect(calls.some(isMerge)).toBe(false);
  });
});

it("refuses a target that does not exist, before anything else", () => {
  const { git } = fakeGit({ "/wt": { missing: ["origin/claude/gone"] } });
  expect(syncLayer({ git, dir: "/wt", branch: "b", target: "origin/claude/gone" }).state).toBe(
    "refused",
  );
});
