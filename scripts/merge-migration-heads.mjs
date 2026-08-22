#!/usr/bin/env node

// Close a diamond in the migration graph: `pnpm db:merge`.
//
// `scripts/check-migration-graph.mjs` explains the failure this repairs. The
// short version: `drizzle/` is a DAG whose nodes name their parents, two
// branches merged in parallel leave two open heads, and drizzle refuses a tree
// whose divergent heads touch the same object -- inside the production build.
//
// The repair is one migration folder with no SQL in it whose snapshot names
// every open head as a parent, because drizzle skips a fork whose branches
// reach a common leaf. That is what `drizzle-kit generate --custom` already
// produces; this script exists for the three things around it.
//
//  1. **It refuses to run when the graph is already converged.** Left as a bare
//     `drizzle-kit generate --custom`, this command silently writes an empty
//     migration folder every time anyone runs it speculatively, and those
//     accumulate forever with nothing to say they were pointless.
//  2. **It writes the folder's own explanation into its SQL**, replacing
//     drizzle's "put your code below!" placeholder. An empty migration is
//     exactly the thing a future reader will try to delete.
//  3. **It re-runs the check afterwards**, so the command's exit code means
//     "the graph converged" rather than "a folder was written".
//
// `--ignore-conflicts` is passed to the generate step and only to it: without
// it, generate refuses for the very reason it is being run. The check on either
// side of it is what keeps that honest.

import { readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle");

const require = createRequire(import.meta.url);
const drizzleKit = path.join(path.dirname(require.resolve("drizzle-kit")), "bin.cjs");

function drizzle(args, timeoutMs) {
  return runBounded(process.execPath, [drizzleKit, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    timeoutMs,
  });
}

function graphIsConverged() {
  const result = runBounded(
    process.execPath,
    [path.join(ROOT, "scripts/check-migration-graph.mjs")],
    {
      cwd: ROOT,
      stdio: "inherit",
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    },
  );
  return result.status === 0;
}

function migrationFolders() {
  return new Set(
    readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
}

if (graphIsConverged()) {
  console.log(
    "\ndb:merge: nothing to do — the migration graph already has a single head, or its open heads touch nothing in common. No folder written.",
  );
  process.exit(0);
}

const before = migrationFolders();

const generated = drizzle(
  ["generate", "--custom", "--name", "merge-migration-heads", "--ignore-conflicts"],
  SUBPROCESS_TIMEOUTS.drizzleKitCheck,
);
if (generated.status !== 0) {
  console.error("\ndb:merge: drizzle-kit could not write the merge folder (see above).");
  process.exit(generated.status ?? 1);
}

const written = [...migrationFolders()].filter((folder) => !before.has(folder));
if (written.length !== 1) {
  console.error(
    `\ndb:merge: expected drizzle-kit to write exactly one folder, saw ${written.length}. Nothing has been edited; check \`git status drizzle\` before rerunning.`,
  );
  process.exit(1);
}

const [folder] = written;
writeFileSync(
  path.join(MIGRATIONS_DIR, folder, "migration.sql"),
  `-- Deliberately empty. This migration exists for its snapshot, not its SQL.
--
-- Two branches each added a migration, each merged cleanly, and neither ever
-- saw the other -- so the migration graph was left with two open heads whose
-- branches touch the same object. drizzle refuses that tree, and the walk that
-- refuses it also runs inside the production build.
--
-- This snapshot names both heads as its parents, which closes the diamond: a
-- fork whose branches reach a common leaf is skipped by the walk. Nothing is
-- applied and nothing changes shape. Written by \`pnpm db:merge\`; see
-- scripts/check-migration-graph.mjs and the schema-change skill.
`,
);

if (!graphIsConverged()) {
  console.error(
    `\ndb:merge: wrote drizzle/${folder}, and the graph is still refused. That means two branches genuinely collide rather than merely diverging — read the report above, delete that folder, and regenerate one of the two migrations on top of the other instead.`,
  );
  process.exit(1);
}

console.log(`\ndb:merge: wrote drizzle/${folder}. Commit it with the change that provoked it.`);
