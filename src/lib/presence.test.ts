import { describe, expect, it } from "vitest";
import { hasArrived, isCheckedIn, PRESENCE_STATES } from "./presence";

describe("hasArrived", () => {
  it("is true only for a standing arrived row", () => {
    expect(hasArrived("arrived")).toBe(true);
    expect(hasArrived("cleared")).toBe(false);
    expect(hasArrived(undefined)).toBe(false);
  });
});

/**
 * Checked in is two records read together (issue #2702): the seat word says
 * the shop still holds the seat, and the trail says the desk saw the person.
 * Either alone is not a check-in.
 */
describe("isCheckedIn", () => {
  it("is a held seat the desk has seen", () => {
    expect(isCheckedIn("booked", "arrived")).toBe(true);
  });

  it("is not a held seat the desk never saw, or took the sighting back on", () => {
    expect(isCheckedIn("booked", undefined)).toBe(false);
    expect(isCheckedIn("booked", "cleared")).toBe(false);
  });

  // Adversarial: a release and a cancel both leave the sighting standing on
  // purpose. Reading the trail alone would put a diver the desk wrote off back
  // on the counter as through it, and on the manifest as at the desk.
  it("is never a released or cancelled seat, whatever the trail still says", () => {
    expect(isCheckedIn("no_show", "arrived")).toBe(false);
    expect(isCheckedIn("cancelled", "arrived")).toBe(false);
  });

  // Adversarial: the word the column used to carry. Nothing may write it any
  // more, and a stray copy of it (an old offline snapshot, a hand-typed
  // fixture) must not read as a check-in on its own.
  it("does not take the retired seat word as a check-in", () => {
    expect(isCheckedIn("checked_in", undefined)).toBe(false);
    expect(isCheckedIn("checked_in", "arrived")).toBe(false);
  });
});

describe("PRESENCE_STATES", () => {
  it("names each state once", () => {
    expect(new Set(PRESENCE_STATES).size).toBe(PRESENCE_STATES.length);
  });

  // Arrival is never aboard (ADR 20260907-the-counter-survives-offline,
  // decision 4): the desk's state and the rail's are different words.
  it("keeps arrived apart from boarded", () => {
    expect(PRESENCE_STATES).toContain("arrived");
    expect(PRESENCE_STATES).toContain("boarded");
    expect(PRESENCE_STATES.indexOf("arrived")).not.toBe(PRESENCE_STATES.indexOf("boarded"));
  });
});
