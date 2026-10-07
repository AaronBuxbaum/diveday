#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Folds the per-shard duration files CI uploads (`unit-durations-<n>`
 * artifacts, written by src/test/duration-reporter.ts) into the committed
 * `scripts/test-durations.json` the unit-shard sequencer reads.
 *
 *   node scripts/merge-test-durations.mjs durations/*.json
 *
 * The output is the union of the inputs and nothing else, so feed it every
 * shard of one green run: a file left out of the inputs drops out of the
 * committed set and falls back to its scaled estimate, which is harmless but
 * less even. A file named twice keeps the larger figure.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DURATIONS_PATH = path.join(ROOT, "scripts/test-durations.json");

/** Merges duration maps: union of keys, the larger value on a collision, sorted by key. */
export function mergeDurations(maps) {
  const merged = new Map();
  for (const map of maps) {
    if (map === null || typeof map !== "object" || Array.isArray(map)) {
      throw new Error("a durations file must hold one JSON object of path → milliseconds");
    }
    for (const [file, ms] of Object.entries(map)) {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
        throw new Error(`${file}: ${JSON.stringify(ms)} is not a duration in milliseconds`);
      }
      merged.set(file, Math.max(merged.get(file) ?? 0, Math.round(ms)));
    }
  }
  return Object.fromEntries([...merged].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// Imported by the test, which must not read argv or write the file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error(
      "usage: node scripts/merge-test-durations.mjs <shard-durations.json…> — download every unit-durations-<n> artifact of one green CI run and pass all of them.",
    );
    process.exit(2);
  }
  const maps = await Promise.all(
    inputs.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
  );
  const merged = mergeDurations(maps);
  await writeFile(DURATIONS_PATH, `${JSON.stringify(merged, null, 2)}\n`);
  const total = Object.values(merged).reduce((sum, ms) => sum + ms, 0);
  console.log(
    `test-durations: ${Object.keys(merged).length} files, ${Math.round(total / 1000)}s recorded → ${path.relative(ROOT, DURATIONS_PATH)}`,
  );
}
