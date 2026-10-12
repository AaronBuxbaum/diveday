import { describe, expect, it } from "vitest";
import { buddyNamesList, offlineRollCallRowId, reTap } from "./shared";

describe("offlineRollCallRowId", () => {
  it("mints the one id the row carries and the missing-divers grid jumps to", () => {
    expect(offlineRollCallRowId("b-1")).toBe("offline-roll-call-b-1");
  });
});

describe("buddyNamesList", () => {
  it("joins the names as a list and holds each one whole", () => {
    expect(buddyNamesList("en-US", ["Ana Costa", "Sam Lee"])).toBe("Ana Costa and Sam Lee");
  });
});

describe("reTap", () => {
  const local = {
    state: "boarded" as const,
    occurredAt: "2026-08-01T13:00:00.000Z",
    pending: true,
    implied: false,
    local: true,
    clientEventId: "evt-1",
  };

  it("retracts this device's own reading, naming the event it undoes", () => {
    expect(reTap(local, true, "boarded")).toEqual({
      status: "cleared",
      retractsClientEventId: "evt-1",
    });
  });

  it("states afresh over a reading this device did not record, never a bare cleared", () => {
    expect(reTap({ ...local, local: false }, true, "not_boarded")).toEqual({
      status: "not_boarded",
    });
    expect(reTap({ ...local, clientEventId: undefined }, true, "boarded")).toEqual({
      status: "boarded",
    });
    expect(reTap(local, false, "not_boarded")).toEqual({ status: "not_boarded" });
    expect(reTap(undefined, true, "boarded")).toEqual({ status: "boarded" });
  });
});
