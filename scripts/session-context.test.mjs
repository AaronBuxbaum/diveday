import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkoutState,
  fastForwardPlan,
  fastForwardShared,
  fetchNeed,
  fetchOpenPulls,
  findInstalledNode,
  installNeed,
  OPEN_PULLS_TTL_MS,
  openPullsText,
  promptLine,
  readOpenPulls,
  SESSION_FETCH_ARGS,
  selectPinnedNode,
  sessionBlock,
  unwrittenPapercut,
} from "./session-context.mjs";

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
      detached: false,
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

  it("counts unpushed commits against the branch's upstream, not against every remote ref", () => {
    // A stale origin/main used to make a pushed branch read as hundreds of commits unpushed.
    const state = checkoutState(
      gitFrom({
        "rev-parse --abbrev-ref HEAD": "claude/feature",
        "rev-parse --abbrev-ref --symbolic-full-name @{u}": "origin/claude/feature",
        "rev-list --left-right --count @{u}...HEAD": "0\t0",
        "rev-list --count HEAD --not --remotes": "650",
        "status --porcelain": "",
      }),
    );
    expect(state.unpushed).toBe(0);
    expect(promptLine(state)).toBe("git: claude/feature · clean tree");
  });

  it("says a detached HEAD has no upstream and counts nothing as unpushed", () => {
    const state = checkoutState(
      gitFrom({
        "rev-parse --abbrev-ref HEAD": "HEAD",
        "rev-list --count HEAD --not --remotes": "650",
        "status --porcelain": "",
        "log -1 --format=%h %s": "3ed8285 the fresh clone",
      }),
    );
    expect(state.detached).toBe(true);
    expect(state.unpushed).toBeNull();
    expect(promptLine(state)).toBe("git: detached HEAD (no upstream) · clean tree");
    const block = sessionBlock(state, { source: "startup" });
    expect(block).toContain("detached HEAD, no upstream");
    expect(block).not.toContain("unpushed");
    expect(block).not.toContain("local commit");
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

  it("appends the stack position, and the refusal tally on a line of its own", () => {
    const state = checkoutState(tracked);
    expect(promptLine(state, { stack: "stack: layer 2 of 3, top origin/claude/x-3" })).toMatch(
      / · stack: layer 2 of 3, top origin\/claude\/x-3$/,
    );
    const line = promptLine(state, { refusals: "2 hook refusals last session (guard-bash 2)" });
    expect(line.split("\n")).toHaveLength(2);
    expect(line.split("\n")[1]).toContain("2 hook refusals");
  });
});

describe("the session-start fetch", () => {
  it("fetches at startup and resume, once, unless opted out", () => {
    expect(fetchNeed({ source: "startup", env: {}, fetchHeadAgeMs: null })).toBe(true);
    expect(fetchNeed({ source: "resume", env: {}, fetchHeadAgeMs: 60 * 60_000 })).toBe(true);
    // A fetch minutes old is this session's own; a compaction is not a new session.
    expect(fetchNeed({ source: "startup", env: {}, fetchHeadAgeMs: 60_000 })).toBe(false);
    expect(fetchNeed({ source: "compact", env: {}, fetchHeadAgeMs: null })).toBe(false);
    expect(fetchNeed({ source: "clear", env: {}, fetchHeadAgeMs: null })).toBe(false);
    expect(
      fetchNeed({ source: "startup", env: { DIVEDAY_SESSION_FETCH: "0" }, fetchHeadAgeMs: null }),
    ).toBe(false);
  });

  it("says when the fetch failed, so a stale base is not a surprise", () => {
    expect(sessionBlock(null, { fetched: "failed" })).toContain("origin/main may be stale");
    expect(sessionBlock(null, { fetched: "fetched" })).not.toContain("stale");
  });

  it("prints the doctor's summary lines where it is given them", () => {
    const block = sessionBlock(null, { doctor: ["Doctor: one", "Stack: two"] });
    expect(block).toContain("Doctor: one\nStack: two");
  });
});

