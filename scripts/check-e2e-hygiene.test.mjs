import { describe, expect, it } from "vitest";

import { ACKNOWLEDGEMENT, findHygieneViolations } from "./check-e2e-hygiene.mjs";

const ruleIds = (source) => findHygieneViolations(source).map((v) => v.rule);

describe("sleeps", () => {
  it("catches waitForTimeout on page and locator alike", () => {
    expect(ruleIds("await page.waitForTimeout(500);")).toEqual(["sleep"]);
    expect(ruleIds("await row.waitForTimeout( 1_000 )")).toEqual(["sleep"]);
  });

  it("never flags test.setTimeout — a per-test budget is policy, not a sleep", () => {
    expect(ruleIds("test.setTimeout(45_000);")).toEqual([]);
  });

  it("never flags a raw setTimeout inside an injected page function", () => {
    // visual.spec.ts legitimately schedules browser-side work this way.
    expect(ruleIds("new Promise((resolve) => setTimeout(resolve, remaining))")).toEqual([]);
  });
});

describe("networkidle", () => {
  it("catches the wait state in any quote style", () => {
    expect(ruleIds('await page.waitForLoadState("networkidle");')).toEqual(["networkidle"]);
    expect(ruleIds("await page.goto(url, { waitUntil: 'networkidle' })")).toEqual(["networkidle"]);
  });
});

describe("retries", () => {
  it("catches a spec-level retries override", () => {
    expect(ruleIds("test.describe.configure({ retries: 2 });")).toEqual(["retries"]);
  });

  it("never flags prose mentioning retries without configuring them", () => {
    // The real comment in visual.spec.ts: "the suite has no retries (playwright.config.ts)".
    expect(ruleIds("// and the suite has no retries (playwright.config.ts).")).toEqual([]);
  });

  it("never flags the timeout key beside it", () => {
    expect(ruleIds("test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });")).toEqual([]);
  });
});

describe("retry loops", () => {
  it("catches the attempt-counter loop shape that #411 removed", () => {
    expect(ruleIds("for (let attempt = 0; attempt < 3; attempt += 1) {")).toEqual(["retry-loop"]);
    expect(ruleIds("while (retryCount < MAX) {")).toEqual(["retry-loop"]);
    expect(ruleIds("while (retry < MAX) {")).toEqual(["retry-loop"]);
  });

  it("catches while-loops that declare an attempt counter inline", () => {
    expect(ruleIds("for (var tries = 0; tries < 5; tries++) {")).toEqual(["retry-loop"]);
  });

  it("never flags ordinary iteration", () => {
    expect(ruleIds("for (const row of rows) {")).toEqual([]);
    expect(ruleIds("for (let index = 0; index < count; index += 1) {")).toEqual([]);
  });
});

describe("acknowledgement marker", () => {
  it("passes a violation acknowledged on the same line", () => {
    expect(
      ruleIds(
        `await page.waitForTimeout(50); // ${ACKNOWLEDGEMENT} sleep: clock-freeze tick, deterministic by construction`,
      ),
    ).toEqual([]);
  });

  it("passes a violation acknowledged on the line above", () => {
    const source = [
      `// ${ACKNOWLEDGEMENT} sleep: service-worker registration has no DOM signal`,
      "await page.waitForTimeout(100);",
    ].join("\n");
    expect(ruleIds(source)).toEqual([]);
  });

  it("does not let one marker cover a later line", () => {
    const source = [
      `// ${ACKNOWLEDGEMENT} sleep: covered`,
      "await page.waitForTimeout(100);",
      "await page.waitForTimeout(200);",
    ].join("\n");
    expect(findHygieneViolations(source)).toHaveLength(1);
  });
});

describe("comment lines", () => {
  it("never flags prose about a banned pattern", () => {
    expect(ruleIds("// never reaches the `networkidle` state the scan waits for")).toEqual([]);
    expect(
      ruleIds(' * scan". Each scan costs ~3.5s here (the `networkidle` wait dominates)'),
    ).toEqual([]);
  });
});

describe("reporting", () => {
  it("reports rule id and 1-indexed line", () => {
    const source = ["const a = 1;", 'await page.waitForLoadState("networkidle");'].join("\n");
    expect(findHygieneViolations(source)).toEqual([
      { rule: "networkidle", line: 2, text: 'await page.waitForLoadState("networkidle");' },
    ]);
  });
});
