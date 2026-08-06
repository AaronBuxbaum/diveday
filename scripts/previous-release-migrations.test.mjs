import { describe, expect, it } from "vitest";
import { migrationPathsAt, resolveBaseCommit } from "./previous-release-migrations.mjs";

/**
 * The base-commit decision, exercised against a stubbed `git` rather than real
 * repositories. Which commit this picks decides *what question the
 * real-Postgres migration test answers* — fork point (the migrations this
 * branch adds) versus previous commit (main's own step forward) — and getting
 * it silently wrong produces a green test that compared a tree with itself.
 */

/** A `run` stub: a map of joined argv -> `{ ok, out }`, anything else failing. */
function stubGit(responses) {
  return (args) => responses[args.join(" ")] ?? { ok: false, out: "fatal: stub miss" };
}

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FORK = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PARENT = "cccccccccccccccccccccccccccccccccccccccc";

describe("resolveBaseCommit", () => {
  it("uses the fork point from origin/main on a topic branch", () => {
    const run = stubGit({
      "rev-parse HEAD": { ok: true, out: `${HEAD}\n` },
      "merge-base origin/main HEAD": { ok: true, out: `${FORK}\n` },
    });
    expect(resolveBaseCommit(run)).toEqual({
      ok: true,
      commit: FORK,
      how: "merge-base origin/main HEAD",
    });
  });

  it("falls back to HEAD^ when the merge base is HEAD itself", () => {
    // A push to main, or a branch carrying no commits of its own: comparing the
    // tree against itself would prove nothing, so the previous commit is used.
    const run = stubGit({
      "rev-parse HEAD": { ok: true, out: `${HEAD}\n` },
      "merge-base origin/main HEAD": { ok: true, out: `${HEAD}\n` },
      "rev-parse HEAD^": { ok: true, out: `${PARENT}\n` },
    });
    expect(resolveBaseCommit(run)).toEqual({
      ok: true,
      commit: PARENT,
      how: "HEAD^ (no divergence from the trunk)",
    });
  });

  it("tries a local main when there is no origin remote", () => {
    const run = stubGit({
      "rev-parse HEAD": { ok: true, out: `${HEAD}\n` },
      "merge-base main HEAD": { ok: true, out: `${FORK}\n` },
    });
    expect(resolveBaseCommit(run)).toMatchObject({ commit: FORK, how: "merge-base main HEAD" });
  });

  it("refuses, naming the fix, when no history is reachable", () => {
    // The shallow-clone case. A skip here would be a test that silently stopped
    // checking anything, so the caller is told how to deepen the clone instead.
    const run = stubGit({ "rev-parse HEAD": { ok: true, out: `${HEAD}\n` } });
    const result = resolveBaseCommit(run);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("fetch-depth: 0");
  });
});

describe("migrationPathsAt", () => {
  it("keeps only migration.sql files, one folder deep, sorted", () => {
    const run = stubGit({
      "ls-tree -r --name-only deadbeef -- drizzle": {
        ok: true,
        out: [
          "drizzle/20260722_b/migration.sql",
          "drizzle/20260721_a/snapshot.json",
          "drizzle/20260721_a/migration.sql",
          "drizzle/meta/_journal.json",
          "drizzle/README.md",
        ].join("\n"),
      },
    });
    expect(migrationPathsAt("deadbeef", run)).toEqual({
      ok: true,
      paths: ["drizzle/20260721_a/migration.sql", "drizzle/20260722_b/migration.sql"],
    });
  });

  it("reports a git failure rather than an empty migration set", () => {
    // An empty set would migrate "from the previous release" by applying
    // nothing, which is indistinguishable from a from-empty run — the failure
    // has to surface as a failure.
    const result = migrationPathsAt("deadbeef", stubGit({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("git ls-tree failed");
  });
});
