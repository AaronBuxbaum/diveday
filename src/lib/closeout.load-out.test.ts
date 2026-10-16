import { describe, expect, it } from "vitest";
import { dayLoadOut, tomorrowNoon } from "./closeout";

/** Tomorrow from tonight (fifth-loop ideas, item 2): a day's boats added together. */
describe("dayLoadOut", () => {
  it("adds every boat's tanks and the pieces the shop still offers", () => {
    expect(
      dayLoadOut([
        {
          tanks: { total: 22, air: 18, nitrox: 4 },
          lines: [
            { count: 6, notOffered: false },
            { count: 2, notOffered: true },
          ],
        },
        { tanks: { total: 20, air: 18, nitrox: 2 }, lines: [{ count: 9, notOffered: false }] },
      ]),
    ).toEqual({ departures: 2, tanks: { total: 42, air: 36, nitrox: 6 }, rentalPieces: 15 });
  });

  it("says nothing about a day with no departure", () => {
    expect(dayLoadOut([])).toBeNull();
  });
});

describe("tomorrowNoon", () => {
  it("is noon on the shop's next calendar day, not the server's", () => {
    // 11:30 PM in Key Largo on Oct 15 is already Oct 16 in UTC.
    const lateEvening = new Date("2026-10-16T03:30:00Z");
    expect(tomorrowNoon(lateEvening, "America/New_York").toISOString()).toBe(
      "2026-10-16T16:00:00.000Z",
    );
  });

  it("holds its hour across a daylight-saving change", () => {
    // The night of Nov 1, 2026: clocks fall back in New York.
    expect(tomorrowNoon(new Date("2026-11-01T02:00:00Z"), "America/New_York").toISOString()).toBe(
      "2026-11-01T17:00:00.000Z",
    );
  });
});
