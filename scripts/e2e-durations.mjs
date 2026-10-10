#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DURATIONS_FILE, EXCLUDED_SPECS, testListLine } from "./e2e-shard.mjs";

/**
 * Records and folds the browser suites' durations — the input
 * `scripts/e2e-shard.mjs` deals both Playwright jobs by.
 *
 *   node scripts/e2e-durations.mjs record e2e-durations/results.json --kind=functional --out=<file>
 *   node scripts/e2e-durations.mjs merge <artifact json or job log…>
 *
 * `record` runs in every CI shard after its tests. It reads Playwright's JSON
 * report and writes the compact map — per **spec file** for the functional
 * shards, per **test** (its `--test-list` line) for the visual ones, because
 * the visual suite is one file dealt by test — and prints the same map as one
 * `diveday-e2e-durations:` log line. The line exists for the same reason the
 * unit reporter prints one (scripts/merge-test-durations.mjs): an agent
 * session reads job logs through the GitHub MCP, while the artifact download
 * redirects to blob storage it cannot reach.
 *
 * `merge` folds every shard of one run into `scripts/e2e-durations.json`. A
 * kind no input carries keeps what the committed file already had, so a refresh
 * from the functional shards alone never wipes the visual figures. Within a
 * kind the output is the inputs' union and nothing else: an item no shard
 * recorded falls back to its estimate (functional) or the mean (visual).
 * `.github/workflows/durations-refresh.yml` runs it weekly.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DURATIONS_PATH = path.join(ROOT, DURATIONS_FILE);
export const LOG_MARKER = "diveday-e2e-durations:";
export const KINDS = ["functional", "visual"];
const SPEC_ROOT = "e2e";

export const DURATIONS_NOTE =
  "Recorded CI milliseconds the Playwright and visual shards are dealt by (scripts/e2e-shard.mjs): `functional` per spec file, `visual` per test as its --test-list line. Written by `node scripts/e2e-durations.mjs merge`, weekly by .github/workflows/durations-refresh.yml; never edited by hand.";

/** The first result's duration of every test in a Playwright JSON report, with its file and titles. */
function* reportedTests(report) {
  function* walk(suite, titles, file) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const duration = test.results?.[0]?.duration;
        yield {
          file,
          titles: [...titles, spec.title],
          duration: Number.isFinite(duration) ? duration : 0,
        };
      }
    }
    for (const child of suite.suites ?? []) yield* walk(child, [...titles, child.title], file);
  }
  for (const suite of report?.suites ?? []) yield* walk(suite, [], suite.file);
}

/**
 * The compact map one shard records. Functional: spec path (repo-relative,
 * `e2e/…`) → the sum of its tests. Visual: `--test-list` line → that test.
 * The visual spec never counts towards the functional map, and only the visual
 * spec towards the visual one, whichever report it was read from.
 */
export function durationsFromReport(report, kind) {
  if (!KINDS.includes(kind)) throw new Error(`e2e-durations: unknown kind "${kind}"`);
  const map = {};
  for (const { file, titles, duration } of reportedTests(report)) {
    const spec = `${SPEC_ROOT}/${file}`;
    const visual = EXCLUDED_SPECS.includes(spec);
    if (kind === "functional" && !visual) map[spec] = (map[spec] ?? 0) + Math.round(duration);
    if (kind === "visual" && visual) map[testListLine(file, titles)] = Math.round(duration);
  }
  return map;
}

/**
 * One input's `{ kind, durations }` records: a recorded artifact's JSON, or
 * every marked line of a job log. A log with no marked line is refused — the
 * shard never reached its record step.
 */
export function parseInput(text, label = "input") {
  try {
    const parsed = JSON.parse(text);
    return [checkRecord(parsed, label)];
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const records = text
    .split(/\r?\n/)
    .filter((line) => line.includes(LOG_MARKER))
    .map((line) =>
      checkRecord(JSON.parse(line.slice(line.indexOf(LOG_MARKER) + LOG_MARKER.length)), label),
    );
  if (records.length === 0) {
    throw new Error(
      `${label}: no "${LOG_MARKER}" line — is this a finished Playwright or visual shard log?`,
    );
  }
  return records;
}

function checkRecord(record, label) {
  if (!record || !KINDS.includes(record.kind) || typeof record.durations !== "object") {
    throw new Error(`${label}: expected { kind: "functional" | "visual", durations: { … } }`);
  }
  for (const [key, ms] of Object.entries(record.durations)) {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
      throw new Error(`${label}: ${key}: ${JSON.stringify(ms)} is not a duration in milliseconds`);
    }
  }
  return record;
}

const byKey = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The committed file after folding `records` into `existing`: each kind any
 * record carries is replaced by the union of those records (the larger figure
 * on a collision — a shard that ran an item twice reports its slower run);
 * a kind none carries is kept as it was.
 */
export function mergeDurations(existing, records) {
  const next = { "//": DURATIONS_NOTE };
  for (const kind of KINDS) {
    const fresh = records.filter((record) => record.kind === kind);
    if (fresh.length === 0) {
      next[kind] = Object.fromEntries(Object.entries(existing?.[kind] ?? {}).sort(byKey));
      continue;
    }
    const merged = new Map();
    for (const { durations } of fresh) {
      for (const [key, ms] of Object.entries(durations)) {
        merged.set(key, Math.max(merged.get(key) ?? 0, Math.round(ms)));
      }
    }
    next[kind] = Object.fromEntries([...merged].sort(byKey));
  }
  return next;
}

async function readExisting() {
  try {
    return JSON.parse(await readFile(DURATIONS_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const option = (name) => rest.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const positional = rest.filter((arg) => !arg.startsWith("--"));

  if (command === "record") {
    const kind = option("kind");
    const [reportPath] = positional;
    if (!reportPath || !kind) {
      console.error(
        "usage: node scripts/e2e-durations.mjs record <results.json> --kind=functional|visual [--out=<file>]",
      );
      process.exit(2);
    }
    let report;
    try {
      report = JSON.parse(await readFile(reportPath, "utf8"));
    } catch (error) {
      // A shard that died before Playwright wrote its report has nothing to
      // record; that is the shard's failure to report, not this step's.
      console.log(
        `e2e-durations: no report at ${reportPath} (${error.code ?? error.message}); nothing recorded`,
      );
      return;
    }
    const record = { kind, durations: durationsFromReport(report, kind) };
    const out = option("out");
    if (out) await writeFile(out, `${JSON.stringify(record)}\n`);
    console.log(`${LOG_MARKER} ${JSON.stringify(record)}`);
    return;
  }

  if (command === "merge") {
    if (positional.length === 0) {
      console.error(
        "usage: node scripts/e2e-durations.mjs merge <recorded json or shard job log…> — every shard of one green run",
      );
      process.exit(2);
    }
    const records = (
      await Promise.all(
        positional.map(async (file) => parseInput(await readFile(file, "utf8"), file)),
      )
    ).flat();
    const next = mergeDurations(await readExisting(), records);
    await writeFile(DURATIONS_PATH, `${JSON.stringify(next, null, 2)}\n`);
    for (const kind of KINDS) {
      const values = Object.values(next[kind]);
      const total = values.reduce((sum, ms) => sum + ms, 0);
      console.log(
        `e2e-durations: ${kind} ${values.length} items, ${Math.round(total / 1000)}s recorded`,
      );
    }
    return;
  }

  console.error("usage: node scripts/e2e-durations.mjs record|merge …");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
