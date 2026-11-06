// Decides, from main's own manifest, which baseline images a pull request's visual compare needs.
//
// A main snapshot's `out.json` names every capture and, in `actualBlobs`, the sha-256 of the
// canonical PNG it published (scripts/visual-build-publish-bundle.mjs). This run's captures are
// re-encoded to the same canonical form before they get here (scripts/visual-publish-artifacts.mjs),
// so a capture whose hash equals the manifest's is byte-for-byte the baseline image: it cannot
// differ, and downloading, decoding and diffing it would only prove that. The same goes for a
// surface a selective run did not capture at all, which the compare used to fill from the baseline
// so it would read as unchanged.
//
// So only the captures whose bytes moved (and, on a full capture, the ones main stopped taking)
// are fetched and handed to reg-suit. Everything else is set aside for the compare and written
// back into the report as passed afterwards, which is the report reg-suit would have produced.
//
// The plan is advisory: a baseline without hashes, a fresh start, or a manifest that does not
// say what this module expects gives no plan, and the caller falls back to fetching everything.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Where the prepare step leaves the plan for the compare and verify steps. */
export const BASELINE_PLAN_FILE = ".reg-baseline-plan.json";
/** Where the compare sets unchanged captures aside while reg-suit runs. */
export const STASH_DIR = ".reg-unchanged";

const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,179}\.png$/u;

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** `{ name: sha256 }` of every PNG directly under `dir`. */
export function hashScreenshots(dir) {
  const hashes = {};
  if (!existsSync(dir)) return hashes;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) continue;
    hashes[entry.name] = createHash("sha256")
      .update(readFileSync(path.join(dir, entry.name)))
      .digest("hex");
  }
  return hashes;
}

/**
 * Splits the baseline's captures by what this run needs of them, or returns null when the report
 * carries no usable hashes.
 *
 * - `unchanged`: captured here, same bytes as the baseline. Compared by hash.
 * - `filled`: baseline surfaces a selective run did not capture. Unchanged by construction.
 * - `fetch`: baseline images reg-suit needs, because the capture differs, has no recorded hash,
 *   or (on a full capture) main no longer takes it and the report shows its last image as deleted.
 *
 * `report.actualItems` is trusted only as far as the callers already trust it; names outside the
 * safe screenshot pattern are left to the caller's own validation.
 */
export function planBaselineReuse({ report, actualHashes, selective }) {
  const blobs = report?.actualBlobs;
  if (!blobs || typeof blobs !== "object" || Array.isArray(blobs)) return null;
  if (!Array.isArray(report.actualItems)) return null;
  const hashed = Object.entries(blobs).filter(([, hash]) => SHA256.test(hash ?? ""));
  if (hashed.length === 0) return null;

  const unchanged = [];
  const filled = [];
  const fetch = [];
  for (const name of report.actualItems) {
    if (typeof name !== "string" || !SAFE_NAME.test(name)) continue;
    const captured = Object.hasOwn(actualHashes, name);
    if (!captured) {
      (selective ? filled : fetch).push(name);
      continue;
    }
    const recorded = blobs[name];
    if (typeof recorded === "string" && SHA256.test(recorded) && recorded === actualHashes[name]) {
      unchanged.push(name);
    } else {
      fetch.push(name);
    }
  }
  return {
    version: 1,
    selective: Boolean(selective),
    unchanged: unchanged.sort(byName),
    filled: filled.sort(byName),
    fetch: fetch.sort(byName),
  };
}

export function writePlan(plan, file = BASELINE_PLAN_FILE) {
  writeFileSync(file, `${JSON.stringify(plan)}\n`);
}

export function clearPlan(file = BASELINE_PLAN_FILE) {
  rmSync(file, { force: true });
}

/** The plan the prepare step wrote, or null when it fell back to fetching everything. */
export function readPlan(file = BASELINE_PLAN_FILE) {
  if (!existsSync(file)) return null;
  let plan;
  try {
    plan = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("the baseline plan is not valid JSON");
  }
  const lists = ["unchanged", "filled", "fetch"];
  if (
    plan?.version !== 1 ||
    lists.some(
      (key) => !Array.isArray(plan[key]) || plan[key].some((name) => !SAFE_NAME.test(name)),
    )
  ) {
    throw new Error("the baseline plan has an unexpected shape");
  }
  return plan;
}

/** Move the unchanged captures out of `actualDir` so reg-suit never decodes them. */
export function setAsideUnchanged({ plan, actualDir, stashDir = STASH_DIR }) {
  rmSync(stashDir, { recursive: true, force: true });
  mkdirSync(stashDir, { recursive: true });
  for (const name of plan.unchanged)
    renameSync(path.join(actualDir, name), path.join(stashDir, name));
}

/**
 * Put them back after the compare: into `actualDir` (so the capture directory is whole again) and
 * into reg-suit's `actual` copy (so a main run still hashes and publishes them), and write every
 * set-aside or filled name into the report as passed, exactly where reg-suit lists a passed item.
 */
export function restoreUnchanged({ plan, actualDir, workingDir, stashDir = STASH_DIR }) {
  const publishedActual = path.join(workingDir, "actual");
  mkdirSync(publishedActual, { recursive: true });
  for (const name of plan.unchanged) {
    const stashed = path.join(stashDir, name);
    copyFileSync(stashed, path.join(publishedActual, name));
    renameSync(stashed, path.join(actualDir, name));
  }
  rmSync(stashDir, { recursive: true, force: true });

  const reportFile = path.join(workingDir, "out.json");
  const report = JSON.parse(readFileSync(reportFile, "utf8"));
  writeFileSync(
    reportFile,
    JSON.stringify(withPassedItems(report, [...plan.unchanged, ...plan.filled])),
  );
}

/** A reg-suit report with `names` added as passed items (expected, actual and passed alike). */
export function withPassedItems(report, names) {
  const merged = { ...report };
  for (const key of ["passedItems", "expectedItems", "actualItems"]) {
    const list = Array.isArray(report[key]) ? report[key] : [];
    merged[key] = [...new Set([...list, ...names])].sort(byName);
  }
  return merged;
}
