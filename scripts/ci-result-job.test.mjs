import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CI = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Top-level job ids: two-space keys after `jobs:`. */
function jobIds(text) {
  const body = text.slice(text.indexOf("\njobs:\n"));
  return [...body.matchAll(/^ {2}([a-z0-9-]+):$/gmu)].map((match) => match[1]);
}

/** The block list under `ci-result`'s `needs:`. */
function resultNeeds(text) {
  const job = text.slice(text.indexOf("\n  ci-result:\n"));
  const lines = job.slice(job.indexOf("\n    needs:\n") + "\n    needs:\n".length).split("\n");
  const end = lines.findIndex((line) => !line.startsWith("      - "));
  return lines.slice(0, end).map((line) => line.slice("      - ".length));
}

/**
 * Main's ruleset requires the one "CI result" check (2026-10-13 review, row
 * 35). A job left out of its `needs:` could fail and the pull request would
 * still merge green, so every other job must be listed.
 */
describe("the CI result job", () => {
  it("needs every other job in ci.yml", () => {
    const others = jobIds(CI).filter((id) => id !== "ci-result");
    expect(others.length).toBeGreaterThan(5);
    expect(resultNeeds(CI).sort()).toEqual(others.sort());
  });

  it("runs even when a job it needs failed, and keeps the name the ruleset requires", () => {
    const job = CI.slice(CI.indexOf("\n  ci-result:\n"));
    expect(job).toMatch(/^ {4}name: CI result$/mu);
    expect(job).toMatch(/^ {4}if: always\(\)/mu);
  });
});
