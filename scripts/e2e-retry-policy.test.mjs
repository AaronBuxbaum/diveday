import { expect, it } from "vitest";
import { canRetryWedges } from "./e2e-retry-policy.mjs";

const test = (message) => ({
  status: "unexpected",
  expectedStatus: "passed",
  results: [{ status: "failed", errors: [{ message }] }],
});
const wedge =
  "visual: page.screenshot did not return within 2000ms at http://localhost/a (shot.png). The renderer did not answer a trivial evaluate, so it is wedged, not slow — the known, unattributed Chromium wedge.";
const boundedWedge =
  "visual: the font settle did not return within 10000ms at http://localhost/a — the shot may contain an unpainted band; check the diff for a blank stripe. The renderer did not answer a trivial evaluate within 5000ms, so it is wedged, not slow.";
const report = (...tests) => ({ errors: [], suites: [{ specs: [{ tests }] }] });
it("allows only exclusively proven wedge failures", () => {
  expect(canRetryWedges(report(test(wedge)))).toBe(true);
  expect(canRetryWedges(report(test(wedge), test("ordinary assertion")))).toBe(false);
  expect(canRetryWedges(report(test("ordinary assertion")))).toBe(false);
  expect(canRetryWedges({})).toBe(false);
  expect(canRetryWedges(report())).toBe(false);
  expect(
    canRetryWedges({
      ...report(test(wedge)),
      errors: [{ message: "worker crashed" }],
    }),
  ).toBe(false);
});
it("recognizes the harness's explicit bounded-wait wedge verdict", () => {
  expect(canRetryWedges(report(test(boundedWedge)))).toBe(true);
  expect(
    canRetryWedges(
      report(
        test(
          boundedWedge.replace("did not answer a trivial evaluate", "answered a trivial evaluate"),
        ),
      ),
    ),
  ).toBe(false);
  expect(canRetryWedges(report(test(`An assertion quoted: ${boundedWedge}`)))).toBe(false);
});
it("recognizes only the same timed-out test probe attachment, rejecting missing proof", () => {
  const failure = test("Test timeout exceeded");
  failure.results[0].status = "timedOut";
  failure.results[0].attachments = [
    {
      name: "browser-activity",
      contentType: "text/plain",
      body: Buffer.from(
        "renderer: no answer to evaluate(() => true) in 2000ms — wedged, not slow\n",
      ).toString("base64"),
    },
  ];
  expect(canRetryWedges(report(failure))).toBe(true);
  failure.results[0].status = "failed";
  expect(canRetryWedges(report(failure))).toBe(false);
  failure.results[0].status = "timedOut";
  failure.results[0].attachments = [
    { name: "browser-activity", path: "/missing/attachment", contentType: "text/plain" },
  ];
  expect(canRetryWedges(report(failure))).toBe(false);
});
it("does not treat a quoted wedge phrase in an ordinary assertion as probe evidence", () => {
  expect(canRetryWedges(report(test('Expected text to contain "wedged, not slow"')))).toBe(false);
});

const expectedSkip = () => ({
  status: "skipped",
  expectedStatus: "skipped",
  results: [{ status: "skipped", errors: [] }],
});
const observedFailure = () => ({
  status: "unexpected",
  expectedStatus: "passed",
  results: [
    {
      status: "timedOut",
      retry: 0,
      errors: [
        { message: "\u001b[31mTest timeout of 230000ms exceeded.\u001b[39m" },
        { message: `Error: ${wedge.replace("2000ms", "20000ms")}\n\n   at visual-harness.ts:1229` },
      ],
      attachments: [
        {
          name: "browser-activity",
          contentType: "text/plain",
          body: Buffer.from(
            "renderer: no answer to evaluate(() => true) in 5000ms — wedged, not slow\n8 requests · 12 failed · 0 pageerror\n",
          ).toString("base64"),
        },
      ],
    },
  ],
});
it("accepts the observed CI8 timeout plus direct wedge alongside its expected audit skip", () => {
  // Extracted report shape from run 39806214289 artifact 12439900575:
  // one timedOut result with 2 errors, inline probe, and an expected skipped audit.
  expect(canRetryWedges(report(observedFailure(), expectedSkip()))).toBe(true);
});
it("permits only completely executed expected skips and still requires a failed wedge", () => {
  expect(canRetryWedges(report(expectedSkip()))).toBe(false);
  const unexpected = expectedSkip();
  unexpected.expectedStatus = "passed";
  expect(canRetryWedges(report(test(wedge), unexpected))).toBe(false);
  for (const status of ["interrupted", "timedOut", "failed"]) {
    const incomplete = expectedSkip();
    incomplete.results[0].status = status;
    expect(canRetryWedges(report(test(wedge), incomplete))).toBe(false);
  }
  const unexecuted = expectedSkip();
  unexecuted.results = [];
  expect(canRetryWedges(report(test(wedge), unexecuted))).toBe(false);
});
it("refuses a real assertion mixed with deadline and direct wedge proof", () => {
  const failure = observedFailure();
  failure.results[0].errors.push({ message: "expect(locator).toBeVisible() failed" });
  expect(canRetryWedges(report(failure))).toBe(false);
});
it("refuses timeout alone, quoted deadlines and missing independent proof", () => {
  const failure = observedFailure();
  failure.results[0].errors = [failure.results[0].errors[0]];
  failure.results[0].attachments = [];
  expect(canRetryWedges(report(failure))).toBe(false);
  failure.results[0].errors.push({ message: wedge });
  failure.results[0].errors[0].message =
    "Assertion expected text: Test timeout of 230000ms exceeded.";
  expect(canRetryWedges(report(failure))).toBe(false);
});
it("requires a deadline companion to be in the same timedOut result", () => {
  const failure = observedFailure();
  failure.results[0].status = "failed";
  expect(canRetryWedges(report(failure))).toBe(false);
  const deadline = test("Test timeout of 230000ms exceeded.");
  deadline.results[0].status = "timedOut";
  expect(canRetryWedges(report(test(wedge), deadline))).toBe(false);
});

it("refuses supposedly expected passes that have no completed result", () => {
  for (const results of [
    [],
    [{ status: "interrupted", errors: [] }],
    [{ status: "skipped", errors: [] }],
  ]) {
    expect(
      canRetryWedges(
        report(test(wedge), { status: "expected", expectedStatus: "passed", results }),
      ),
    ).toBe(false);
  }
});
