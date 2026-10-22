import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ciObservation, metricRecord, readRows } from "./task-metrics.mjs";

it("records missing usage as unknown and has no separate token total", () => {
  expect(metricRecord({ task: "T", event: "started" }).usage).toBeNull();
  expect(metricRecord({ task: "T", event: "started" })).not.toHaveProperty("tokens");
  expect(() =>
    metricRecord({ task: "T", event: "usage", tokens: 12, usageSource: "provider export" }),
  ).toThrow(/usage/);
});

it("skips a corrupt ledger line instead of losing every row", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "metrics-"));
  try {
    const file = path.join(dir, "events.jsonl");
    writeFileSync(
      file,
      '{"task":"A","event":"started"}\n{"task":"B",\n[1]\n{"task":"C","event":"merged"}\n',
    );
    const { rows, corrupt } = readRows(file);
    expect(rows.map((row) => row.task)).toEqual(["A", "C"]);
    expect(corrupt).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
