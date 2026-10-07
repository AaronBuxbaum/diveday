import { describe, expect, it } from "vitest";

import {
  checkoutState,
  findInstalledNode,
  installNeed,
  promptLine,
  selectPinnedNode,
  sessionBlock,
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
