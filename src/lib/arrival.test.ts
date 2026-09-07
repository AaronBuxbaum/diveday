import { describe, expect, it } from "vitest";
import { ARRIVAL_RETRACTION_SUPERSEDED, type ArrivalStatus, latestArrival } from "./arrival";

describe("the counter's vocabulary", () => {
  const at = (iso: string, status: ArrivalStatus = "arrived") => ({ status, occurredAt: iso });

  it("reads the newest tap, and reads a newest undo as nobody having arrived", () => {
    expect(latestArrival([])).toBeUndefined();
    expect(latestArrival([at("2026-09-07T10:00:00.000Z")])).toMatchObject({ status: "arrived" });
    expect(
      latestArrival([at("2026-09-07T10:00:00.000Z"), at("2026-09-07T10:05:00.000Z", "cleared")]),
    ).toBeUndefined();
    expect(
      latestArrival([at("2026-09-07T10:05:00.000Z", "cleared"), at("2026-09-07T10:06:00.000Z")]),
    ).toMatchObject({ status: "arrived" });
  });

  /**
   * The e2e fleet freezes the clock outright, so two taps on one seat share a
   * timestamp and the tie is the ordinary case. Later-queued wins, matching
   * the order the sync route applies a batch in.
   */
  it("breaks a shared timestamp on queue order", () => {
    const same = "2026-09-07T10:00:00.000Z";
    expect(latestArrival([at(same), at(same, "cleared")])).toBeUndefined();
    expect(latestArrival([at(same, "cleared"), at(same)])).toMatchObject({ status: "arrived" });
  });

  it("orders `Date` and ISO-string histories alike, since a server row and a queued tap share it", () => {
    expect(
      latestArrival([
        { status: "arrived", occurredAt: new Date("2026-09-07T10:00:00.000Z") },
        { status: "cleared", occurredAt: new Date("2026-09-07T10:05:00.000Z") },
      ]),
    ).toBeUndefined();
  });

  /**
   * The refusal code is a contract between the writer and the device that
   * reads it back, not a debug string — the same reason `RETRACTION_SUPERSEDED`
   * is a shared constant in `roll-call.ts`.
   */
  it("spells its retraction refusal the way its siblings do", () => {
    expect(ARRIVAL_RETRACTION_SUPERSEDED).toBe("retraction_superseded");
  });
});
