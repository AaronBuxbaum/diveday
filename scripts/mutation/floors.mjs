// The weekly breakage-drill score floors (`scripts/mutation/floors.json`; ADR
// 20261122-diff-mutation-testing). A file's score is killed / (killed + survived), in percent,
// and its floor only rises: `--write` banks a rise and refuses a fall, `--write --absorb "<why>"`
// records a fall with its reason. The same shape and rules as scripts/coverage-floors.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const FLOORS_PATH = "scripts/mutation/floors.json";

const NOTE =
  'Breakage-drill score floor (percent of drilled breaks a test caught) per file, run weekly by .github/workflows/mutation.yml. A floor may only rise: `node scripts/mutation/run.mjs --file <path> --write` banks a rise and refuses a fall; `--absorb "<why>"` records a fall with its reason. See scripts/mutation/floors.mjs.';

/** Score in percent, rounded down to two places; `null` when nothing ran. */
export function score(killed, survived) {
  const total = killed + survived;
  if (total === 0) return null;
  return Math.floor((10_000 * killed) / total) / 100;
}

export function readFloors(root) {
  return JSON.parse(readFileSync(path.join(root, FLOORS_PATH), "utf8"));
}

/** The files the weekly run drills: every key that is not a `//` note. */
export function floorFiles(floors) {
  return Object.keys(floors).filter((key) => !key.startsWith("//"));
}

/** `{ ok, message }` for one file's measured score against its floor. */
export function checkFloor(floors, file, measured) {
  const floor = floors[file];
  if (measured === null)
    return { ok: false, message: `${file}: no break was drilled, so there is no score.` };
  if (floor === undefined)
    return {
      ok: false,
      message: `${file}: scored ${measured}% and has no floor yet. Set one with --write.`,
    };
  if (measured < floor)
    return {
      ok: false,
      message: `${file}: scored ${measured}%, below its floor of ${floor}%. Add tests that catch the surviving breaks, or record why with --write --absorb "<why>".`,
    };
  if (measured > floor)
    return {
      ok: true,
      message: `${file}: scored ${measured}%, above its floor of ${floor}%. Bank it with --write.`,
    };
  return { ok: true, message: `${file}: scored ${measured}%, at its floor.` };
}

/** The floors file with `file` set to `measured`, or `{ refused }` for a fall without `absorb`. */
export function nextFloors(floors, file, measured, absorb) {
  if (measured === null) return { refused: `${file}: no score to bank` };
  const floor = floors[file];
  const absorbed = [...(floors["//absorbed"] ?? [])];
  if (floor !== undefined && measured < floor) {
    if (!absorb) return { refused: `${file}: ${floor}% → ${measured}%` };
    absorbed.push({ why: absorb, files: { [file]: `${floor} -> ${measured}` } });
  }
  const next = { ...Object.fromEntries(floorFiles(floors).map((key) => [key, floors[key]])) };
  next[file] = floor !== undefined && measured < floor && !absorb ? floor : measured;
  return {
    floors: {
      "//": NOTE,
      ...(absorbed.length > 0 ? { "//absorbed": absorbed } : {}),
      ...Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}

export function writeFloors(root, floors) {
  writeFileSync(path.join(root, FLOORS_PATH), `${JSON.stringify(floors, null, 2)}\n`);
}
