import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  NAVIGATION_PROOF_GREP,
  NAVIGATION_PROOF_REPEATS,
  NAVIGATION_PROOF_TESTS,
  requirePinnedLinuxBrowser,
  summarizeNavigationProof,
} from "./e2e-navigation-proof.mjs";

const workflow = readFileSync(".github/workflows/e2e-nightly.yml", "utf8");
const step = (name) => workflow.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- /)[0];
function enabled(name, { event = "schedule", focus = "", cancelled = false } = {}) {
  const expression = step(name)?.match(/^ {8}if: \$\{\{ (.+) \}\}$/m)?.[1];
  expect(expression, name).toBeDefined();
  return runInNewContext(expression, {
    github: { event_name: event },
    inputs: { focus },
    cancelled: () => cancelled,
  });
}
const report = (change = (test) => test) => ({
  suites: [
    {
      suites: [
        {
          specs: NAVIGATION_PROOF_TESTS.map((title) => ({
            title,
            tests: Array.from({ length: NAVIGATION_PROOF_REPEATS }, () =>
              change({
                projectName: "chromium",
                expectedStatus: "passed",
                status: "expected",
                results: [{ status: "passed", retry: 0 }],
              }),
            ),
          })),
        },
      ],
    },
  ],
});

describe("allowlisted navigation proof", () => {
  it("selects exactly the three existing named journeys, including the quarantine", () => {
    const titles = ["e2e/staff-nav.spec.ts", "e2e/navigation-zero-clamp.spec.ts"].flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\btest\("([^"]+)"/g)].map((match) => match[1]),
    );
    expect(titles.filter((title) => new RegExp(NAVIGATION_PROOF_GREP).test(title))).toEqual(
      NAVIGATION_PROOF_TESTS,
    );
    expect(new RegExp(NAVIGATION_PROOF_GREP).test(`${NAVIGATION_PROOF_TESTS[0]} extra`)).toBe(
      false,
    );
    expect(NAVIGATION_PROOF_REPEATS).toBe(5);
  });
  it("fails closed for a system browser, an override or another OS", () => {
    expect(() => requirePinnedLinuxBrowser("linux", true, undefined)).not.toThrow();
    for (const args of [
      ["darwin", true, undefined],
      ["linux", false, undefined],
      ["linux", true, "/usr/bin/chromium"],
    ]) {
      expect(() => requirePinnedLinuxBrowser(...args)).toThrow(/pinned Linux Chromium/);
    }
  });
  it("reports five passes per name only with no retries, skipped or extra tests", () => {
    expect(summarizeNavigationProof(report())).toEqual(
      NAVIGATION_PROOF_TESTS.map((name) => ({ name, passed: 5 })),
    );
    for (const change of [
      (test) => ({ ...test, status: "skipped", results: [] }),
      (test) => ({ ...test, results: [{ status: "failed", retry: 0 }] }),
      (test) => ({ ...test, results: [{ status: "passed", retry: 1 }] }),
      (test) => ({ ...test, projectName: "webkit" }),
    ])
      expect(() => summarizeNavigationProof(report(change))).toThrow();
    expect(() => summarizeNavigationProof({ suites: [] })).toThrow();
    const extra = report();
    extra.suites[0].suites[0].specs.push({ title: "unexpected", tests: [] });
    expect(() => summarizeNavigationProof(extra)).toThrow();
  });
});

describe("nightly focus isolation", () => {
  it("leaves scheduled and default/manual runs broad and limits focus to manual dispatch", () => {
    for (const state of [{}, { event: "workflow_dispatch" }, { focus: "navigation-scroll-4183" }]) {
      expect(enabled("Quarantined tests", state)).toBe(true);
      expect(enabled("Specs that failed in the last 7 days, five times each", state)).toBe(true);
      expect(enabled("Focused navigation proof", state)).toBe(false);
    }
    const focused = { event: "workflow_dispatch", focus: "navigation-scroll-4183" };
    expect(enabled("Quarantined tests", focused)).toBe(false);
    expect(enabled("Specs that failed in the last 7 days, five times each", focused)).toBe(false);
    expect(enabled("Focused navigation proof", focused)).toBe(true);
    expect(
      enabled("Specs that failed in the last 7 days, five times each", { cancelled: true }),
    ).toBe(false);
  });
  it("has fixed selection/repeats, the existing timeout/browser setup, and retained proof artifacts", () => {
    expect(workflow).toContain('default: "all"');
    expect(workflow).toContain("type: choice");
    expect(workflow).toContain("      - all\n          - navigation-scroll-4183");
    expect(workflow).toContain("format('e2e-navigation-4183-{0}', github.ref) || 'e2e-nightly'");
    expect(workflow).toContain("timeout-minutes: 60");
    expect(workflow).toContain("uses: ./.github/actions/playwright-shell");
    expect(workflow).toContain('DIVEDAY_RUN_QUARANTINE: "1"');
    const focused = step("Focused navigation proof");
    expect(focused).toContain(
      'pnpm exec playwright test e2e/staff-nav.spec.ts e2e/navigation-zero-clamp.spec.ts --project=chromium --repeat-each=5 --grep "$(node scripts/e2e-navigation-proof.mjs grep)"',
    );
    expect(focused).not.toMatch(/\$\{\{ inputs\.|--retries|--timeout|pass-with-no-tests/);
    expect(workflow).toContain("node scripts/e2e-navigation-proof.mjs browser");
    expect(workflow).toContain("node scripts/e2e-navigation-proof.mjs summary");
    const restoration = step("Restore and verify the original runtime and journey");
    expect(restoration).toContain("always()");
    expect(restoration).toContain("node scripts/e2e-navigation-causal-proof.mjs restore");
    const before = step("Prove the named pre-fix scroll failure");
    expect(before).toContain("--repeat-each=3");
    expect(before).toContain("node scripts/e2e-navigation-causal-proof.mjs classify");
    expect(before).not.toMatch(/continue-on-error|--retries|--timeout/);
    expect(step("Retain navigation proof")).toContain("always()");
    expect(workflow).toContain("navigation-proof-*.json");
    expect(step("Open or update the red-run issue")).toContain(
      "inputs.focus != 'navigation-scroll-4183'",
    );
    expect(step("Close the red-run issue")).toContain("inputs.focus != 'navigation-scroll-4183'");
  });
});
