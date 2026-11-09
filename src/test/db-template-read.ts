import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inputsFingerprint } from "./db-template-inputs";

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

export type TemplateManifest = {
  fingerprint: string;
  files: Record<TemplateVariant, { file: string; size: number; sha256: string }>;
};

export function manifestFile(fingerprint: string): string {
  return path.join(CACHE_DIR, `${fingerprint}.json`);
}

export async function readManifest(fingerprint: string): Promise<TemplateManifest | null> {
  try {
    const manifest: TemplateManifest = JSON.parse(
      await readFile(manifestFile(fingerprint), "utf8"),
    );
    if (
      manifest.fingerprint !== fingerprint ||
      !VARIANTS.every((variant) => {
        const entry = manifest.files?.[variant];
        return (
          entry &&
          /^[a-f0-9]{64}\.tar$/.test(entry.file) &&
          entry.size > 0 &&
          entry.file === `${entry.sha256}.tar`
        );
      })
    )
      return null;
    return manifest;
  } catch {
    return null;
  }
}

export async function readSnapshot(
  entry: TemplateManifest["files"][TemplateVariant],
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const bytes = await readFile(path.join(CACHE_DIR, entry.file));
    if (
      bytes.length !== entry.size ||
      createHash("sha256").update(bytes).digest("hex") !== entry.sha256
    )
      return null;
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
}

// The key includes the checkout's content identity and cache directory. Different
// worktrees never hydrate one another's fixtures, even in a shared cache.
const globalForTemplate = globalThis as typeof globalThis & {
  divedayTestDbTemplate?: Map<string, Promise<Uint8Array<ArrayBuffer> | null>>;
  divedayTestDbFingerprints?: Map<string, Promise<string>>;
  divedayTestDbManifests?: Map<string, Promise<TemplateManifest | null>>;
};

export async function templateBytes(
  variant: TemplateVariant = "lean",
): Promise<Uint8Array<ArrayBuffer> | null> {
  globalForTemplate.divedayTestDbFingerprints ??= new Map();
  const fingerprints = globalForTemplate.divedayTestDbFingerprints;
  let fingerprint = fingerprints.get(process.cwd());
  if (!fingerprint) {
    fingerprint = inputsFingerprint();
    fingerprints.set(process.cwd(), fingerprint);
  }
  const identity = await fingerprint;
  globalForTemplate.divedayTestDbManifests ??= new Map();
  const manifests = globalForTemplate.divedayTestDbManifests;
  const generationKey = `${CACHE_DIR}:${identity}`;
  let generation = manifests.get(generationKey);
  if (!generation) {
    generation = readManifest(identity);
    manifests.set(generationKey, generation);
  }
  const manifest = await generation;
  if (!manifest) return null;
  const entry = manifest.files[variant];
  const key = `${CACHE_DIR}:${identity}:${entry.sha256}`;
  globalForTemplate.divedayTestDbTemplate ??= new Map();
  const cache = globalForTemplate.divedayTestDbTemplate;
  let bytes = cache.get(key);
  if (!bytes) {
    bytes = readSnapshot(entry);
    cache.set(key, bytes);
  }
  return bytes;
}
