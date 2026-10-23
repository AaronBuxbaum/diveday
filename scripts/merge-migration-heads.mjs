#!/usr/bin/env node

// Close a diamond in the migration graph: `pnpm db:merge`.
//
// `scripts/check-migration-graph.mjs` explains the failure this repairs. The
// short version: `drizzle/` is a DAG whose nodes name their parents, two
// branches merged in parallel leave two open heads, and drizzle refuses a tree
// whose divergent heads touch the same object -- inside the production build.
//
// The repair is one migration folder with no SQL in it whose snapshot names
// every open head as a parent, because drizzle only compares open heads, and a
// merge node leaves one. drizzle-kit 1.0.0-rc.5 no longer writes that folder:
// `generate --ignore-conflicts` is refused for postgresql, and the only remedy
// it offers, `generate --fix-conflicts`, deletes the conflicting migrations --
// which production has already applied. So this writes the folder itself, in
// the same version-9 shape `generate --custom` gives a node with no changes,
// and does the three things around it:
//
//  1. **It refuses to run when the graph is already converged**, so a
//     speculative run never leaves a pointless empty folder behind.
//  2. **It writes the folder's own explanation into its SQL.** An empty
//     migration is exactly the thing a future reader will try to delete.
//  3. **It re-runs the check afterwards and then probes with a plain
//     `generate`**, so the exit code means "the graph converged and its state
//     is `src/db/schema/`" rather than "a folder was written".

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

// The repository, unless a test points this at a throwaway drizzle project.
// That escape hatch is the only way to exercise the merge end to end: the shape
// that provokes it needs seven migration folders in a deliberate arrangement,
// and building that inside `drizzle/` is not a thing to do to a real tree.
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
 * **The merge node's state must be both heads, not one** (issue #852).
 *
 * Before snapshot version 9 a merge snapshot carried a whole schema, and
 * `generate --custom` wrote one head's state into it when the two heads shared
 * a parent; the next `generate` re-emitted the lost column as a fresh
 * `ADD COLUMN` against a database that already had it. A version-9 merge node
 * carries no state: drizzle rebuilds it from its parents. This proves that
 * rebuild against `src/db/schema/`, which after both branches are on `main` is
 * the merged truth: a plain `generate` must find nothing to write.
 *
 * Returns the SQL the probe wrote, or `null` when the merge state is whole.
 */
function probeMergedState() {
  const before = migrationFolders();
  const probe = drizzle(
    ["generate", "--name", "db-merge-probe"],
    SUBPROCESS_TIMEOUTS.drizzleKitCheck,
  );
  const [probeFolder] = [...migrationFolders()].filter((entry) => !before.has(entry));
  if (probe.status !== 0) {
    if (probeFolder)
      rmSync(path.join(MIGRATIONS_DIR, probeFolder), { recursive: true, force: true });
    console.error(
      "\ndb:merge: could not verify the merge folder -- the probe generate failed (see above). The folder is written; check it by hand before committing.",
    );
    process.exit(probe.status ?? 1);
  }
  if (!probeFolder) return null;
  const probeDir = path.join(MIGRATIONS_DIR, probeFolder);
  const sql = readFileSync(path.join(probeDir, "migration.sql"), "utf8").trim();
  rmSync(probeDir, { recursive: true, force: true });
  return sql || null;
}

/** Every snapshot id that no other snapshot names as a parent. */
function openHeads() {
  const snapshots = [...migrationFolders()]
    .map((folder) => path.join(MIGRATIONS_DIR, folder, "snapshot.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")));
  const parents = new Set(snapshots.flatMap((snapshot) => snapshot.prevIds ?? []));
  return snapshots.map((snapshot) => snapshot.id).filter((id) => !parents.has(id));
}

/** `YYYYMMDDHHMMSS`, UTC, a second after the newest folder if the clock is behind it. */
function folderPrefix() {
  const newest = Math.max(
    0,
    ...[...migrationFolders()].map((folder) => {
      const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(folder);
      return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 1000 : 0;
    }),
  );
  return new Date(Math.max(Date.now(), newest)).toISOString().replace(/\D/g, "").slice(0, 14);
}

if (graphIsConverged()) {
  console.log(
    "\ndb:merge: nothing to do — the migration graph already has a single head, or its open heads touch nothing in common. No folder written.",
  );
  process.exit(0);
}

const folder = `${folderPrefix()}_merge-migration-heads`;
mkdirSync(path.join(MIGRATIONS_DIR, folder));
writeFileSync(
  path.join(MIGRATIONS_DIR, folder, "snapshot.json"),
  `${JSON.stringify(
    {
      type: "diff",
      version: "9",
      dialect: "postgres",
      id: randomUUID(),
      prevIds: openHeads(),
      footprints: [],
      deltas: [],
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  path.join(MIGRATIONS_DIR, folder, "migration.sql"),
  `-- Deliberately empty. This migration exists for its snapshot, not its SQL.
--
-- Two branches each added a migration, each merged cleanly, and neither ever
-- saw the other -- so the migration graph was left with two open heads whose
-- branches touch the same object. drizzle refuses that tree, and the walk that
-- refuses it also runs inside the production build.
--
-- This snapshot names both heads as its parents, which closes the diamond:
-- drizzle compares open heads only, and this leaves one. Nothing is applied and
-- nothing changes shape. Written by \`pnpm db:merge\`; see
-- scripts/check-migration-graph.mjs and the schema-change skill.
`,
);

if (!graphIsConverged()) {
  console.error(
    `\ndb:merge: wrote drizzle/${folder}, and the graph is still refused. That means two branches genuinely collide rather than merely diverging — read the report above, delete that folder, and regenerate one of the two migrations on top of the other instead.`,
  );
  process.exit(1);
}

const pending = probeMergedState();
if (pending) {
  console.error(
    `\ndb:merge: wrote drizzle/${folder}, and a plain generate still finds SQL to write against it:\n${pending
      .split("\n")
      .map((line) => `  ${line}`)
      .join(
        "\n",
      )}\nEither src/db/schema/ has pending changes of its own, which need their own migration (commit or revert those first), or drizzle rebuilt the merge state without one head's changes. Delete drizzle/${folder} and rerun once the schema is clean.`,
  );
  process.exit(1);
}

console.log(`\ndb:merge: wrote drizzle/${folder}. Commit it with the change that provoked it.`);
