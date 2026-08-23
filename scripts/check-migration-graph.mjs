#!/usr/bin/env node
// Do the committed migrations still form a single-headed graph?
//
// drizzle-kit 1.0 stores a full schema snapshot per migration folder, and each
// snapshot names its parents in `prevIds`. Those parents make `drizzle/` a DAG
// rather than a list: a branch cut from main today has its migration's
// `prevIds` pointing at whatever main's head was *then*, so two migrations
// authored in parallel and merged normally leave the graph with two open
// heads. `drizzle-kit check` walks every fork point in that DAG, compares the
// branches hanging below it, and refuses the tree when two of them touch the
// same object -- two columns added to `shops` in the same afternoon is all it
// takes, and this repo adds columns to `shops` from several branches a week.
//
// The reason this is a repo safeguard and not a footnote: the same walk runs
// inside `drizzle-kit migrate`, which `scripts/vercel-build.mjs` calls **in the
// production build**. Nothing else in the pipeline looks at the graph, so
// before this file existed the first thing to notice was a deploy of `main`
// dying at 11:58 with a tree diagram and no remedy, with the change already
// merged and the only way forward being a fresh commit. Running the identical
// check here moves that discovery onto the pull request: `repo-safeguards` in
// .github/workflows/ci.yml checks out the *merge* ref on a `pull_request`, so
// this sees the graph the merge would actually produce, not the one the branch
// has in isolation.
//
// It is worth being precise about what this proves, because it is less than it
// looks. `drizzle-kit check` never connects to a database and never applies
// anything -- it reads `drizzle/` and nothing else. Two branches that really do
// add the same column twice would fail *here* and would also fail the
// `real-postgres` CI job, which applies every committed migration to a live
// server from empty. That job is the proof; this is the fast, offline gate in
// front of it, and the only one that runs on every pull request.

import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// The folder to walk. `drizzle/` in every real run; the argument exists so
// `check-migration-graph.test.mjs` can point this at a fixture graph small
// enough to read, and so the answer for a reconstructed tree can be asked
// without moving the real one out of the way.
const MIGRATIONS_DIR = process.argv[2] ?? "drizzle";

// The dialect and folder are passed as flags rather than via `--config`, so
// this never loads `drizzle.config.prod.ts` and never wants a connection
// string. A check that needs a production credential to answer a question
// about files on disk is a check that gets skipped on somebody's laptop.
const ARGS = ["check", "--dialect", "postgresql", "--out", MIGRATIONS_DIR];

/** The remedy, spelled out. drizzle prints the diagram; it does not print this. */
const REMEDY = `
The graph above has more than one open head, and two of them touch the same
object. Nothing is wrong with either migration -- they were written on branches
that never saw each other -- so the fix is to close the diamond rather than to
rewrite anything:

  pnpm db:merge

That writes one more migration folder whose SQL is empty and whose snapshot
names every open head as a parent. A fork whose branches reach a common leaf is
skipped by drizzle's walk, so the tree goes quiet and no DDL is added. Commit it
with the change that provoked it.

Read the diagram before you run it. If two branches genuinely add the same
column, the merge folder will silence this check and the second \`ADD COLUMN\`
will still fail against a real server -- the \`real-postgres\` CI job is what
catches that. In that case one of the two migrations has to be rewritten to
stand on top of the other instead.
`.trimEnd();

// `drizzle-kit/bin.cjs` is not one of the package's `exports`, so it is reached
// from the package's own entry point rather than resolved directly -- which
// also keeps this working under pnpm, where `node_modules/.bin/drizzle-kit` is
// a shim in a store path rather than a file next to the package.
const require = createRequire(import.meta.url);
const drizzleKit = path.join(path.dirname(require.resolve("drizzle-kit")), "bin.cjs");

// Node directly, not `npx`/`pnpm exec`: one process instead of three, no
// network path to a registry, and no shell -- the argv above is a fixed array
// with nothing interpolated into it.
const result = runBounded(process.execPath, [drizzleKit, ...ARGS], {
  cwd: ROOT,
  encoding: "utf8",
  timeoutMs: SUBPROCESS_TIMEOUTS.drizzleKitCheck,
});

if (result.error && result.error.code !== "ETIMEDOUT") throw result.error;

if (result.status !== 0) {
  // drizzle writes the tree to stdout and the config banner to stderr; print
  // both, because which one carries the diagnosis has changed between releases.
  if (result.stdout?.trim()) console.error(result.stdout.trim());
  if (result.stderr?.trim()) console.error(result.stderr.trim());
  console.error(REMEDY);
  process.exit(1);
}

console.log(
  `migration-graph: the committed migrations in ${MIGRATIONS_DIR}/ form one converged graph`,
);
