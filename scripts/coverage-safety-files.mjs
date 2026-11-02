import { readdirSync } from "node:fs";
import path from "node:path";

import { REVIEWS } from "./check-pr-body.mjs";

/**
 * Safety-critical files the reviewer patterns do not match by name but that decide who may do
 * what or where money moves. Hand-kept; the pattern-matched files below are found, not listed.
 */
const EXPLICIT = [
  "src/lib/trips.ts",
  "src/lib/authz.ts",
  "src/db/checkouts.ts",
  "src/db/refunds.ts",
  "src/db/promo-caps.ts",
  "src/db/account-security.ts",
];

/** Never a safety file: tests and fixtures, seed scenarios, copy resolvers, type declarations. */
const NOT_LOGIC = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
  /test-fixtures/,
  /(^|\/)seed-[^/]*$/,
  /-copy\.tsx?$/,
  /\.test-support\.tsx?$/,
];

const DOMAIN_EXPERT = REVIEWS.find((review) => review.agent === "dive-domain-expert");

/**
 * The files in `files` (repository paths) that need a coverage floor: non-test `.ts` or `.tsx`
 * under src/lib or src/db that the dive-domain-expert reviewer patterns match, minus seed and
 * copy files. The patterns are the ones check-pr-body.mjs holds a pull request to, so a file
 * that needs the reviewer needs the floor.
 */
export function matchedSafetyFiles(files) {
  return files
    .filter((file) => /^src\/(lib|db)\/.+\.tsx?$/.test(file))
    .filter((file) => !NOT_LOGIC.some((re) => re.test(file)))
    .filter((file) => DOMAIN_EXPERT.patterns.some((re) => re.test(file.toLowerCase())))
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

/** Every file on disk that needs a floor: the pattern matches under src/lib and src/db, plus the hand-kept ones. */
export function safetyFilesOnDisk(root) {
  const files = [...walk(root, "src/lib"), ...walk(root, "src/db")];
  return [...new Set([...EXPLICIT, ...matchedSafetyFiles(files)])].toSorted();
}

/** The safety-critical files measured and enforced by the branch coverage floor. */
export const SAFETY_FILES = safetyFilesOnDisk(path.join(import.meta.dirname, ".."));
