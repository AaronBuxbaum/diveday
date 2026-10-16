import { describe, expect, it } from "vitest";
import { personWeekTotals, staffWeek, type WeekPerson } from "./staffing-week";

/** Key Largo, as `staffing-week.test.ts` builds its week. */
const TZ = "America/New_York";

function person(overrides: Partial<WeekPerson> = {}): WeekPerson {
  return {
    personId: "person-1",
    name: "Keiko Tanaka",
    roles: ["Divemaster"],
    shifts: [],
    crewingTrips: [],
    ...overrides,
  };
}

function build(input: { people?: WeekPerson[] } = {}) {
  return staffWeek({
    people: input.people ?? [person()],
    gaps: [],
    weekStart: "2026-08-24",
    timeZone: TZ,
    today: "2026-08-27",
  });
}

/** Fifth-loop ideas, item 52: one figure under each name. */
describe("personWeekTotals", () => {
  const at = (iso: string) => new Date(iso);
  it("counts working days, distinct boats, and the union of shifts and crewed hours", () => {
    const week = build({
      people: [
        person({
          shifts: [
            // Monday 7:00–15:00 Key Largo, covering the morning boat below.
            {
              id: "mon",
              startsAt: at("2026-08-24T11:00:00Z"),
              endsAt: at("2026-08-24T19:00:00Z"),
              note: null,
            },
            // Wednesday 9:00–13:00, no boat.
            {
              id: "wed",
              startsAt: at("2026-08-26T13:00:00Z"),
              endsAt: at("2026-08-26T17:00:00Z"),
              note: null,
            },
          ],
          crewingTrips: [
            {
              tripId: "boat-mon",
              title: "Molasses",
              meetings: [
                { startsAt: at("2026-08-24T12:00:00Z"), endsAt: at("2026-08-24T16:00:00Z") },
              ],
            },
            {
              tripId: "boat-fri",
              title: "Wall",
              meetings: [
                { startsAt: at("2026-08-28T12:00:00Z"), endsAt: at("2026-08-28T17:00:00Z") },
              ],
            },
          ],
        }),
      ],
    });
    const keiko = week.people[0];
    if (!keiko) throw new Error("expected a row");
    // Monday 8 h (the boat inside the shift), Wednesday 4 h, Friday 5 h.
    expect(personWeekTotals(keiko)).toEqual({ days: 3, boats: 2, minutes: 17 * 60 });
  });

  it("is all zeros for an empty row", () => {
    const empty = build().people[0];
    if (!empty) throw new Error("expected a row");
    expect(personWeekTotals(empty)).toEqual({ days: 0, boats: 0, minutes: 0 });
  });
});
