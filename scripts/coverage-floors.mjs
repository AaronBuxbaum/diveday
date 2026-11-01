// Branch coverage on the safety-critical files may not drop (test review 2026-10-14, decision 6).
//
// Not a blanket target: reachability is near 100% for src/lib and src/db, so a whole-tree number
// would mostly be noise. Eleven files decide whether a diver boards, who may do what, and where
// money moves; each has a floor in `scripts/coverage-floors.json`, and this refuses a run whose
// branch coverage on any of them fell below it.
//
//   node scripts/coverage-floors.mjs [coverage/coverage-summary.json]
//   node scripts/coverage-floors.mjs --write              banks every rise, refuses any fall
//   node scripts/coverage-floors.mjs --write --absorb "<why>"   records a fall with its reason
//
// The summary is Vitest's `json-summary` coverage reporter output. CI writes it in the
// `coverage-floors` job by merging the four unit shards' blob reports (`vitest --merge-reports`),
// so the number is the whole suite's, not one shard's, and uploads it as `coverage-summary`.
// Locally, `pnpm coverage:floors` runs the suite with coverage on and then this; it takes a full
// unit run, so raising a floor from CI's artifact is usually quicker.
//
// The floor turns one way, like every other ratchet here (`scripts/ratchet.mjs`), but in the
// other direction: a percentage may only rise. A file that gains an untested branch drops, and
// that is the case this exists to catch.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { SAFETY_FILES } from "./coverage-safety-files.mjs";
import { ratchetFlags } from "./ratchet.mjs";

export { SAFETY_FILES };

export const FLOORS_PATH = "scripts/coverage-floors.json";
export const DEFAULT_SUMMARY = "coverage/coverage-summary.json";

const NOTE =
  'Branch coverage floor (percent) per safety-critical file. A floor may only rise: `node scripts/coverage-floors.mjs --write` banks a rise and refuses a fall; `--absorb "<why>"` records a fall with its reason. See scripts/coverage-floors.mjs.';

/**
 * `{ file: branchPct }` from a json-summary, keyed by repository path. The reporter keys by
 * absolute path, and the four shards' runners may not share a checkout path, so each key is
 * cut at its `src/`.
 */
export function branchCoverage(summary) {
  const out = {};
  for (const [key, value] of Object.entries(summary)) {
    if (key === "total") continue;
    const at = key.replaceAll("\\", "/").lastIndexOf("/src/");
    const rel = key.startsWith("src/") ? key : at === -1 ? key : key.slice(at + 1);
    const { covered, total } = value.branches;
    out[rel] = total === 0 ? 100 : Math.floor((10_000 * covered) / total) / 100;
  }
  return out;
}

/** What is wrong with `current` against `floors`: `failures` fail the run, `rises` are banked. */
export function compareFloors(floors, current) {
  const failures = [];
  const rises = [];
  for (const [file, floor] of Object.entries(floors)) {
    if (file.startsWith("//")) continue;
    const now = current[file];
    if (now === undefined) {
      failures.push(
        `${file}: no coverage recorded. If it moved or was deleted, update SAFETY_FILES in scripts/coverage-safety-files.mjs and the floor together.`,
      );
    } else if (now < floor) {
      failures.push(
        `${file}: branch coverage ${now}% is below its floor of ${floor}%. Test the branch you added, or record why with --write --absorb "<why>".`,
      );
    } else if (now > floor) {
      rises.push(`${file}: ${floor}% → ${now}%`);
    }
  }
  for (const file of SAFETY_FILES) {
    if (!(file in floors)) failures.push(`${file}: no floor yet. Run with --write to set one.`);
  }
  return { failures, rises };
}

/** The floors file `--write` produces, or `{ refused }` when a fall arrives without `absorb`. */
export function nextFloors(floors, current, absorb) {
  const falls = SAFETY_FILES.filter(
    (file) => file in floors && current[file] !== undefined && current[file] < floors[file],
  );
  const missing = SAFETY_FILES.filter((file) => current[file] === undefined);
  if (missing.length > 0)
    return { refused: missing.map((file) => `${file}: no coverage recorded`) };
  if (falls.length > 0 && !absorb) {
    return { refused: falls.map((file) => `${file}: ${floors[file]}% → ${current[file]}%`) };
  }
  const absorbed = [...(floors["//absorbed"] ?? [])];
  if (falls.length > 0) {
    absorbed.push({
      why: absorb,
      files: Object.fromEntries(falls.map((file) => [file, `${floors[file]} -> ${current[file]}`])),
    });
  }
  return {
    floors: {
      "//": NOTE,
      ...(absorbed.length > 0 ? { "//absorbed": absorbed } : {}),
      ...Object.fromEntries(SAFETY_FILES.map((file) => [file, current[file]])),
    },
  };
}

function main() {
  const root = path.join(import.meta.dirname, "..");
  const summaryPath = process.argv.slice(2).find((arg) => arg.endsWith(".json")) ?? DEFAULT_SUMMARY;
  const { write, absorb } = ratchetFlags();
  let summary;
  try {
    summary = JSON.parse(readFileSync(path.resolve(root, summaryPath), "utf8"));
  } catch (error) {
    console.error(
      `coverage-floors: cannot read ${summaryPath} (${error.message}). Run the suite with coverage first: pnpm coverage:floors.`,
    );
    return 1;
  }
  const floors = JSON.parse(readFileSync(path.join(root, FLOORS_PATH), "utf8"));
  const current = branchCoverage(summary);

  if (write) {
    if (absorb === "") {
      console.error('coverage-floors: --absorb needs a reason — --absorb "<why>".');
      return 1;
    }
    const next = nextFloors(floors, current, absorb);
    if (next.refused) {
      console.error('coverage-floors: refusing to lower a floor without --absorb "<why>":');
      for (const line of next.refused) console.error(`- ${line}`);
      return 1;
    }
    writeFileSync(path.join(root, FLOORS_PATH), `${JSON.stringify(next.floors, null, 2)}\n`);
    console.log(`coverage-floors: wrote ${SAFETY_FILES.length} floors to ${FLOORS_PATH}.`);
    return 0;
  }

  const { failures, rises } = compareFloors(floors, current);
  for (const line of failures) console.error(line);
  if (rises.length > 0) {
    console.log(
      `coverage-floors: ${rises.length} floor(s) can rise; bank them with \`node scripts/coverage-floors.mjs --write <summary>\`, from CI's coverage-summary artifact or a local \`pnpm coverage:floors\`:`,
    );
    for (const line of rises) console.log(`- ${line}`);
  }
  if (failures.length > 0) return 1;
  console.log(`coverage-floors: ${SAFETY_FILES.length} safety files at or above their floors.`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
