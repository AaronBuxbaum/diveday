import { describe, expect, it } from "vitest";
import { entry, readinessRow, seatFacts, signedWaiver } from "./roster-test-fixtures";
import type { ReadinessByBooking, WaiverByBooking } from "./types";

/**
 * `rosterSeat` is the first link of the row's builder chain: one seat's own
 * facts, read off the departure's maps. Each later builder's test starts from
 * these (`seatFacts`); this pins the few facts it derives itself.
 */
function facts(rosterEntry = entry("a", "Asha Osei"), settled = false) {
  return seatFacts(rosterEntry, {
    readiness: new Map([["a", readinessRow("ready")]]) as ReadinessByBooking,
    waivers: new Map([["a", signedWaiver]]) as WaiverByBooking,
    settled,
  });
}

describe("rosterSeat", () => {
  it("has an emergency contact only with both a name and a phone", () => {
    expect(facts().hasEmergencyContact).toBe(true);
    expect(facts(entry("a", "Asha Osei", { emergencyContactPhone: "" })).hasEmergencyContact).toBe(
      false,
    );
  });

  it("holds a seat booked under a guess, from the booking's own flag", () => {
    expect(facts().identityUnconfirmed).toBe(false);
    const held = entry("a", "Asha Osei");
    Object.assign(held.booking, { identityUnconfirmedAt: new Date("2026-10-01T12:00:00Z") });
    expect(facts(held).identityUnconfirmed).toBe(true);
  });

  it("carries whether the row is filed under a settled group", () => {
    expect(facts(undefined, true).settledRow).toBe(true);
    expect(facts().settledRow).toBe(false);
  });
});
