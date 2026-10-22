import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Template-database snapshots for the PGlite integration tests.
 *
 * Booting a fresh test database used to cost every single test the full
 * migration replay plus the demo seed (~3s each, ~130 tests). Instead, the
 * Vitest global setup builds those databases once, dumps each data directory to
 * a cache file, and every test hydrates an isolated in-memory clone from the
 * dump in a few hundred milliseconds. Same isolation, ~10x cheaper.
 */

import { CACHE_DIR, META_FILE, templateFile, VARIANTS } from "./db-template-read";

export { type TemplateVariant, templateBytes } from "./db-template-read";

/**
 * Everything the templates' contents depend on: migrations, db source (schema,
 * seed, queries), the frozen instant, and the snapshot builder itself.
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
  // `src/content` because the seed publishes its course and dive-site catalogs
  // from there (seed-catalog.ts, seed-dive-site-catalog.ts): a content-only
  // change otherwise reuses a snapshot holding the old catalog.
  for (const root of ["drizzle", "src/db", "src/content"]) {
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
  hash.update(await readFile("src/test/db-template-build.ts"));
  return hash.digest("hex");
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

  // A warm cache needs filesystem reads only; loading the seed graph costs seconds.
  const { buildSnapshot } = await import("./db-template-build");
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
