// Materialize the `drizzle/` migration set as it stood on the *previous release*
// — the commit this branch forked from — into a throwaway directory, so a test
// can apply that set to an empty Postgres and then apply today's set on top of
// it.
//
// ## Why this exists
//
// Applying `drizzle/` to an empty database proves the migrations are internally
// consistent. It does not prove the thing production actually does, which is
// apply *only the new* migrations to a database that already carries every
// older one. Those are different questions, and only the second one can catch a
// contracting migration — a `DROP COLUMN`, a rename, a `NOT NULL` on a
// populated table — because from empty there is nothing to contract. The
// expand/contract rule in docs/engineering/deploy-and-migrations-runbook.md is
// exactly a rule about the second question.
//
// The previous release's migration set lives in git, so that is where this
// reads it from. Nothing is checked out and no ref is moved: `git ls-tree` +
// `git show` stream the blobs straight out of the object store into the output
// directory, which leaves a working tree with other sessions' uncommitted
// changes in it completely untouched (AGENTS.md, "Parallel work").
//
// ## Only `migration.sql` is copied
//
// drizzle-orm's `readMigrationFiles` scans the folder for
// `<subdir>/migration.sql` and reads nothing else, and it *throws* outright on a
// folder containing `meta/_journal.json` (the pre-1.0 layout). Copying just the
// SQL therefore both keeps the extraction cheap and makes it robust across a
// base commit that predates the current layout — a `snapshot.json` or a stale
// journal in the base tree can neither confuse the migrator nor break this.
//
// ## Which commit counts as "the previous release"
//
// `git merge-base origin/main HEAD` — the point this branch left the trunk, so
// the diff is exactly the migrations this branch is proposing. Two fallbacks,
// both reported in the output so a reader always knows which question was
// answered:
//
//   - On `main` itself (a push, or a branch with nothing new), the merge base
//     *is* HEAD, which would make the comparison vacuous. `HEAD^` is used
//     instead: "the state one commit ago", which is the honest analogue there.
//   - With no `origin/main` at all (a bare clone, a fork), plain `main` is
//     tried before falling back to `HEAD^`.
//
// A shallow clone deep enough to reach neither is a hard failure, not a silent
// skip: the caller is told to fetch history (`fetch-depth: 0` in CI) rather than
// quietly proving nothing. `.github/workflows/ci.yml`'s real-postgres job checks
// out full history for this reason.
//
// Usage:
//   node scripts/previous-release-migrations.mjs [--out <dir>]
// Prints one JSON object on stdout; exits 1 with `{ ok: false, reason }` when
// no base commit can be resolved.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The result shapes, spelled out so a TypeScript caller can narrow on `ok`.
 *
 * Without these the inferred type of every return is a union of object literals
 * whose `ok` is widened to `boolean`, which does not discriminate — so
 * `if (!result.ok) ... result.reason` fails to compile even though it is exactly
 * how these are meant to be used. `src/db/migrations.postgres.test.ts` is that
 * caller, and it is the reason this file carries types at all.
 *
 * @typedef {{ ok: false, reason: string }} Failure
 * @typedef {{ ok: true, commit: string, how: string }} BaseCommit
 * @typedef {{ ok: true, paths: string[] }} MigrationPaths
 * @typedef {{ ok: true, count: number }} Materialized
 * @typedef {{ ok: true, commit: string, how: string, dir: string, migrations: number }} Extraction
 */

/**
 * One `git` invocation in the repo root, as `{ ok, out }` — a non-zero exit is
 * data, not a throw, because "this ref does not exist here" is an expected
 * answer for half the calls below. Every exported function takes this as an
 * injectable parameter so the decisions are testable without building
 * repositories.
 */
function defaultRun(args) {
  // Bounded: this script runs inside `pnpm check:repo`'s destructive-migration
  // guard and inside the production build, so a `git` wedged on an index lock
  // must become a failure rather than a build that never finishes.
  const result = runBounded("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  if (result.error || result.status !== 0) {
    // `stderr` first, but a timeout kill leaves it empty and puts the diagnosis
    // on `error` -- so an empty one falls through rather than reporting nothing.
    const detail = result.stderr?.trim() || String(result.error ?? "");
    return { ok: false, out: detail.trim() };
  }
  return { ok: true, out: result.stdout };
}

