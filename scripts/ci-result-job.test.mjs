import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CI_JOBS } from "./ci-merge-verdict.mjs";

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
 * `CI result` is the stable check to require in main's ruleset. The current
 * visible ruleset does not require it yet. A job left out of its `needs:` could
 * fail while the aggregate went green, so every other job must be listed.
 */
describe("the CI result job", () => {
  it("needs every other job in ci.yml", () => {
    const others = jobIds(CI).filter((id) => id !== "ci-result");
    expect(others.length).toBeGreaterThan(5);
    expect(resultNeeds(CI).sort()).toEqual(others.sort());
    expect([...CI_JOBS].sort()).toEqual(others.sort());
  });

  it("runs even when a job it needs failed and keeps a stable aggregate name", () => {
    const job = CI.slice(CI.indexOf("\n  ci-result:\n"));
    expect(job).toMatch(/^ {4}name: CI result$/mu);
    expect(job).toMatch(/^ {4}if: always\(\) && github\.event_name != 'schedule'$/mu);
  });

  it("checks current PR candidate identity with read-only pull request access", () => {
    const job = CI.slice(CI.indexOf("\n  ci-result:\n"));
    expect(job).toContain("      pull-requests: read");
    expect(job).toContain("          GITHUB_SHA: ${{ github.sha }}");
    expect(job).toContain("          PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}");
    expect(job).toContain("          PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}");
    expect(job).toContain("          GH_TOKEN: ${{ github.token }}");
  });

  it("keeps the complete unit and Playwright shard fleets", () => {
    const job = (id) => {
      const header = `\n  ${id}:\n`;
      return CI.slice(CI.indexOf(header) + header.length).split(/\n {2}[a-z0-9-]+:\n/u)[0];
    };
    expect(job("unit-tests")).toMatch(/^ {8}shard: \[1, 2, 3, 4\]$/mu);
    expect(job("playwright")).toMatch(/^ {8}shard: \[1, 2, 3, 4, 5, 6\]$/mu);
    expect(job("playwright")).toMatch(
      /- name: Run non-visual Playwright tests\n {8}env:\n {10}SKIP: [^\n]+\n {10}E2E_WORKERS: "2"/u,
    );
    expect(job("visual")).toContain("shard: ${{ fromJSON(needs.visual-plan.outputs.shards) }}");
    expect(job("visual")).toMatch(/^\s+E2E_WORKERS: "2"$/mu);
    for (const id of ["unit-tests", "playwright", "visual"]) {
      expect(job(id)).not.toMatch(/^\s+exclude:/mu);
    }
  });
});
