import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The reader's half of the template snapshots, apart from the builder
 * (`./db-template`) so a test of the read path does not import the app's whole
 * seed graph to get at a function that reads a file (#2568: that import, cold
 * under CPU contention, was the 20 seconds `templateBytes`' first test spent).
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

export const VARIANTS: readonly TemplateVariant[] = ["lean", "history", "empty"];

// Worktrees can share a host-level node_modules volume. Allow a runner to
// isolate its snapshot so another checkout cannot replace it mid-run.
export const CACHE_DIR =
  process.env.DIVEDAY_TEST_CACHE_DIR ??
  path.join(process.cwd(), "node_modules", ".cache", "diveday");
export const META_FILE = path.join(CACHE_DIR, "test-db-template.json");

const TEMPLATE_FILENAME: Record<TemplateVariant, string> = {
  lean: "test-db-template.tar",
  history: "test-db-template-history.tar",
  empty: "test-db-template-empty.tar",
};

export function templateFile(variant: TemplateVariant): string {
  return path.join(CACHE_DIR, TEMPLATE_FILENAME[variant]);
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
