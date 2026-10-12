#!/usr/bin/env node
import { existsSync } from "node:fs";
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
 *   node scripts/merge-test-durations.mjs shard-1.log shard-2.log shard-3.log shard-4.log
 *   node scripts/merge-test-durations.mjs --prune
 *
 * Each input is either an artifact's JSON or a saved job log: the reporter
 * also prints its map as one line after `diveday-test-durations:`, because the
 * artifact download redirects to blob storage a cloud agent session cannot
 * reach while the log text is readable (GitHub MCP `get_job_logs` with
 * `return_content`; issue #2227). Save each "Unit tests shard n/4" job's log
 * and pass the files.
 *
 * The output is the union of the inputs and nothing else, so feed it every
 * shard of one green run: a file left out of the inputs drops out of the
 * committed set and falls back to its scaled estimate, which is harmless but
 * less even. A file named twice keeps the larger figure.
 *
 * Either way, a key whose test file is no longer on disk is dropped before the
 * write: the run read may predate a rename or a split merged since, and a dead
 * key only ever weighs a file the sequencer will never see. `--prune` with no
 * inputs does that alone to the committed file.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DURATIONS_PATH = path.join(ROOT, "scripts/test-durations.json");

/** Must equal `DURATIONS_LOG_MARKER` in src/test/duration-reporter.ts. */
export const DURATIONS_LOG_MARKER = "diveday-test-durations:";

/**
 * One input's duration map: the whole text as JSON (an artifact), or else the
 * marked line of a job log. A log with no marked line, or with two, is refused:
 * the first means the shard never finished, the second that two logs were
 * pasted into one file and one of them would be silently dropped.
 */
export function parseDurationsInput(text, label = "input") {
  try {
    return JSON.parse(text);
  } catch {
    // Not an artifact; read it as a log.
  }
  const lines = text.split(/\r?\n/).filter((line) => line.includes(DURATIONS_LOG_MARKER));
  if (lines.length !== 1) {
    throw new Error(
      `${label}: expected one "${DURATIONS_LOG_MARKER}" line, found ${lines.length} — is this a finished unit-shard log?`,
    );
  }
  const line = lines[0];
  return JSON.parse(line.slice(line.indexOf(DURATIONS_LOG_MARKER) + DURATIONS_LOG_MARKER.length));
}

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

/**
 * The map without the keys `exists` rejects, and those keys. A key is a
 * repo-relative test path, as the reporter writes it.
 */
export function pruneMissing(map, exists) {
  const kept = {};
  const pruned = [];
  for (const [file, ms] of Object.entries(map)) {
    if (exists(file)) kept[file] = ms;
    else pruned.push(file);
  }
  return { kept, pruned };
}

// Imported by the test, which must not read argv or write the file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const pruneOnly = args.includes("--prune");
  const inputs = args.filter((arg) => arg !== "--prune");
  if (inputs.length === 0 && !pruneOnly) {
    console.error(
      "usage: node scripts/merge-test-durations.mjs <shard-durations.json or shard job log…> — pass every unit shard of one green CI run; or --prune alone to drop the committed keys whose test file is gone.",
    );
    process.exit(2);
  }
  const merged =
    inputs.length > 0
      ? mergeDurations(
          await Promise.all(
            inputs.map(async (file) => parseDurationsInput(await readFile(file, "utf8"), file)),
          ),
        )
      : JSON.parse(await readFile(DURATIONS_PATH, "utf8"));
  const { kept, pruned } = pruneMissing(merged, (file) => existsSync(path.join(ROOT, file)));
  await writeFile(DURATIONS_PATH, `${JSON.stringify(kept, null, 2)}\n`);
  const total = Object.values(kept).reduce((sum, ms) => sum + ms, 0);
  for (const file of pruned) console.log(`test-durations: dropped ${file} (no such file)`);
  console.log(
    `test-durations: ${Object.keys(kept).length} files, ${Math.round(total / 1000)}s recorded → ${path.relative(ROOT, DURATIONS_PATH)}`,
  );
}