describe("the session-start block", () => {
  it("states the checkout and warns about commits on no remote", () => {
    const block = sessionBlock(checkoutState(tracked), { source: "startup" });
    expect(block).toContain(
      "branch claude/feature, upstream origin/claude/feature (3 ahead, 1 behind), 2 uncommitted paths",
    );
    expect(block).toContain("HEAD abc1234 feat: the thing");
    expect(block).toMatch(/3 local commits are not on origin\/claude\/feature/);
    expect(block).not.toContain("After compaction");
  });

  it("adds the post-compaction reminders only after a compaction", () => {
    const block = sessionBlock(checkoutState(tracked), { source: "compact" });
    expect(block).toContain("After compaction");
    expect(block).toContain("CI is the gate");
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

  it("says the merge drivers are not installed only when the install returned false", () => {
    expect(sessionBlock(null, { mergeDrivers: "not installed" })).toContain(
      "Merge drivers: not installed",
    );
    expect(sessionBlock(null, { mergeDrivers: "installed" })).not.toContain("Merge drivers");
    expect(sessionBlock(null)).not.toContain("Merge drivers");
  });

  it("asks for a papercut when a guard or hook fights the session, on every start", () => {
    for (const source of ["startup", "resume", "compact"]) {
      expect(sessionBlock(null, { source })).toContain("docs/agents/papercuts/");
    }
  });
});

describe("selecting the pinned Node", () => {
  /** A fake filesystem: directory listings, and the `node` binaries that exist. */
  const fakeFs = (dirs, binaries) => ({
    list: (dir) => {
      if (!(dir in dirs)) throw new Error("ENOENT");
      return dirs[dir];
    },
    exists: (file) => binaries.includes(file),
  });
  const env = { NVM_DIR: "/opt/nvm" };

  it("finds the newest installed release of the major, under any manager", () => {
    const fs = fakeFs(
      { "/opt/nvm/versions/node": ["v22.22.0", "v24.9.0", "v24.15.1", "v26.0.0"] },
      ["/opt/nvm/versions/node/v24.15.1/bin/node", "/opt/nvm/versions/node/v24.9.0/bin/node"],
    );
    expect(findInstalledNode(24, { env, home: "/root", ...fs })).toEqual({
      bin: "/opt/nvm/versions/node/v24.15.1/bin",
      via: "nvm",
    });
  });

  it("falls back to an /opt/node<major> directory, and to nothing", () => {
    const fs = fakeFs({}, ["/opt/node24/bin/node"]);
    expect(findInstalledNode(24, { env, home: "/root", ...fs })).toEqual({
      bin: "/opt/node24/bin",
      via: "/opt",
    });
    const none = fakeFs({ "/opt/nvm/versions/node": ["v22.22.0"] }, ["/opt/node22/bin/node"]);
    expect(findInstalledNode(24, { env, home: "/root", ...none })).toBeNull();
  });

  it("puts the pinned Node first on PATH through CLAUDE_ENV_FILE, and only on a mismatch", () => {
    const written = [];
    const append = (file, line) => written.push([file, line]);
    const find = () => ({ bin: "/opt/node24/bin", via: "/opt" });
    const sessionEnv = { CLAUDE_ENV_FILE: "/tmp/env", PATH: "/usr/bin" };

    expect(
      selectPinnedNode({ nodeMajor: 24, pinnedMajor: 24 }, { env: sessionEnv, find, append }),
    ).toBeNull();
    expect(written).toEqual([]);

    expect(
      selectPinnedNode({ nodeMajor: 22, pinnedMajor: 24 }, { env: sessionEnv, find, append }),
    ).toEqual({ status: "selected", bin: "/opt/node24/bin", via: "/opt" });
    expect(written).toEqual([["/tmp/env", 'export PATH="/opt/node24/bin:$PATH"\n']]);
    expect(sessionEnv.PATH.startsWith("/opt/node24/bin")).toBe(true);
  });

  it("reports what it could not do rather than pretending", () => {
    const append = () => {
      throw new Error("must not write");
    };
    expect(
      selectPinnedNode({ nodeMajor: 22, pinnedMajor: 24 }, { env: {}, find: () => null, append }),
    ).toEqual({ status: "unavailable" });
    expect(
      selectPinnedNode(
        { nodeMajor: 22, pinnedMajor: 24 },
        { env: {}, find: () => ({ bin: "/b", via: "nvm" }), append },
      ),
    ).toEqual({ status: "no-env-file", bin: "/b", via: "nvm" });
  });

  it("says which Node the session got, or that node_modules may be stale", () => {
    const state = checkoutState(tracked);
    const selected = sessionBlock(state, {
      nodeMajor: 22,
      pinnedMajor: 24,
      nodeSelection: { status: "selected", bin: "/opt/node24/bin", via: "/opt" },
    });
    expect(selected).toContain("Node 24 from /opt (/opt/node24/bin) is now first on PATH");
    expect(selected).not.toContain("engine warning");

    const missing = sessionBlock(state, {
      nodeMajor: 22,
      pinnedMajor: 24,
      nodeSelection: { status: "unavailable" },
    });
    expect(missing).toContain("Node 22 here, repo pins 24, and no Node 24 is installed");
    expect(missing).toContain("node_modules may have been installed under another Node");
    expect(missing).toContain("pnpm install --frozen-lockfile");
  });
});

describe("deciding whether node_modules needs an install", () => {
  const at = (times) => (file) => {
    const key = Object.keys(times).find((name) => file.endsWith(name));
    if (key === undefined) throw new Error("ENOENT");
    return times[key];
  };

  it("installs when missing, refreshes when older than the lockfile, and otherwise leaves it", () => {
    expect(installNeed("/r", { exists: () => false, mtime: at({}) })).toBe("missing");
    expect(
      installNeed("/r", {
        exists: () => true,
        mtime: at({ "pnpm-lock.yaml": 20, ".modules.yaml": 10 }),
      }),
    ).toBe("stale");
    expect(
      installNeed("/r", {
        exists: () => true,
        mtime: at({ "pnpm-lock.yaml": 10, ".modules.yaml": 20 }),
      }),
    ).toBeNull();
    // An install pnpm never recorded is not this hook's to second-guess.
    expect(
      installNeed("/r", { exists: () => true, mtime: at({ "pnpm-lock.yaml": 10 }) }),
    ).toBeNull();
  });

  it("names a refresh distinctly from a first install", () => {
    const state = checkoutState(tracked);
    expect(sessionBlock(state, { installed: "refreshed" })).toContain("older than pnpm-lock.yaml");
  });
});

describe("the author's open pull requests on the prompt line", () => {
  const ok = (value) => ({ status: 0, stdout: JSON.stringify(value) });

  it("counts the open pulls whose author is the token's own login", () => {
    const run = (_gh, args) =>
      args[1] === "user"
        ? ok({ login: "me" })
        : ok([
            { number: 12, user: { login: "me" } },
            { number: 3, user: { login: "someone" } },
            { number: 7, user: { login: "me" } },
          ]);
    expect(fetchOpenPulls({ run, repo: "o/r" })).toEqual({ login: "me", numbers: [7, 12] });
    expect(fetchOpenPulls({ run: () => ({ status: 1, stdout: "" }), repo: "o/r" })).toBeNull();
  });

  it("reads a fresh cache without asking GitHub, and refreshes a stale one", () => {
    let asked = 0;
    const fetch = () => {
      asked += 1;
      return { login: "me", numbers: [1] };
    };
    const written = [];
    const fresh = JSON.stringify({ at: 1_000, login: "me", numbers: [4, 5] });
    const io = { fetch, read: () => fresh, write: (_f, text) => written.push(text) };
    expect(readOpenPulls("/c", { now: 2_000, ...io }).numbers).toEqual([4, 5]);
    expect(asked).toBe(0);
    expect(readOpenPulls("/c", { now: 1_000 + OPEN_PULLS_TTL_MS + 1, ...io }).numbers).toEqual([1]);
    expect(asked).toBe(1);
    expect(JSON.parse(written[0]).numbers).toEqual([1]);
    expect(readOpenPulls("/c", { fetch: () => null, read: () => "torn" })).toBeNull();
  });

  it("says the count and the numbers, and nothing when it does not know", () => {
    expect(openPullsText({ login: "me", numbers: [7, 12] })).toBe("2 open PRs by me (#7, #12)");
    expect(openPullsText({ login: "me", numbers: [] })).toBe("0 open PRs by me");
    expect(openPullsText(null)).toBe("");
    const state = checkoutState(tracked);
    expect(promptLine(state, { openPulls: "1 open PR by me (#7)" })).toMatch(
      / · 1 open PR by me \(#7\)$/,
    );
  });
});

describe("the papercut ask on the prompt line", () => {
  const repeat = {
    hook: "guard-bash",
    rule: "never pipe",
    count: 3,
    slug: "guard-bash-never-pipe",
  };

  it("puts it on a line of its own, after the refusal tally", () => {
    const line = promptLine(checkoutState(tracked), {
      refusals: "3 hook refusals last session (guard-bash 3)",
      papercut: "write a papercut: …",
    });
    expect(line.split("\n")).toHaveLength(3);
    expect(line.split("\n")[2]).toBe("write a papercut: …");
  });

  it("is dropped once a papercut with that slug is in the tree", () => {
    expect(unwrittenPapercut(repeat, "/r", { list: () => ["2026-10-13-other.md"] })).toBe(repeat);
    expect(
      unwrittenPapercut(repeat, "/r", { list: () => ["2026-10-13-guard-bash-never-pipe.md"] }),
    ).toBeNull();
    expect(unwrittenPapercut(null, "/r")).toBeNull();
  });
});

/**
 * The shared checkout (`/home/claude/diveday`) is where every thread's hooks load from, and it
 * stays at the commit it had when the thread started. The fast-forward moves it only when
 * nothing could be lost: the main worktree, detached or on `main`, a clean tree, no operation
 * in progress, and no commit that is not already on `origin/main`.
 */
describe("fast-forwarding the shared checkout at session start", () => {
  const OLD = "a".repeat(40);
  const NEW = "b".repeat(40);
  const shared = (overrides = {}) =>
    gitFrom({
      "rev-parse --absolute-git-dir": "/repo/.git",
      "rev-parse --path-format=absolute --git-common-dir": "/repo/.git",
      "rev-parse --abbrev-ref HEAD": "HEAD",
      "status --porcelain": "",
      "rev-parse --verify HEAD^{commit}": OLD,
      "rev-parse --verify refs/remotes/origin/main^{commit}": NEW,
      [`rev-list --count ${NEW}..${OLD}`]: "0",
      [`rev-list --count ${OLD}..${NEW}`]: "659",
      ...overrides,
    });
  const nothing = () => false;
  const plan = (git, options = {}) =>
    fastForwardPlan(git, { source: "startup", env: {}, exists: nothing, ...options });

  it("plans a fast-forward for a clean, detached main worktree that is only behind", () => {
    expect(plan(shared())).toEqual({ from: OLD, to: NEW, behind: 659 });
    expect(plan(shared(), { source: "resume" })).toEqual({ from: OLD, to: NEW, behind: 659 });
  });

  it("also moves a clean `main` that is not ahead of origin/main", () => {
    expect(plan(shared({ "rev-parse --abbrev-ref HEAD": "main" }))).toEqual({
      from: OLD,
      to: NEW,
      behind: 659,
    });
  });

  it("never touches a linked worktree", () => {
    const git = shared({ "rev-parse --absolute-git-dir": "/repo/.git/worktrees/wt-a" });
    expect(plan(git)).toBeNull();
  });

  it("never touches any branch but main", () => {
    expect(plan(shared({ "rev-parse --abbrev-ref HEAD": "claude/feature" }))).toBeNull();
  });

  it("never touches a dirty tree, untracked files included", () => {
    expect(plan(shared({ "status --porcelain": " M src/a.ts" }))).toBeNull();
    expect(plan(shared({ "status --porcelain": "?? notes.txt" }))).toBeNull();
    expect(plan(shared({ "status --porcelain": null }))).toBeNull();
  });

  it("never touches a checkout with a commit that is not on origin/main", () => {
    expect(plan(shared({ [`rev-list --count ${NEW}..${OLD}`]: "1" }))).toBeNull();
    expect(plan(shared({ [`rev-list --count ${NEW}..${OLD}`]: null }))).toBeNull();
  });

  it("does nothing when already current, or when origin/main is unknown", () => {
    expect(plan(shared({ [`rev-list --count ${OLD}..${NEW}`]: "0" }))).toBeNull();
    expect(plan(shared({ "rev-parse --verify HEAD^{commit}": NEW }))).toBeNull();
    expect(
      plan(shared({ "rev-parse --verify refs/remotes/origin/main^{commit}": null })),
    ).toBeNull();
  });

  it("never interrupts a rebase, merge, cherry-pick, revert or bisect (each can be clean and detached)", () => {
    for (const marker of [
      "rebase-merge",
      "rebase-apply",
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "BISECT_LOG",
    ]) {
      const exists = (file) => file === path.join("/repo/.git", marker);
      expect(plan(shared(), { exists }), marker).toBeNull();
    }
  });

  it("runs at startup, resume and on every prompt, and can be opted out of", () => {
    expect(plan(shared(), { source: "prompt" })).toEqual({ from: OLD, to: NEW, behind: 659 });
    expect(plan(shared(), { source: "compact" })).toBeNull();
    expect(plan(shared(), { source: "clear" })).toBeNull();
    expect(plan(shared(), { env: { DIVEDAY_SESSION_FASTFORWARD: "0" } })).toBeNull();
  });

  it("fails open: any git question that comes back empty means no plan", () => {
    expect(plan(() => null)).toBeNull();
    expect(
      plan(() => {
        throw new Error("boom");
      }),
    ).toBeNull();
  });

  it("re-reads HEAD just before the merge and skips when another session moved it", () => {
    // Security review of #2584, finding 3: between the plan and the merge another session can
    // check out a branch (or another commit); the merge must not move that.
    const changing = (key, later) => {
      const base = shared();
      let seen = 0;
      return (args) => {
        if (args.join(" ") === key && ++seen > 1) return later;
        return base(args);
      };
    };
    for (const [key, later] of [
      ["rev-parse --abbrev-ref HEAD", "claude/feature"],
      ["rev-parse --verify HEAD^{commit}", "c".repeat(40)],
    ]) {
      const calls = [];
      const run = (...args) => {
        calls.push(args);
        return { status: 0 };
      };
      expect(
        fastForwardShared("/repo", { source: "startup", env: {}, git: changing(key, later), run }),
        key,
      ).toBeNull();
      expect(calls, key).toEqual([]);
    }
  });

  it("says what it moved in the session block, and nothing when it did not move", () => {
    const block = sessionBlock(null, {
      fastForwarded: { from: OLD, to: NEW, behind: 659 },
    });
    expect(block).toContain("Fast-forwarded this checkout 659 commits to origin/main");
    expect(block).toContain("aaaaaaaaa");
    expect(sessionBlock(null, {})).not.toContain("Fast-forwarded");
  });
});

describe("fast-forwarding a real repository", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const sh = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  const commit = (cwd, file) => {
    writeFileSync(path.join(cwd, file), file);
    sh(cwd, "add", file);
    sh(cwd, "commit", "-q", "-m", file);
    return sh(cwd, "rev-parse", "HEAD");
  };

  /** An origin with two commits on main, and a clone detached at the first, fetched. */
  function setup() {
    const root = mkdtempSync(path.join(os.tmpdir(), "ff-shared-"));
    dirs.push(root);
    const upstream = path.join(root, "upstream");
    const clone = path.join(root, "clone");
    sh(root, "init", "-q", "-b", "main", upstream);
    const first = commit(upstream, "one.txt");
    sh(root, "clone", "-q", upstream, clone);
    sh(clone, "checkout", "-q", "--detach", first);
    const second = commit(upstream, "two.txt");
    sh(clone, "fetch", "-q", "origin");
    return { root, clone, first, second };
  }

  it("moves a clean detached clone to origin/main and reports it", () => {
    const { clone, first, second } = setup();
    const result = fastForwardShared(clone, { source: "startup", env: {} });
    expect(result).toEqual({ from: first, to: second, behind: 1 });
    expect(sh(clone, "rev-parse", "HEAD")).toBe(second);
    expect(sh(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
  });

  it("leaves a dirty clone, a linked worktree and a branch with commits exactly where they were", () => {
    const { root, clone, first } = setup();

    writeFileSync(path.join(clone, "scratch.txt"), "mine");
    expect(fastForwardShared(clone, { source: "startup", env: {} })).toBeNull();
    expect(sh(clone, "rev-parse", "HEAD")).toBe(first);
    rmSync(path.join(clone, "scratch.txt"));

    const linked = path.join(root, "linked");
    sh(clone, "worktree", "add", "-q", "--detach", linked, first);
    expect(fastForwardShared(linked, { source: "startup", env: {} })).toBeNull();
    expect(sh(linked, "rev-parse", "HEAD")).toBe(first);

    sh(clone, "checkout", "-q", "-b", "claude/wip");
    const wip = commit(clone, "wip.txt");
    expect(fastForwardShared(clone, { source: "startup", env: {} })).toBeNull();
    expect(sh(clone, "rev-parse", "HEAD")).toBe(wip);

    sh(clone, "checkout", "-q", "--detach");
    expect(fastForwardShared(clone, { source: "startup", env: {} })).toBeNull();
    expect(sh(clone, "rev-parse", "HEAD")).toBe(wip);
  });

  it("never overwrites an ignored file with one main starts tracking", () => {
    const { root, clone, first } = setup();
    const upstream = path.join(root, "upstream");
    writeFileSync(path.join(clone, ".git/info/exclude"), "secret.env\n");
    writeFileSync(path.join(clone, "secret.env"), "mine");
    commit(upstream, "secret.env");
    sh(clone, "fetch", "-q", "origin");
    expect(fastForwardShared(clone, { source: "startup", env: {} })).toBeNull();
    expect(sh(clone, "rev-parse", "HEAD")).toBe(first);
    expect(readFileSync(path.join(clone, "secret.env"), "utf8")).toBe("mine");
  });
});

it("fetches branches from any agent provider", () => {
  expect(SESSION_FETCH_ARGS).toContain("+refs/heads/*:refs/remotes/origin/*");
  expect(SESSION_FETCH_ARGS.some((arg) => arg.includes("claude/*"))).toBe(false);
});
