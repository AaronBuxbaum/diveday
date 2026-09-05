import { describe, expect, it } from "vitest";
import { tripCalendarFile } from "./trip-calendar";

describe("tripCalendarFile", () => {
  it("writes UTC times and escapes diver-facing text", () => {
    const file = tripCalendarFile({
      title: "Reef, wreck; & rays",
      description: "Meet aboard\nBring a towel",
      startsAt: new Date("2026-08-03T13:00:00.000Z"),
      endsAt: new Date("2026-08-03T17:30:00.000Z"),
      location: "Molasses Reef, Key Largo",
      url: "https://diveday.test/s/blue-mantis/trips/trip-1",
      revision: 0,
    });

    expect(file).toContain("DTSTART:20260803T130000Z\r\nDTEND:20260803T173000Z");
    expect(file).toContain("SUMMARY:Reef\\, wreck\\; & rays");
    expect(file).toContain("LOCATION:Molasses Reef\\, Key Largo");
    expect(file).toContain("Meet aboard\\nBring a towel");
    // Written at zero rather than omitted: an absent SEQUENCE and a zero are
    // different facts to a calendar client (issue #1165).
    expect(file).toContain("SEQUENCE:0");
    expect(file).toMatch(/END:VCALENDAR\r\n$/);
  });

  it("publishes the trip's own revision as SEQUENCE, so a moved departure updates the diver's entry", () => {
    const file = tripCalendarFile({
      title: "Molasses Reef, two tanks",
      startsAt: new Date("2026-08-03T13:00:00.000Z"),
      endsAt: new Date("2026-08-03T17:30:00.000Z"),
      url: "https://diveday.test/s/blue-mantis/trips/trip-1",
      revision: 3,
    });

    expect(file).toContain("SEQUENCE:3");
  });
});
