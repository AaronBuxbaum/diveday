#!/usr/bin/env node
import { appendFile, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **Are two capture runs of one tree byte-identical?**
 *
 * The two-worker trial (`.github/workflows/visual-workers-trial.yml`) captures
 * the whole visual suite three times from one build, twice at two browser
 * workers and once at one, and asks this whether every PNG came out the same.
 * Byte equality, not a pixel threshold: reg-suit compares the shard's PNGs
 * against a baseline taken at one worker, and any difference here is a
 * difference a pull request would be asked to explain.
 *
 * A name present in one set and missing from another is a difference too: a
 * capture that did not happen is the loudest way two runs can disagree.
 *
 *   node scripts/compare-capture-sets.mjs <dir> <dir> [<dir>…] [--summary=<file>]
 *
 * Exits 1 when anything differs, after printing each differing name and, with
 * `--summary`, appending the same list as Markdown (the job's step summary).
 */

/** Every `.png` under `dir`, as paths relative to it, sorted. */
export async function listPngs(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * Compare the sets. Returns `{ names, differing }`: every name seen in any set,
 * and one `{ name, reason }` per name that is missing somewhere or whose bytes
 * differ from the first set that has it.
 */
export async function compareCaptureSets(dirs) {
  if (dirs.length < 2) throw new Error("compare-capture-sets: name at least two folders");
  const listings = await Promise.all(dirs.map((dir) => listPngs(dir)));
  const names = [...new Set(listings.flat())].sort();
  const present = listings.map((list) => new Set(list));
  const differing = [];
  for (const name of names) {
    const missing = dirs.filter((_, i) => !present[i].has(name));
    if (missing.length > 0) {
      differing.push({ name, reason: `missing from ${missing.join(", ")}` });
      continue;
    }
    const [first, ...rest] = await Promise.all(dirs.map((dir) => readFile(path.join(dir, name))));
    const unlike = rest
      .map((bytes, i) => (first.equals(bytes) ? null : dirs[i + 1]))
      .filter((dir) => dir !== null);
    if (unlike.length > 0) {
      differing.push({ name, reason: `bytes differ: ${dirs[0]} vs ${unlike.join(", ")}` });
    }
  }
  return { names, differing };
}

/** The step-summary block for one comparison. */
export function summarize(dirs, { names, differing }) {
  const head = `### Capture sets compared: ${dirs.join(", ")}\n\n${names.length} PNG names, ${differing.length} differing.\n`;
  if (differing.length === 0) return `${head}\nEvery capture is byte-identical across the sets.\n`;
  const rows = differing.map(({ name, reason }) => `| \`${name}\` | ${reason} |`).join("\n");
  return `${head}\n| Capture | Why |\n| --- | --- |\n${rows}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const summaryArg = args.find((arg) => arg.startsWith("--summary="));
  const dirs = args.filter((arg) => !arg.startsWith("--"));
  const result = await compareCaptureSets(dirs);
  for (const { name, reason } of result.differing) console.log(`${name}: ${reason}`);
  console.log(
    `compare-capture-sets: ${result.names.length} names, ${result.differing.length} differing.`,
  );
  if (summaryArg) await appendFile(summaryArg.slice("--summary=".length), summarize(dirs, result));
  if (result.names.length === 0) {
    console.error(
      "compare-capture-sets: no PNGs in any folder; the capture runs produced nothing.",
    );
    process.exit(1);
  }
  if (result.differing.length > 0) process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
