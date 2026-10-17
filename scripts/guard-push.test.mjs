import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  forkRefusal,
  gitAnswers,
  OVERRIDE,
  overrideReason,
  parsePush,
  pushViolation,
  verifiedFile,
} from "./guard-push.mjs";

/**
 * A push guard that refuses something legitimate gets routed around, so the "leaves alone"
 * cases carry as much weight as the refusals.
 */

const answers = (overrides = {}) => ({
  head: () => "aaa111",
  branch: () => "claude/layer",
  sha: (ref) => ({ "claude/other": "bbb222" })[ref] ?? null,
  remoteHas: () => false,
  stamp: () => null,
  ...overrides,
});

describe("an unverified push", () => {
  it("is refused, naming verify:push and the way to say why", () => {
    const reason = pushViolation("git push -u origin claude/layer", answers());
    expect(reason).toMatch(/pnpm verify:push --quick/);
    expect(reason).toContain(`${OVERRIDE}="<reason>" git push -u origin claude/layer`);
  });

  it("is refused inside a chain, after a merge from below made a new HEAD", () => {
    const read = answers({ stamp: () => "old999" });
    expect(
      pushViolation("git merge origin/claude/below && git push -u origin claude/layer", read),
    ).not.toBeNull();
  });

  it("checks the branch a refspec names, not HEAD", () => {
    const read = answers({ stamp: () => "aaa111" });
    expect(pushViolation("git push origin claude/other", read)).toMatch(/bbb222/);
  });

  it("refuses an override with no real reason", () => {
    expect(pushViolation(`${OVERRIDE}=1 git push -u origin claude/layer`, answers())).toMatch(
      /reason/,
    );
  });
});

describe("an override for a red that came from below", () => {
  // The reasons the override carried on 2026-10-14, and the shapes around them.
  it.each([
    "verify:push is red only on two tests in src/db/open-local-db.test.ts that fail on main too",
    "red on main, not mine",
    "the lint error is inherited from the layer below",
    "known flake in the PGlite close",
    "these failures are pre-existing",
    "main is red on two unit shards",
  ])("is refused, pointing at verify:push's base check: %s", (why) => {
    const reason = pushViolation(`${OVERRIDE}="${why}" git push -u origin claude/layer`, answers());
    expect(reason).toMatch(/reads the layer below's CI/);
  });

  it("leaves the two cases the override is for", () => {
    for (const why of [
      "saving work before the container is reclaimed",
      "only CI can render the visual diff for this capture",
    ]) {
      expect(pushViolation(`${OVERRIDE}="${why}" git push`, answers())).toBeNull();
    }
  });
});

describe("leaves alone", () => {
  it("a push of the commit the stamp names", () => {
    expect(
      pushViolation("git push -u origin claude/layer", answers({ stamp: () => "aaa111" })),
    ).toBeNull();
  });

  it("a push with a stated reason", () => {
    const command = `${OVERRIDE}="saving work before the container is reclaimed" git push -u origin claude/layer`;
    expect(pushViolation(command, answers())).toBeNull();
  });

  it("a commit the remote already has, a deletion, a tag push", () => {
    expect(
      pushViolation("git push -u origin claude/layer", answers({ remoteHas: () => true })),
    ).toBeNull();
    expect(pushViolation("git push origin --delete claude/old", answers())).toBeNull();
    expect(pushViolation("git push origin :claude/old", answers())).toBeNull();
    expect(pushViolation("git push --tags", answers())).toBeNull();
  });

  it("commands that only mention a push", () => {
    expect(pushViolation(`git stash push -u -m "wip"`, answers())).toBeNull();
    expect(pushViolation(`git log --grep "push"`, answers())).toBeNull();
    expect(pushViolation(`echo "then git push"`, answers())).toBeNull();
  });

  it("reads `git -C <dir> push` as a push", () => {
    expect(parsePush("git -C ../wt push -u origin x")).toMatchObject({
      positional: ["origin", "x"],
    });
  });
});

describe("the reason a push gave for skipping verify:push", () => {
  it("is read back so the hook can log it", () => {
    expect(
      overrideReason(
        `git fetch && ${OVERRIDE}="saving work before the container is reclaimed" git push`,
      ),
    ).toBe("saving work before the container is reclaimed");
  });

  it("is null for a plain push, a non-push, and a reason too short to count", () => {
    expect(overrideReason("git push -u origin claude/layer")).toBeNull();
    expect(overrideReason("git status")).toBeNull();
    expect(overrideReason(`${OVERRIDE}=skip git push`)).toBeNull();
  });
});

/**
 * Every thread's session cwd is the shared checkout, and builds happen in worktrees: the hook's
 * `cwd` is the shared checkout even for `cd <worktree> && git push` or `git -C <worktree> push`.
 * The guard reads the worktree the command names, and the stamp is keyed by sha in the common
 * git dir, so a commit verified in any worktree is verified everywhere.
 */
describe("a push from another worktree", () => {
  const shared = answers({ head: () => "zzz000", branch: () => "HEAD" });
  const worktree = answers({ head: () => "ccc333", verified: (sha) => sha === "ccc333" });
  const byDir = (dir) => (dir === "/wt" ? worktree : shared);

  it("reads the worktree a leading `cd <dir> &&` names", () => {
    expect(pushViolation("cd /wt && git push -u origin claude/layer", byDir, "/shared")).toBeNull();
    expect(pushViolation("cd /wt && git push", byDir, "/shared")).toBeNull();
  });

  it("reads the worktree `git -C <dir>` names, relative to the session's cwd", () => {
    expect(pushViolation("git -C /wt push -u origin claude/layer", byDir, "/shared")).toBeNull();
    expect(pushViolation("git -C ../wt push", byDir, "/x")).toBeNull();
  });

  it("still refuses an unverified sha there", () => {
    const unverified = (dir) => (dir === "/wt" ? answers({ head: () => "ddd444" }) : shared);
    expect(pushViolation("cd /wt && git push", unverified, "/shared")).toMatch(/ddd444/);
    expect(pushViolation("git -C /wt push", unverified, "/shared")).toMatch(/ddd444/);
  });

  it("accepts the sha-keyed stamp beside the old per-worktree one", () => {
    expect(pushViolation("git push", answers({ verified: (sha) => sha === "aaa111" }))).toBeNull();
  });
});

describe("a push from a real worktree", () => {
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

  function setup() {
    const root = mkdtempSync(path.join(os.tmpdir(), "guard-push-"));
    dirs.push(root);
    const repo = path.join(root, "repo");
    const wt = path.join(root, "wt");
    sh(root, "init", "-q", "-b", "main", repo);
    writeFileSync(path.join(repo, "a.txt"), "a");
    sh(repo, "add", "a.txt");
    sh(repo, "commit", "-q", "-m", "a");
    sh(repo, "worktree", "add", "-q", "-b", "claude/layer", wt);
    writeFileSync(path.join(wt, "b.txt"), "b");
    sh(wt, "add", "b.txt");
    sh(wt, "commit", "-q", "-m", "b");
    return { root, repo, wt, sha: sh(wt, "rev-parse", "HEAD") };
  }
  const read = (dir) => gitAnswers(dir);

  it("passes a commit stamped in the worktree, pushed with the shared checkout as cwd", () => {
    const { repo, wt, sha } = setup();
    const command = `cd ${wt} && git push -u origin claude/layer`;
    expect(pushViolation(command, read, repo)).toMatch(/verify:push/);
    const file = verifiedFile(path.join(repo, ".git"), sha);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ sha }));
    expect(pushViolation(command, read, repo)).toBeNull();
    expect(pushViolation(`git -C ${wt} push`, read, repo)).toBeNull();
  });

  it("reads the stamp of a separate clone, not the shared checkout's", () => {
    const { repo, root } = setup();
    const clone = path.join(root, "clone");
    sh(root, "clone", "-q", repo, clone);
    sh(clone, "checkout", "-q", "-b", "claude/other");
    writeFileSync(path.join(clone, "c.txt"), "c");
    sh(clone, "add", "c.txt");
    sh(clone, "commit", "-q", "-m", "c");
    const sha = sh(clone, "rev-parse", "HEAD");
    const commands = [`cd ${clone} && git push -u origin claude/other`, `git -C ${clone} push`];
    for (const command of commands)
      expect(pushViolation(command, read, repo)).toMatch(/verify:push/);
    const file = verifiedFile(path.join(clone, ".git"), sha);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ sha }));
    for (const command of commands) expect(pushViolation(command, read, repo)).toBeNull();
  });

  it("still reads the old per-worktree stamp, from the worktree the command names", () => {
    const { repo, wt, sha } = setup();
    writeFileSync(
      path.join(repo, ".git/worktrees/wt/diveday-verified.json"),
      JSON.stringify({ sha }),
    );
    expect(pushViolation(`cd ${wt} && git push`, read, repo)).toBeNull();
  });
});

