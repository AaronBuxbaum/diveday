import { expect, it } from "vitest";
import { canRetryWedges } from "./e2e-retry-policy.mjs";

const test = (message) => ({
  status: "unexpected",
  expectedStatus: "passed",
  results: [{ status: "failed", errors: [{ message }] }],
});
const wedge =
  "visual: page.screenshot did not return within 2000ms at http://localhost/a (shot.png). The renderer did not answer a trivial evaluate, so it is wedged, not slow — the known, unattributed Chromium wedge.";
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
