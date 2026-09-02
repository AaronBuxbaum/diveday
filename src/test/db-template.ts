import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { seedDemo } from "@/db/seed";

/**
 * Template-database snapshots for the PGlite integration tests.
 *
 * Booting a fresh test database used to cost every single test the full
 * migration replay plus the demo seed (~3s each, ~130 tests). Instead, the
 * Vitest global setup builds those databases once, dumps each data directory to
 * a cache file, and every test hydrates an isolated in-memory clone from the
 * dump in a few hundred milliseconds. Same isolation, ~10x cheaper.
 */

/**
 * The three database shapes tests ask for. `lean` is the small controlled
 * demo dataset unit tests are calibrated to; `history` adds seed.ts's
 * trailing-quarter back-fill, which the reporting-shaped assertions in
 * src/db/orders.test.ts, export.test.ts and search.test.ts read numbers out of.
 * `empty` is migrated and nothing else — what {@link unseededTestDb} hands a
 * test that seeds for itself, or whose subject *is* seeding.
 *
 * Every shape gets a snapshot: a variant without one costs its callers the
 * full build on every single test. That is ~8.5s for the seeded pair and
 * ~3.5s for `empty` — and the second number is why `empty` is here at all.
 * It was the only shape still paying `initdb + migrate` per test, which made
 * `src/db/seed.test.ts`'s atomic-rollback test 5.4s of which 3.5s was the
 * migration replay rather than the seed it is about (issue #1271).
 */
export type TemplateVariant = "lean" | "history" | "empty";

const VARIANTS: readonly TemplateVariant[] = ["lean", "history", "empty"];

// Worktrees can share a host-level node_modules volume. Allow a runner to
// isolate its snapshot so another checkout cannot replace it mid-run.
const CACHE_DIR =
  process.env.DIVEDAY_TEST_CACHE_DIR ??
  path.join(process.cwd(), "node_modules", ".cache", "diveday");
const META_FILE = path.join(CACHE_DIR, "test-db-template.json");

const TEMPLATE_FILENAME: Record<TemplateVariant, string> = {
  lean: "test-db-template.tar",
  history: "test-db-template-history.tar",
  empty: "test-db-template-empty.tar",
};

function templateFile(variant: TemplateVariant): string {
  return path.join(CACHE_DIR, TEMPLATE_FILENAME[variant]);
}

/**
 * Everything the templates' contents depend on: migrations, db source (schema,
 * seed, queries), and the frozen instant.
 *
 * The snapshots never expire. The demo seed is clock-anchored — one trip always
 * sails *today*, departures round to upcoming half-hour slots — but it reads
 * time only through `nowMs()`/`nowDate()` (src/lib/clock.ts), and global-setup.ts
 * pins `DIVEDAY_CLOCK` to `TEST_FROZEN_CLOCK` before calling
 * {@link ensureTestDbTemplate}. The build is therefore deterministic: rebuilding
 * it tomorrow produces the same bytes, and "today" in the snapshot is the same
 * "today" every test's own `nowDate()` returns. Only a change to one of these
 * inputs — including the frozen instant itself — can make a snapshot wrong, and
 * each one moves this fingerprint.
 */
async function inputsFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  for (const root of ["drizzle", "src/db"]) {
    const files = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .sort();
    for (const file of files) {
      hash.update(file);
      hash.update(await readFile(file));
    }
  }
  // The instant the seed is anchored to. Not under `src/db`, but every row's
  // dates derive from it, so a snapshot built against a different one is stale.
  hash.update(await readFile("src/test/frozen-clock.ts"));
  return hash.digest("hex");
}