describe("a push that would fork a stack (#2587)", () => {
  const pull = (number, headRefName, baseRefName) => ({ number, headRefName, baseRefName });
  const open = [pull(2581, "s9", "main"), pull(2582, "dn", "s9"), pull(2585, "tw", "dn")];

  it("names the current top and the rebase that moves the branch onto it", () => {
    const reason = forkRefusal({ branch: "tw8", parent: "s9", pulls: open });
    expect(reason).toMatch(/#2582 already stack on/);
    expect(reason).toMatch(/current top is #2585 \(`tw`\)/);
    expect(reason).toContain("git rebase --onto origin/tw origin/s9 tw8");
  });

  it("prints a number, not a branch name, when the name is not plainly one", () => {
    const hostile = [
      pull(2581, "s9", "main"),
      pull(2582, "dn", "s9"),
      pull(2585, "x$(touch /tmp/pwn)", "dn"),
    ];
    const reason = forkRefusal({ branch: "tw8", parent: "s9", pulls: hostile });
    expect(reason).not.toContain("touch");
    expect(reason).toContain("current top is #2585 (#2585)");
    expect(reason).not.toContain("git fetch origin && git rebase");
  });

  it("leaves a branch alone when its parent has no other layer on it", () => {
    expect(forkRefusal({ branch: "next", parent: "tw", pulls: open })).toBeNull();
  });

  it("leaves a branch that already has its own pull request, and one with no open parent", () => {
    expect(forkRefusal({ branch: "dn", parent: "s9", pulls: open })).toBeNull();
    expect(forkRefusal({ branch: "fresh", parent: undefined, pulls: open })).toBeNull();
  });

  it("stops a push before the verify:push check, even for a verified commit", () => {
    const read = answers({ stamp: () => "aaa111", fork: () => "would fork" });
    expect(pushViolation("git push -u origin claude/layer", read)).toBe("would fork");
  });

  it("does not look when the push is of some other branch", () => {
    const read = answers({ stamp: () => "bbb222", fork: () => "would fork" });
    expect(pushViolation("git push origin claude/other", read)).toBeNull();
  });
});
