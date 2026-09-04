import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import {
  BUILD_INVISIBLE_PATHSPECS,
  decideBuild,
  EXIT_BUILD,
  EXIT_SKIP,
} from "./vercel-ignore-build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A stub clone. `present` is what `git cat-file -e` can see; `fetchable` is
 * what a `--depth=1` fetch would reach; `changed` is the diff, already filtered
 * the way the real reader filters it.
 */
function fakeGit({ present = [], fetchable = [], changed = [], diffFails = false } = {}) {
  const seen = new Set(present);
  const calls = { fetched: [], diffed: [] };
  return {
    calls,
    has: (sha) => seen.has(sha),
    fetch: (sha) => {
      calls.fetched.push(sha);
      if (!fetchable.includes(sha)) return false;
      seen.add(sha);
      return true;
    },
    changedFiles: (base, head) => {
      calls.diffed.push([base, head]);
      return diffFails ? null : changed;
    },
  };
}

const BASE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("decideBuild", () => {
  it("skips only when nothing the build reads changed", () => {
    const decision = decideBuild(
      { previousSha: BASE, commitSha: HEAD },
      fakeGit({ present: [BASE, HEAD], changed: [] }),
    );
    expect(decision.build).toBe(false);
  });

  it("builds when a file the build reads changed", () => {
    const decision = decideBuild(
      { previousSha: BASE, commitSha: HEAD },
      fakeGit({ present: [BASE, HEAD], changed: ["src/app/page.tsx"] }),
    );
    expect(decision.build).toBe(true);
    expect(decision.reason).toContain("src/app/page.tsx");
  });

  it("diffs against the last *deployed* commit, not this commit's parent", () => {
    // The property a `HEAD^ HEAD` diff does not have. Vercel only advances
    // VERCEL_GIT_PREVIOUS_SHA on a **successful** deployment, so a run this
    // script cancels leaves it where it was — and the code push that follows a
    // string of docs commits still sees the code change underneath them.
    const git = fakeGit({ present: [BASE, HEAD], changed: ["src/db/schema.ts"] });
    decideBuild({ previousSha: BASE, commitSha: HEAD }, git);
    expect(git.calls.diffed).toEqual([[BASE, HEAD]]);
  });

  // Every branch below fails *open*. A wasted build costs build minutes; a
  // wrong skip leaves the deployment silently behind its branch, green.
  it("builds when there is no previous successful deployment", () => {
    const decision = decideBuild({ previousSha: "", commitSha: HEAD }, fakeGit());
    expect(decision.build).toBe(true);
    expect(decision.reason).toContain("VERCEL_GIT_PREVIOUS_SHA");
  });

  it("builds when the previously deployed commit cannot be reached", () => {
    const git = fakeGit({ present: [HEAD] });
    const decision = decideBuild({ previousSha: BASE, commitSha: HEAD }, git);
    expect(decision.build).toBe(true);
    expect(git.calls.fetched).toEqual([BASE]);
    expect(git.calls.diffed).toEqual([]);
  });

  it("deepens the shallow clone rather than giving up on it", () => {
    const git = fakeGit({ present: [HEAD], fetchable: [BASE], changed: [] });
    const decision = decideBuild({ previousSha: BASE, commitSha: HEAD }, git);
    expect(git.calls.fetched).toEqual([BASE]);
    expect(decision.build).toBe(false);
  });

  it("builds when the head commit is missing", () => {
    const decision = decideBuild(
      { previousSha: BASE, commitSha: HEAD },
      fakeGit({ present: [BASE] }),
    );
    expect(decision.build).toBe(true);
  });

  it("builds when git cannot answer the diff", () => {
    const decision = decideBuild(
      { previousSha: BASE, commitSha: HEAD },
      fakeGit({ present: [BASE, HEAD], diffFails: true }),
    );
    expect(decision.build).toBe(true);
  });
});

describe("wiring", () => {
  it("uses Vercel's polarity, which is backwards from every other script here", () => {
    expect(EXIT_BUILD).toBe(1);
    expect(EXIT_SKIP).toBe(0);
  });

  it("is the ignoreCommand vercel.json actually runs", () => {
    const config = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
    expect(config.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
  });

  it("ignores only trees `.vercelignore` has already established the build cannot read", () => {
    // `.github/` is on this list and not on `.vercelignore`'s CLI-upload list
    // for the same reason it is not on CI's: it is excluded here because a
    // workflow change cannot alter what a build produces, and included there
    // because it can alter what CI runs.
    const vercelignore = readFileSync(path.join(ROOT, ".vercelignore"), "utf8");
    for (const tree of ["docs", ".claude", ".github"]) {
      expect(BUILD_INVISIBLE_PATHSPECS).toContain(`:(exclude)${tree}/**`);
      expect(vercelignore).toMatch(new RegExp(`^${tree.replace(".", "\\.")}$`, "m"));
    }
  });

  it("every pathspec is an exclusion — the list says what to ignore, never what to build", () => {
    for (const spec of BUILD_INVISIBLE_PATHSPECS) {
      expect(spec.startsWith(":(exclude)")).toBe(true);
    }
  });

  it("bounds the one git call that leaves the machine", () => {
    const source = readFileSync(path.join(ROOT, "scripts/vercel-ignore-build.mjs"), "utf8");
    expect(source).toContain("SUBPROCESS_TIMEOUTS.gitFetch");
    expect(SUBPROCESS_TIMEOUTS.gitFetch).toBeGreaterThan(SUBPROCESS_TIMEOUTS.git);
  });
});
