import { describe, expect, it } from "vitest";
import {
  canonicalRollCallEvidenceId,
  causalReplayOrder,
  causalScopeAllowsObservation,
  clientRollCallEvidenceId,
  rollCallEvidenceIdPattern,
  rollCallIntentKey,
} from "./roll-call-causality";

const first = "10000000-0000-4000-8000-000000000001";
const second = "10000000-0000-4000-8000-000000000002";

describe("causal reference identity and replay", () => {
  it("keeps server-row and client-tap UUID namespaces independent", () => {
    expect(canonicalRollCallEvidenceId({ id: first })).toBe(`server:${first}`);
    expect(canonicalRollCallEvidenceId({ id: second, clientEventId: first })).toBe(
      `client:${first}`,
    );
    expect(canonicalRollCallEvidenceId({ id: first, clientEventId: null })).toBe(`server:${first}`);
    expect(clientRollCallEvidenceId(first.toUpperCase())).toBe(`client:${first}`);
    expect(rollCallEvidenceIdPattern.test(first)).toBe(false);
    expect(rollCallEvidenceIdPattern.test(`client:${first}`)).toBe(true);
    expect(rollCallEvidenceIdPattern.test(`server:${first}`)).toBe(true);
  });

  it("replays an observed queued predecessor before its correction, never by capture time", () => {
    const earlier = { clientEventId: first, observedEvidenceIds: [], occurredAt: "2099-01-01" };
    const correction = {
      clientEventId: second,
      observedEvidenceIds: [clientRollCallEvidenceId(first)],
      occurredAt: "2000-01-01",
    };
    expect(causalReplayOrder([correction, earlier])).toEqual([earlier, correction]);
    expect(causalReplayOrder([earlier, correction])).toEqual([earlier, correction]);
  });

  it("does not confuse a server reference with a queued client dependency", () => {
    const observer = { clientEventId: second, observedEvidenceIds: [`server:${first}`] };
    const queued = { clientEventId: first };
    expect(causalReplayOrder([observer, queued])).toEqual([observer, queued]);
    expect(causalReplayOrder([])).toEqual([]);
  });

  it("retains cyclic and self-referencing queues without inventing chronology or dropping evidence", () => {
    const a = { clientEventId: first, observedEvidenceIds: [clientRollCallEvidenceId(second)] };
    const b = { clientEventId: second, observedEvidenceIds: [clientRollCallEvidenceId(first)] };
    expect(causalReplayOrder([a, b])).toEqual([a, b]);
    const self = { clientEventId: first, observedEvidenceIds: [clientRollCallEvidenceId(first)] };
    expect(causalReplayOrder([self])).toEqual([self]);
  });
});

it("permits only same-day or explicit carried-alarm observations", () => {
  expect(causalScopeAllowsObservation(0, 0, "boarded", "departure")).toBe(true);
  expect(causalScopeAllowsObservation(1, 0, "boarded", "departure", true)).toBe(false);
  expect(causalScopeAllowsObservation(1, 0, "boarded", "after_dive_1")).toBe(false);
  expect(causalScopeAllowsObservation(1, 0, "not_boarded", "after_dive_1")).toBe(true);
  expect(causalScopeAllowsObservation(1, -1, "not_boarded", "after_dive_1")).toBe(true);
  expect(causalScopeAllowsObservation(1, 0, "boarded", "after_dive_1", true)).toBe(true);
  expect(causalScopeAllowsObservation(-1, 0, "not_boarded", "after_dive_1", true)).toBe(false);
  expect(causalScopeAllowsObservation(0, 1, "not_boarded", "after_dive_1", true)).toBe(false);
});

it("keeps immutable retry intent distinct across selected days and exact targets", () => {
  const captured = {
    checkpoint: "after_dive_1",
    status: "cleared",
    meetingDay: 0,
    observedEvidenceIds: [`client:${first}`, `client:${second}`],
    retractsClientEventId: first,
  };
  expect(rollCallIntentKey(captured)).toBe(
    rollCallIntentKey({
      ...captured,
      occurredAt: "2099-01-01",
      observedEvidenceIds: [`client:${second}`, `client:${first}`],
    }),
  );
  expect(rollCallIntentKey(captured)).not.toBe(rollCallIntentKey({ ...captured, meetingDay: 1 }));
  expect(rollCallIntentKey(captured)).not.toBe(
    rollCallIntentKey({ ...captured, meetingDay: undefined }),
  );
  expect(rollCallIntentKey(captured)).not.toBe(
    rollCallIntentKey({ ...captured, retractsClientEventId: second }),
  );
  expect(rollCallIntentKey(captured)).not.toBe(
    rollCallIntentKey({ ...captured, retractsClientEventId: undefined, retractsEventId: first }),
  );
  expect(rollCallIntentKey({ ...captured, retractsClientEventId: first.toUpperCase() })).toBe(
    rollCallIntentKey(captured),
  );
  expect(rollCallIntentKey({ status: "boarded", retractsClientEventId: first })).toBe(
    rollCallIntentKey({ status: "boarded" }),
  );
  expect(rollCallIntentKey({ status: "boarded", observedEvidenceIds: null })).not.toBe(
    rollCallIntentKey({ status: "boarded", observedEvidenceIds: [] }),
  );
});
