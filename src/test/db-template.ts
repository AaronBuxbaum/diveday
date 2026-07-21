import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { seedDemo } from "@/db/seed";

/**
 * Template-database snapshot for the PGlite integration tests.
 *
 * Booting a fresh test database used to cost every single test the full
 * migration replay plus the demo seed (~3s each, ~130 tests). Instead, the
 * Vitest global setup builds that database once, dumps its data directory to a
 * cache file, and every test hydrates an isolated in-memory clone from the
 * dump in a few hundred milliseconds. Same isolation, ~10x cheaper.
 */

const CACHE_DIR = path.join(process.cwd(), "node_modules", ".cache", "diveday");
const TEMPLATE_FILE = path.join(CACHE_DIR, "test-db-template.tar");
const META_FILE = path.join(CACHE_DIR, "test-db-template.json");

/**
 * The demo seed is clock-anchored (one trip always sails *today*, departures
 * are rounded to upcoming half-hour slots), so a snapshot ages: keep it only
 * briefly so seeded "future" departures can never drift into the past between
 * builds. Within one focused-test iteration loop the cache still hits.
 */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Everything the template's contents depend on: migrations + db source (schema, seed, queries). */
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
  return hash.digest("hex");
}

/** Build (or reuse) the migrated + demo-seeded snapshot. Runs once per Vitest invocation. */
export async function ensureTestDbTemplate(): Promise<void> {
  const fingerprint = await inputsFingerprint();
  const meta = await readFile(META_FILE, "utf8")
    .then((raw) => JSON.parse(raw) as { fingerprint: string; builtAt: number })
    .catch(() => null);
  if (meta && meta.fingerprint === fingerprint && Date.now() - meta.builtAt < MAX_AGE_MS) return;

  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await seedDemo(db);
  const dump = await client.dumpDataDir("none");
  await client.close();

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(TEMPLATE_FILE, Buffer.from(await dump.arrayBuffer()));
  await writeFile(META_FILE, JSON.stringify({ fingerprint, builtAt: Date.now() }));
}

// The dump is ~40MB; read it once per worker process and share across test
// files. globalThis survives per-file module isolation, module state does not.
const globalForTemplate = globalThis as typeof globalThis & {
  divedayTestDbTemplate?: Promise<Uint8Array<ArrayBuffer> | null>;
};

/** Snapshot bytes, or null when global setup did not run (e.g. a foreign config). */
export function templateBytes(): Promise<Uint8Array<ArrayBuffer> | null> {
  globalForTemplate.divedayTestDbTemplate ??= readFile(TEMPLATE_FILE).then(
    // Copy out of the Buffer so the type is a plain ArrayBuffer-backed view.
    (buffer) => new Uint8Array(buffer),
    () => null,
  );
  return globalForTemplate.divedayTestDbTemplate;
}
