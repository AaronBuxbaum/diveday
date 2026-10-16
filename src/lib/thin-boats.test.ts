import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { thinBoatNeed } from "./thin-boats";

const NOW = new Date("2026-10-16T12:00:00Z");
const startsAt = new Date(NOW.getTime() + 5 * 24 * HOUR_MS);
const base = { startsAt, capacity: 12, minimumBookings: null, minimumDecisionHours: null };

describe("thinBoatNeed", () => {
  it("counts a boat under half full, and not one at half", () => {
    expect(thinBoatNeed({ ...base, booked: 0 }, NOW)).toEqual({ kind: "seats" });
    expect(thinBoatNeed({ ...base, booked: 5 }, NOW)).toEqual({ kind: "seats" });
    expect(thinBoatNeed({ ...base, booked: 6 }, NOW)).toBeNull();
  });

  it("names the shortfall and the deadline of a boat short of its minimum", () => {
    const need = thinBoatNeed(
      { ...base, booked: 2, minimumBookings: 6, minimumDecisionHours: 48 },
      NOW,
    );
    expect(need).toEqual({
      kind: "minimum",
      shortfall: 4,
      decidesAt: new Date(startsAt.getTime() - 48 * HOUR_MS),
    });
  });

  it("leaves out a boat that met its minimum, even under half full", () => {
    expect(thinBoatNeed({ ...base, booked: 4, minimumBookings: 4 }, NOW)).toBeNull();
  });

  it("leaves out a boat past its call, a full boat and one with no seats", () => {
    const due = new Date(NOW.getTime() + 24 * HOUR_MS);
    expect(thinBoatNeed({ ...base, startsAt: due, booked: 1, minimumBookings: 6 }, NOW)).toBeNull();
    expect(thinBoatNeed({ ...base, booked: 12 }, NOW)).toBeNull();
    expect(thinBoatNeed({ ...base, capacity: 0, booked: 0 }, NOW)).toBeNull();
  });
});