/**
 * The commit whose `drizzle/` tree stands in for the previous release.
 *
 * @param {typeof defaultRun} [run]
 * @returns {BaseCommit | Failure}
 */
export function resolveBaseCommit(run = defaultRun) {
  const head = run(["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: "not a git repository (git rev-parse HEAD failed)" };
  const headSha = head.out.trim();

  for (const trunk of ["origin/main", "main"]) {
    const base = run(["merge-base", trunk, "HEAD"]);
    if (!base.ok) continue;
    const sha = base.out.trim();
    if (!sha) continue;
    // A merge base equal to HEAD means there is nothing between the trunk and
    // here — this *is* main, or a branch with no commits of its own. Comparing
    // a tree against itself proves nothing, so drop to the previous commit.
    if (sha !== headSha) return { ok: true, commit: sha, how: `merge-base ${trunk} HEAD` };
    break;
  }

  const parent = run(["rev-parse", "HEAD^"]);
  if (parent.ok && parent.out.trim()) {
    return { ok: true, commit: parent.out.trim(), how: "HEAD^ (no divergence from the trunk)" };
  }
  return {
    ok: false,
    reason:
      "no base commit reachable — the clone has no origin/main and no parent commit. " +
      "Fetch history (CI: actions/checkout with fetch-depth: 0; locally: git fetch --unshallow).",
  };
}

/**
 * The `drizzle/<folder>/migration.sql` paths present in a commit's tree.
 *
 * @param {string} commit
 * @param {typeof defaultRun} [run]
 * @returns {MigrationPaths | Failure}
 */
export function migrationPathsAt(commit, run = defaultRun) {
  const listed = run(["ls-tree", "-r", "--name-only", commit, "--", "drizzle"]);
  if (!listed.ok) return { ok: false, reason: `git ls-tree failed at ${commit}: ${listed.out}` };
  const paths = listed.out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^drizzle\/[^/]+\/migration\.sql$/.test(line))
    .sort();
  return { ok: true, paths };
}

/**
 * Write a commit's migration SQL into `outDir`, preserving `<folder>/migration.sql`
 * — the layout drizzle-orm's migrator reads. Returns how many were written.
 *
 * @param {string} commit
 * @param {string} outDir
 * @param {typeof defaultRun} [run]
 * @returns {Materialized | Failure}
 */
export function materializeMigrations(commit, outDir, run = defaultRun) {
  const listed = migrationPathsAt(commit, run);
  if (!listed.ok) return listed;
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const relative of listed.paths) {
    const folder = path.basename(path.dirname(relative));
    const shown = run(["show", `${commit}:${relative}`]);
    if (!shown.ok) return { ok: false, reason: `git show failed for ${relative}: ${shown.out}` };
    mkdirSync(path.join(outDir, folder), { recursive: true });
    writeFileSync(path.join(outDir, folder, "migration.sql"), shown.out);
  }
  return { ok: true, count: listed.paths.length };
}

/**
 * The whole job: resolve the base commit and lay its migrations out on disk.
 *
 * @param {string} outDir
 * @param {typeof defaultRun} [run]
 * @returns {Extraction | Failure}
 */
export function extractPreviousReleaseMigrations(outDir, run = defaultRun) {
  const base = resolveBaseCommit(run);
  if (!base.ok) return base;
  const written = materializeMigrations(base.commit, outDir, run);
  if (!written.ok) return written;
  return {
    ok: true,
    commit: base.commit,
    how: base.how,
    dir: outDir,
    migrations: written.count,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flagIndex = process.argv.indexOf("--out");
  const outDir =
    flagIndex >= 0 && process.argv[flagIndex + 1]
      ? path.resolve(process.argv[flagIndex + 1])
      : mkdtempSync(path.join(tmpdir(), "diveday-prev-migrations-"));
  const result = extractPreviousReleaseMigrations(outDir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
