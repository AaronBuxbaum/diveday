import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectState, saveTaskState, validateState } from "./agent-task-state.mjs";

const state = {
  version: 1,
  task: "fix",
  owner: "worker",
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  ownedPaths: [],
  decisions: [],
  checks: [],
  visualEvidence: [],
  processes: [],
  pending: [],
  blockers: [],
  nextCommand: "pnpm test scripts/agent-task-state.test.mjs",
};
describe("durable handoff", () => {
  it("accepts complete state and refuses lost provenance", () => {
    expect(validateState(state)).toEqual([]);
    expect(validateState({ ...state, decisions: [{ text: "Interest" }] })).toContain(
      "each decision needs exact text and source",
    );
  });
  it("reports stale head and exited process without killing it", () => {
    const result = inspectState(
      { ...state, processes: [{ pid: 42, owner: "worker", command: "test" }] },
      "c".repeat(40),
      () => false,
    );
    expect(result.headChanged).toBe(true);
    expect(result.processes[0].alive).toBe(false);
  });
});

it("reports malformed state without crashing and rejects untraceable evidence", () => {
  expect(validateState(null)).toContain("state must be an object");
  expect(inspectState({ ...state, decisions: {} }, state.headSha).errors).toContain(
    "decisions must be an array",
  );
  expect(validateState({ ...state, checks: [{ result: "passed" }] })).not.toEqual([]);
  expect(validateState({ ...state, visualEvidence: [{ artifact: "image.png" }] })).not.toEqual([]);
});

it("records a start only after validated state is saved, with a stable dedup identity", () => {
  const root = mkdtempSync(path.join(tmpdir(), "task-state-"));
  const calls = [];
  const record = (event, options) => {
    expect(
      JSON.parse(readFileSync(path.join(root, ".agent-out/task-state.json"), "utf8")).task,
    ).toBe(state.task);
    calls.push(event);
    expect(options.root).toBe(root);
    return { recorded: calls.length === 1 };
  };
  try {
    expect(
      saveTaskState(root, state, { resolveSha: () => state.headSha, record }).metric.recorded,
    ).toBe(true);
    expect(
      saveTaskState(root, state, { resolveSha: () => state.headSha, record }).metric.recorded,
    ).toBe(false);
    expect(calls[0].eventId).toBe(calls[1].eventId);
    expect(calls[0]).toMatchObject({ event: "started", provider: "unknown", taskClass: "unknown" });
    expect(calls[0]).not.toHaveProperty("at");
    expect(calls[0]).not.toHaveProperty("usage");
    expect(() => saveTaskState(root, { ...state, headSha: "bad" }, { record })).toThrow();
    expect(calls).toHaveLength(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
