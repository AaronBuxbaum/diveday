import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REVIEWS, reviewPath } from "./check-pr-body.mjs";

/**
 * Safety-critical files the reviewer patterns do not match by name but that decide who may do
 * what or where money moves. Hand-kept; the pattern-matched files below are found, not listed.
 */
const EXPLICIT = [
  "src/features/boarding/check-in/rules.ts",
  "src/features/records/anonymize.ts",
  "src/features/certifications/card-restore.ts",
  "src/features/certifications/certification-junior.ts",
  "src/features/boarding/check-in/store.ts",
  "src/features/training/course-certified.ts",
  "src/features/safety/nitrox-mod.ts",
  "src/features/boarding/offline-manifest-snapshots/store.ts",
  "src/features/waivers/party-waiver-queue.ts",
  "src/features/boarding/readiness-link-rescue.ts",
  "src/features/boarding/roll-call-alerts/store.ts",
  "src/features/boarding/roll-call-alerts/rules.ts",
  "src/features/waivers/signed-waiver-page.ts",
  "src/features/waivers/waivers-page.ts",
  "src/features/records/anonymization.ts",
  "src/features/waivers/waiver-draft.ts",
  "src/features/certifications/cert-scan.ts",
  "src/features/certifications/card-undo.ts",
  "src/features/records/guardian-erasure.ts",
  "src/features/records/processor-erasure.ts",
  "src/features/bookings/seat-diver.ts",
  "src/features/boarding/roll-call-gaps.ts",
  "src/features/boarding/standing-sailed-roll-call.ts",
  "src/test/shop-facts/manifest-overcapacity-state.ts",
  "src/test/shop-facts/mark-mixed-waiver-delivery.ts",
  "src/test/shop-facts/party-waiver-capacity-state.ts",
  "src/test/shop-facts/read-the-waiver-request.ts",
  "src/lib/trips.ts",
  "src/lib/authz.ts",
  "src/db/checkouts.ts",
  "src/db/refunds.ts",
  "src/db/promo-caps.ts",
  "src/db/account-security.ts",
  // Today's roll-call rows moved above the graph into a feature (issue #2756); the
  // file remains explicit as well as discoverable under src/features.
  "src/features/day/today/today-roll-call-rows.ts",
];

/** Never a safety file: tests and fixtures, seed scenarios, fixture modules, copy resolvers, type declarations. */
const NOT_LOGIC = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /test-fixtures/,
  /-fixtures\.tsx?$/,
  /^src\/db\/seed\//,
  // A copy resolver; a one-file feature concept named "…-copy" (waiver-guardian-copy) is logic.
  /^(?!src\/features\/).*-copy\.tsx?$/,
  /\.test-support\.tsx?$/,
];

const DOMAIN_EXPERT = REVIEWS.find((review) => review.agent === "dive-domain-expert");

/**
 * The files in `files` (repository paths) that need a coverage floor: non-test `.ts` or `.tsx`
 * under src/lib, src/db or src/features that the dive-domain-expert reviewer patterns match, minus seed and
 * copy files. The patterns are the ones check-pr-body.mjs holds a pull request to, so a file
 * that needs the reviewer needs the floor.
 */
export function matchedSafetyFiles(files) {
  return files
    .filter((file) => /^src\/(lib|db|features)\/.+\.tsx?$/.test(file))
    .filter((file) => !NOT_LOGIC.some((re) => re.test(file)))
    .filter((file) => DOMAIN_EXPERT.patterns.some((re) => re.test(reviewPath(file))))
    .toSorted();
}

function walk(root, dir) {
  const found = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(root, rel));
    else found.push(rel);
  }
  return found;
}

/** Pure named re-exports carry no executable decisions to measure. An executable index stays in scope. */
export function isReexportOnlyContract(source) {
  return (
    source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/export\s+(?:type\s+)?\{[^{}]*\}\s+from\s+["'][^"']+["']\s*;?/g, "")
      .trim() === ""
  );
}

/** Every file on disk that needs a floor: the pattern matches under src/lib, src/db and src/features, plus the hand-kept ones. */
export function safetyFilesOnDisk(root) {
  const files = [...walk(root, "src/lib"), ...walk(root, "src/db"), ...walk(root, "src/features")];
  return [...new Set([...EXPLICIT, ...matchedSafetyFiles(files)])]
    .filter((file) => !isReexportOnlyContract(readFileSync(path.join(root, file), "utf8")))
    .toSorted();
}

/** The safety-critical files measured and enforced by the branch coverage floor. */
export const SAFETY_FILES = safetyFilesOnDisk(path.join(import.meta.dirname, ".."));