/** Migrate (and, for the seeded variants, seed) one variant and dump its data directory. */
async function buildSnapshot(variant: TemplateVariant): Promise<Buffer> {
  const client = new PGlite({ extensions: { pg_trgm, btree_gist } });
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "drizzle" });
  if (variant === "empty") {
    const emptyDump = await client.dumpDataDir("none");
    await client.close();
    return Buffer.from(await emptyDump.arrayBuffer());
  }
  // The `lean` fixture has no trailing-quarter back-fill. That history is for
  // the demo experience, the e2e/visual-regression fleet, and the handful of
  // reporting-shaped unit tests that ask for `{ history: true }`; everything
  // else is calibrated to the small, controlled dataset and builds its own
  // history when it needs it (src/db/reporting.test.ts).
  await seedDemo(db, { history: variant === "history" });
  const dump = await client.dumpDataDir("none");
  await client.close();
  return Buffer.from(await dump.arrayBuffer());
}

/** Build (or reuse) the migrated (and, for two of three, demo-seeded) snapshots. Once per run. */
export async function ensureTestDbTemplate(): Promise<void> {
  const fingerprint = await inputsFingerprint();
  const meta = await readFile(META_FILE, "utf8")
    .then((raw) => JSON.parse(raw) as { fingerprint: string; variants?: string[] })
    .catch(() => null);
  const cached =
    meta?.fingerprint === fingerprint &&
    VARIANTS.every((variant) => meta.variants?.includes(variant));
  if (cached) return;

  await mkdir(CACHE_DIR, { recursive: true });
  for (const variant of VARIANTS) {
    // Written to a sibling and renamed, never to the live path. `writeFile`
    // truncates first and then streams ~70MB, so for the whole of that window
    // the file a *parallel* Vitest invocation is hydrating from is empty and
    // then partial — and this repo expects parallel invocations by design
    // (AGENTS.md's "Parallel work"; the `DIVEDAY_TEST_CACHE_DIR` override
    // exists because worktrees can share one node_modules volume). A reader
    // that lands in that window gets `Error: PGlite failed to initialize
    // properly`, which names neither the cause nor the fix. `rename` is atomic
    // within a filesystem, and the temp file is a sibling so it is the same
    // one, so a reader sees either the whole old snapshot or the whole new one.
    const destination = templateFile(variant);
    const staging = `${destination}.${process.pid}.tmp`;
    await writeFile(staging, await buildSnapshot(variant));
    await rename(staging, destination);
  }
  // Written last and listing what it covers, so a fingerprint hit above always
  // means every tar it claims is on disk and current.
  await writeFile(META_FILE, JSON.stringify({ fingerprint, variants: VARIANTS }));
}

// Each dump is tens of megabytes; read it once per worker process and share
// across test files. globalThis survives per-file module isolation, module
// state does not.
const globalForTemplate = globalThis as typeof globalThis & {
  divedayTestDbTemplate?: Partial<Record<TemplateVariant, Promise<Uint8Array<ArrayBuffer> | null>>>;
};

/**
 * Snapshot bytes for one variant, or null when global setup did not run (e.g. a
 * foreign config) — callers fall back to seeding from scratch.
 *
 * **A zero-length read is `null`, not an empty snapshot.** An empty
 * `Uint8Array` is truthy, so it sailed straight past `seededTestDb`'s
 * `if (!bytes)` fallback and reached PGlite as an empty tar, which throws
 * `Error: PGlite failed to initialize properly` — a message that names neither
 * the cause nor the fix. Nothing legitimately produces an empty snapshot, so
 * reading one always means the file is mid-write or truncated, and the honest
 * answer is the same as "no snapshot at all": seed from scratch and say so.
 */
export function templateBytes(
  variant: TemplateVariant = "lean",
): Promise<Uint8Array<ArrayBuffer> | null> {
  globalForTemplate.divedayTestDbTemplate ??= {};
  const cache = globalForTemplate.divedayTestDbTemplate;
  const cached = cache[variant];
  if (cached) return cached;
  const bytes = readFile(templateFile(variant)).then(
    // Copy out of the Buffer so the type is a plain ArrayBuffer-backed view.
    (buffer) => (buffer.length > 0 ? new Uint8Array(buffer) : null),
    () => null,
  );
  cache[variant] = bytes;
  return bytes;
}
