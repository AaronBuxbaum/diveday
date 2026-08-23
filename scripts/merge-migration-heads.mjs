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

import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

// The repository, unless a test points this at a throwaway drizzle project.
// That escape hatch is the only way to exercise the snapshot repair below: the
// shape that provokes it needs seven migration folders in a deliberate
// arrangement, and building that inside `drizzle/` is not a thing to do to a
// real tree.
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.DIVEDAY_DB_MERGE_ROOT ?? path.join(SCRIPTS, "..");
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
  // The checker always comes from this repository, while `MIGRATIONS_DIR` is
  // whatever project is being operated on — the two are only the same thing
  // outside a test.
  const result = runBounded(
    process.execPath,
    [path.join(SCRIPTS, "check-migration-graph.mjs"), MIGRATIONS_DIR],
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

/**
 * **`generate --custom` writes a merge snapshot that can silently lose a head.**
 *
 * When the two open heads share a parent — each also having a parent the other
 * lacks, which is the ordinary shape once a repository has merged a few times —
 * drizzle writes the merge folder's snapshot as *one head's state whole*
 * instead of the union. This repository shipped one: the merge closing
 * `shop-units-confirmed` and `dive-package-line-item` kept `dive_packages` and
 * dropped `shops.units_confirmed_at`, and the next `pnpm db:generate` re-emitted
 * that column as a brand-new `ADD COLUMN` against a database that already had
 * it (issue #852).
 *
 * **It is invisible where it is cheap to find.** The merge folder's SQL is
 * empty either way; a fresh database applies the whole chain in order and is
 * fine; every test passes. It fails against a database that already ran the
 * original — the `real-postgres` job, or production, where migrations run
 * inside the build while the previous release is still serving.
 *
 * The repair is a plain `generate`. That one derives its snapshot from
 * `src/db/schema.ts`, which after both branches are on `main` *is* the merged
 * truth — so whatever it emits is exactly what the merge snapshot had lost, and
 * its own snapshot is the state the merge folder should have carried. Adopting
 * that is also correct for a column one branch **dropped**, which a naive union
 * of the two parents would wrongly resurrect.
 *
 * Returns the recovered SQL when there was any, or `null` when the snapshot was
 * already whole.
 */
function repairLostState(mergeFolder) {
  const before = migrationFolders();
  const probe = drizzle(
    ["generate", "--name", "db-merge-probe"],
    SUBPROCESS_TIMEOUTS.drizzleKitCheck,
  );
  if (probe.status !== 0) {
    console.error(
      "\ndb:merge: could not verify the merge snapshot — the probe generate failed (see above). The folder is written; check it by hand before committing.",
    );
    process.exit(probe.status ?? 1);
  }
  const [probeFolder] = [...migrationFolders()].filter((entry) => !before.has(entry));
  // Nothing written means the merge snapshot already describes the schema, and
  // there is nothing to recover.
  if (!probeFolder) return null;

  const probeDir = path.join(MIGRATIONS_DIR, probeFolder);
  const sql = readFileSync(path.join(probeDir, "migration.sql"), "utf8").trim();
  if (!sql) {
    rmSync(probeDir, { recursive: true, force: true });
    return null;
  }

  const mergeSnapshotPath = path.join(MIGRATIONS_DIR, mergeFolder, "snapshot.json");
  const merge = JSON.parse(readFileSync(mergeSnapshotPath, "utf8"));
  const probeSnapshot = JSON.parse(readFileSync(path.join(probeDir, "snapshot.json"), "utf8"));
  // The merge folder keeps its own identity and both parents; only the state it
  // claims is replaced.
  writeFileSync(
    mergeSnapshotPath,
    `${JSON.stringify({ ...merge, ddl: probeSnapshot.ddl, renames: probeSnapshot.renames }, null, 2)}\n`,
  );
  rmSync(probeDir, { recursive: true, force: true });

  // Prove the repair rather than assume it: a second probe must now find
  // nothing to write.
  const after = migrationFolders();
  const confirm = drizzle(
    ["generate", "--name", "db-merge-confirm"],
    SUBPROCESS_TIMEOUTS.drizzleKitCheck,
  );
  const [leftover] = [...migrationFolders()].filter((entry) => !after.has(entry));
  if (leftover) rmSync(path.join(MIGRATIONS_DIR, leftover), { recursive: true, force: true });
  if (confirm.status !== 0 || leftover) {
    console.error(
      `\ndb:merge: repaired drizzle/${mergeFolder}'s snapshot and it still does not describe src/db/schema.ts. That means the schema has pending changes of its own, which need their own migration — commit or revert those first, delete drizzle/${mergeFolder}, and rerun.`,
    );
    process.exit(1);
  }
  return sql;
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

const recovered = repairLostState(folder);

console.log(`\ndb:merge: wrote drizzle/${folder}. Commit it with the change that provoked it.`);
if (recovered) {
  console.log(
    `db:merge: its snapshot had lost state from one head, and that has been repaired in place.\n${recovered
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")}`,
  );
}
