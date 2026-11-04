import { describe, expect, it } from "vitest";
import type { SeatWaiverStanding } from "@/lib/waivers";
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

  it("reads a seat booked as Under 18 as a minor needing a guardian, unless a date says otherwise", () => {
    expect(facts().minor).toBe(false);
    const declared = entry("a", "Asha Osei");
    Object.assign(declared.booking, { minorDeclaredAt: new Date("2026-10-01T12:00:00Z") });
    expect(facts(declared).minor).toBe(true);
    expect(facts(declared).requiresGuardian).toBe(true);
    Object.assign(declared.person, { dateOfBirth: "1990-01-01" });
    expect(facts(declared).minor).toBe(false);
    expect(facts(declared).requiresGuardian).toBe(false);
  });

  it("carries whether the row is filed under a settled group", () => {
    expect(facts(undefined, true).settledRow).toBe(true);
    expect(facts().settledRow).toBe(false);
  });
});

/**
 * **The roster says what the diver record says** (issue #3775): the word and
 * the desk's next step come from the readiness row's `seatWaiver`.
 */
describe("rosterSeat waiver standing", () => {
  function withSeatWaiver(seatWaiver: SeatWaiverStanding, blockers: unknown[] = []) {
    const row = { ...readinessRow("blocked", blockers), seatWaiver };
    return seatFacts(entry("a", "Asha Osei"), {
      readiness: new Map([["a", row]]) as ReadinessByBooking,
      waivers: new Map([["a", signedWaiver]]) as WaiverByBooking,
    });
  }

  it("offers a new link on a lapsed release, where it used to offer Send waiver as if none was ever signed", () => {
    const seat = withSeatWaiver({ standing: "lapsed", control: "lapsed", refusalRetired: false });
    expect(seat.waiverStatus).toBe("lapsed");
    expect(seat.waiverControl).toMatchObject({ label: "Needs signing again", action: "send" });
  });

  it("does not call a minor's solo signature Waiver signed", () => {
    const seat = withSeatWaiver({
      standing: "guardian_missing",
      control: "guardian_missing",
      refusalRetired: false,
    });
    expect(seat.waiverControl).toMatchObject({
      label: "Guardian signature missing",
      action: "send",
    });
  });

  it("keeps the refusal's word and gives the desk the fresh release's next step", () => {
    const seat = withSeatWaiver({
      standing: "medical_not_cleared",
      control: "lapsed",
      refusalRetired: true,
    });
    expect(seat.waiverStatus).toBe("medical_not_cleared");
    expect(seat.refusalRetired).toBe(true);
    expect(seat.waiverControl).toMatchObject({ action: "send" });
  });

  it("reads the seat's one record when the readiness read left no word", () => {
    expect(facts().waiverStatus).toBe("signed");
    expect(facts().waiverControl.action).toBeNull();
  });
});
