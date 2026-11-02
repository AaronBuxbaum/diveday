import { describe, expect, it } from "vitest";
import { hasArrived, PRESENCE_STATES, seatStatusAfterRelease } from "./presence";

describe("seatStatusAfterRelease", () => {
  it("puts a seen diver back as checked in", () => {
    expect(seatStatusAfterRelease("arrived")).toBe("checked_in");
  });

  // Adversarial: the desk took the check-in back, or never made one. Either
  // way the diver is still to come; a restore that guessed `checked_in` would
  // show them at the counter, and ready to board, on nobody's word.
  it("puts a diver whose check-in was retracted back as booked", () => {
    expect(seatStatusAfterRelease("cleared")).toBe("booked");
  });

  it("puts a diver the desk never saw back as booked", () => {
    expect(seatStatusAfterRelease(undefined)).toBe("booked");
  });

  it("only ever answers with a slot that holds the seat", () => {
    for (const standing of ["arrived", "cleared", undefined] as const) {
      expect(["booked", "checked_in"]).toContain(seatStatusAfterRelease(standing));
    }
  });
});

describe("hasArrived", () => {
  it("is true only for a standing arrived row", () => {
    expect(hasArrived("arrived")).toBe(true);
    expect(hasArrived("cleared")).toBe(false);
    expect(hasArrived(undefined)).toBe(false);
  });
});

describe("PRESENCE_STATES", () => {
  it("names each state once", () => {
    expect(new Set(PRESENCE_STATES).size).toBe(PRESENCE_STATES.length);
  });
});
