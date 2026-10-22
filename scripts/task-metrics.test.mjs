import { expect, it } from "vitest";
import { ciObservation, metricRecord } from "./task-metrics.mjs";

it("records missing tokens as unknown and requires an observed source", () => {
  expect(metricRecord({ task: "T", event: "started" }).tokens).toBeNull();
  expect(() => metricRecord({ task: "T", event: "usage", tokens: 12 })).toThrow(/usageSource/);
  expect(
    metricRecord({ task: "T", event: "usage", tokens: 12, usageSource: "provider export" }).tokens,
  ).toBe(12);
});

it("requires identifiable usage measurements and keeps token categories distinct", () => {
  expect(() =>
    metricRecord({ task: "T", event: "usage", usage: { output: 5 }, usageSource: "export" }),
  ).toThrow(/eventId/);
  expect(
    metricRecord({
      task: "T",
      event: "usage",
      eventId: "event-1",
      usageSource: "export",
      usage: { cachedInput: 20, uncachedInput: 10, output: 5 },
    }).usage.output,
  ).toBe(5);
});

it("imports actual CI attempt identity and refuses incomplete outcomes", () => {
  const manifest = {
    runId: "42",
    attempt: "2",
    headSha: "abc",
    url: "https://github.com/o/r/actions/runs/42",
    jobs: [{ result: "failure" }],
  };
  expect(ciObservation(manifest, { task: "T" })).toMatchObject({
    event: "ci-failed",
    sha: "abc",
    eventId: "https://github.com/o/r/actions/runs/42:42:2",
  });
  expect(() =>
    ciObservation({ ...manifest, jobs: [{ result: "pending" }] }, { task: "T" }),
  ).toThrow(/incomplete/);
});
