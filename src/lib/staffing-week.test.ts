import { describe, expect, it } from "vitest";
import { staffWeek, type WeekGap, type WeekPerson } from "./staffing-week";

/**
 * Slice 9e of ADR 20260827-the-shops-shelves, pinned as rules rather than
 * pixels. Five of them, and each one is a bug this surface can have without
 * anything looking broken:
 *
 * 1. every bucket is a **shop-local** day, not the host's;
 * 2. a gap lands in a day its departure actually meets, carrying its own code;
 * 3. a departure somebody crews survives even with no shift against it;
 * 4. the week is seven days, Monday first, and no *shift* outside it leaks in;
 * 5. a departure is placed by the days it **meets**, so a multi-day course
 *    occupies every one of them and still appears in a week it merely runs
 *    through.
 */

/** Key Largo. UTC-4 in August, which is what makes the late-evening cases bite. */
const TZ = "America/New_York";
const MONDAY = "2026-08-24";
const THURSDAY = "2026-08-27";

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

function build(input: { people?: WeekPerson[]; gaps?: WeekGap[]; today?: string } = {}) {
  return staffWeek({
    people: input.people ?? [person()],
    gaps: input.gaps ?? [],
    weekStart: MONDAY,
    timeZone: TZ,
    today: input.today ?? THURSDAY,
  });
}

describe("staffWeek", () => {
  it("runs Monday to Sunday and marks the shop's own today and its past", () => {
    const week = build();

    expect(week.days.map((day) => day.date)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
    expect(week.days.filter((day) => day.isToday).map((day) => day.date)).toEqual([THURSDAY]);
    expect(week.days.filter((day) => day.isPast)).toHaveLength(3);
  });

  /**
   * The one that only fails on a server. Every DiveDay box runs UTC, so a
   * 9:00 PM Monday shift in Key Largo is stored at 01:00 **Tuesday** UTC: read
   * through the host it moves a column right, and a shop looking at Monday
   * sees an evening it does not work. The shift below straddles midnight UTC
   * in both directions.
   */
  it("buckets a shift by the shop's calendar day, not the host's", () => {
    const week = build({
      people: [
        person({
          shifts: [
            // Monday 9:00 PM – 11:30 PM Key Largo = Tuesday 01:00–03:30 UTC.
            {
              id: "late",
              startsAt: new Date("2026-08-25T01:00:00.000Z"),
              endsAt: new Date("2026-08-25T03:30:00.000Z"),
              note: null,
            },
          ],
        }),
      ],
    });

    const byDay = week.people[0]?.days ?? [];
    expect(byDay.find((day) => day.date === "2026-08-24")?.shifts.map((s) => s.id)).toEqual([
      "late",
    ]);
    expect(byDay.find((day) => day.date === "2026-08-25")?.shifts).toEqual([]);
  });

  it("keeps a departure a person crews even when they have no shift that day", () => {
    const week = build({
      people: [
        person({
          crewingTrips: [
            {
              tripId: "trip-1",
              title: "Dawn Two-Tank",
              meetings: [
                {
                  startsAt: new Date("2026-08-27T11:00:00.000Z"),
                  endsAt: new Date("2026-08-27T15:00:00.000Z"),
                },
              ],
            },
          ],
        }),
      ],
    });

    const thursday = week.people[0]?.days.find((day) => day.date === THURSDAY);
    expect(thursday?.shifts).toEqual([]);
    expect(thursday?.crewing.map((trip) => trip.tripId)).toEqual(["trip-1"]);
    expect(week.hasEntries).toBe(true);
  });

  it("puts a crew gap in the day its departure sails, carrying its own code", () => {
    const week = build({
      gaps: [
        {
          tripId: "trip-gap",
          title: "Spiegel Grove",
          gap: "uncrewed_departure",
          // 1:00 PM Thursday, Key Largo.
          meetings: [
            {
              startsAt: new Date("2026-08-27T17:00:00.000Z"),
              endsAt: new Date("2026-08-27T21:00:00.000Z"),
            },
          ],
        },
      ],
    });

    expect(week.hasGaps).toBe(true);
    // Seven cells, aligned with the columns, so the gap row draws like any
    // other row of the grid.
    expect(week.gapDays.map((day) => day.date)).toEqual(week.days.map((day) => day.date));
    const thursday = week.gapDays.find((day) => day.date === THURSDAY);
    expect(thursday?.gaps).toEqual([
      expect.objectContaining({ tripId: "trip-gap", gap: "uncrewed_departure" }),
    ]);
    expect(week.gapDays.filter((day) => day.gaps.length > 0)).toHaveLength(1);
  });

  it("drops a shift outside the week rather than clamping it to an edge", () => {
    const week = build({
      people: [
        person({
          shifts: [
            {
              id: "sunday-before",
              startsAt: new Date("2026-08-23T12:00:00.000Z"),
              endsAt: new Date("2026-08-23T18:00:00.000Z"),
              note: null,
            },
          ],
        }),
      ],
      gaps: [
        {
          tripId: "next-week",
          title: "Next Monday's charter",
          gap: "no_instructor",
          meetings: [
            {
              startsAt: new Date("2026-08-31T12:00:00.000Z"),
              endsAt: new Date("2026-08-31T16:00:00.000Z"),
            },
          ],
        },
      ],
    });

    expect(week.people[0]?.days.every((day) => day.shifts.length === 0)).toBe(true);
    // The person keeps their row — an empty week is the fact a manager opens
    // this page to see — but nothing was placed in it.
    expect(week.people).toHaveLength(1);
    expect(week.hasEntries).toBe(false);
    expect(week.hasGaps).toBe(false);
  });

  /**
   * The failure this replaced looked like nothing at all: a Thursday-to-
   * Saturday course was filed by `trips.starts_at`, so the instructor teaching
   * it read *free* on Friday and Saturday and a manager building the week's
   * shifts double-booked them onto a boat. Each cell also carries that day's
   * own hours, because `formatTimeRange` over the run's bounds prints
   * "8:00 AM – 5:00 PM" for a three-day commitment — a clock-time range across
   * three dates is a plain falsehood, not a rounding.
   */
  it("occupies every day a multi-day course meets, each with that day's hours", () => {
    const week = build({
      people: [
        person({
          crewingTrips: [
            {
              tripId: "ow",
              title: "Open Water Diver — three-day course",
              meetings: [
                // 8:00 AM – 2:00 PM Thursday, Friday and Saturday, Key Largo.
                {
                  startsAt: new Date("2026-08-27T12:00:00.000Z"),
                  endsAt: new Date("2026-08-27T18:00:00.000Z"),
                },
                {
                  startsAt: new Date("2026-08-28T12:00:00.000Z"),
                  endsAt: new Date("2026-08-28T20:00:00.000Z"),
                },
                {
                  startsAt: new Date("2026-08-29T13:00:00.000Z"),
                  endsAt: new Date("2026-08-29T21:00:00.000Z"),
                },
              ],
            },
          ],
        }),
      ],
    });

    const busy = (week.people[0]?.days ?? []).filter((day) => day.crewing.length > 0);
    expect(busy.map((day) => day.date)).toEqual(["2026-08-27", "2026-08-28", "2026-08-29"]);
    // Saturday's cell says Saturday's hours, not the run's opening morning.
    expect(busy.at(-1)?.crewing[0]?.startsAt).toEqual(new Date("2026-08-29T13:00:00.000Z"));
    expect(busy.at(-1)?.crewing[0]?.endsAt).toEqual(new Date("2026-08-29T21:00:00.000Z"));
  });

  /**
   * The other half of the same bug, and the worse one: a session that began
   * *before* this Monday is fetched by the reader (which queries overlapping
   * trips), counted in `crewGaps.needCrew`, and then rendered in no column at
   * all — including its gap, on the very week it is running.
   */
  it("shows a course that began before this week in the days it still meets", () => {
    const meetings = [
      // Last Sunday, then Monday and Tuesday of the week on screen.
      {
        startsAt: new Date("2026-08-23T12:00:00.000Z"),
        endsAt: new Date("2026-08-23T18:00:00.000Z"),
      },
      {
        startsAt: new Date("2026-08-24T12:00:00.000Z"),
        endsAt: new Date("2026-08-24T18:00:00.000Z"),
      },
      {
        startsAt: new Date("2026-08-25T12:00:00.000Z"),
        endsAt: new Date("2026-08-25T18:00:00.000Z"),
      },
    ];
    const week = build({
      people: [person({ crewingTrips: [{ tripId: "night", title: "Night Diver", meetings }] })],
      gaps: [{ tripId: "night", title: "Night Diver", gap: "no_instructor", meetings }],
    });

    expect(
      (week.people[0]?.days ?? []).filter((day) => day.crewing.length > 0).map((day) => day.date),
    ).toEqual(["2026-08-24", "2026-08-25"]);
    // The gap draws **once**, on the first day of the run this week can see —
    // `trip_assignments` is per trip, so one Assign fixes the whole run and
    // three identical warnings would be the same fact said three times.
    expect(week.gapDays.filter((day) => day.gaps.length > 0).map((day) => day.date)).toEqual([
      "2026-08-24",
    ]);
  });

  /**
   * A departure whose window crosses midnight belongs to both days — the crew
   * really are out on both — but one that *ends* at midnight does not leak
   * into the day it hands over to.
   */
  it("counts a night dive back after midnight on both days, and a window ending at midnight on one", () => {
    const week = build({
      people: [
        person({
          crewingTrips: [
            {
              tripId: "night",
              // 8:00 PM Thursday to 12:30 AM Friday, Key Largo.
              title: "Night Dive",
              meetings: [
                {
                  startsAt: new Date("2026-08-28T00:00:00.000Z"),
                  endsAt: new Date("2026-08-28T04:30:00.000Z"),
                },
              ],
            },
            {
              tripId: "evening",
              // 6:00 PM to exactly midnight, Saturday.
              title: "Evening Two-Tank",
              meetings: [
                {
                  startsAt: new Date("2026-08-29T22:00:00.000Z"),
                  endsAt: new Date("2026-08-30T04:00:00.000Z"),
                },
              ],
            },
          ],
        }),
      ],
    });

    const days = week.people[0]?.days ?? [];
    const on = (date: string) =>
      days.find((day) => day.date === date)?.crewing.map((trip) => trip.tripId) ?? [];
    expect(on("2026-08-27")).toEqual(["night"]);
    expect(on("2026-08-28")).toEqual(["night"]);
    expect(on("2026-08-29")).toEqual(["evening"]);
    expect(on("2026-08-30")).toEqual([]);
  });

  it("orders a day's shifts and gaps by when they start", () => {
    const week = build({
      people: [
        person({
          shifts: [
            {
              id: "afternoon",
              startsAt: new Date("2026-08-27T17:00:00.000Z"),
              endsAt: new Date("2026-08-27T21:00:00.000Z"),
              note: null,
            },
            {
              id: "morning",
              startsAt: new Date("2026-08-27T10:30:00.000Z"),
              endsAt: new Date("2026-08-27T16:00:00.000Z"),
              note: null,
            },
          ],
        }),
      ],
    });

    expect(
      week.people[0]?.days.find((day) => day.date === THURSDAY)?.shifts.map((s) => s.id),
    ).toEqual(["morning", "afternoon"]);
  });
});

/**
 * The crew's own half of the week (issue #1235, ADR
 * 20260902-crew-requests-and-blackouts). The assembly's job is to place two new
 * facts and to answer one question — may this reader ask for that departure —
 * with the same rule the write uses.
 */
describe("blackouts and requests", () => {
  const KEIKO = person();
  const GAP: WeekGap = {
    tripId: "trip-gap",
    title: "Spiegel Grove",
    gap: "uncrewed_departure",
    // 1:00 PM Thursday, Key Largo.
    meetings: [
      {
        startsAt: new Date("2026-08-27T17:00:00.000Z"),
        endsAt: new Date("2026-08-27T21:00:00.000Z"),
      },
    ],
  };
  const AWAY = {
    id: "block-1",
    personId: "person-1",
    startsOn: "2026-08-27",
    endsOn: "2026-08-28",
    note: "Family",
  };
  const BEFORE = new Date("2026-08-20T00:00:00.000Z");

  it("draws a person's own days away in their own row, and nobody else's", () => {
    const week = staffWeek({
      people: [KEIKO, { ...KEIKO, personId: "person-2", name: "Sal Moretti", shifts: [] }],
      gaps: [],
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      blocks: [AWAY],
      now: BEFORE,
    });
    const keiko = week.people.find((person) => person.personId === "person-1");
    const sal = week.people.find((person) => person.personId === "person-2");
    expect(keiko?.days.filter((day) => day.away.length > 0).map((day) => day.date)).toEqual([
      "2026-08-27",
      "2026-08-28",
    ]);
    expect(sal?.days.every((day) => day.away.length === 0)).toBe(true);
  });

  it("warns on a departure the person crews across days they said they were away", () => {
    const crewing = {
      ...KEIKO,
      crewingTrips: [
        {
          tripId: "trip-1",
          title: "Spiegel Grove",
          meetings: [
            {
              startsAt: new Date("2026-08-28T17:00:00.000Z"),
              endsAt: new Date("2026-08-28T21:00:00.000Z"),
            },
          ],
        },
      ],
    };
    const week = staffWeek({
      people: [crewing],
      gaps: [],
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      blocks: [AWAY],
      now: BEFORE,
    });
    const friday = week.people[0]?.days.find((day) => day.date === "2026-08-28");
    expect(friday?.crewing[0]?.awayBlocks.map((block) => block.id)).toEqual(["block-1"]);
  });

  it("leaves a departure they crew outside the range unwarned", () => {
    const crewing = {
      ...KEIKO,
      crewingTrips: [
        {
          tripId: "trip-1",
          title: "Molasses Reef",
          meetings: [
            {
              startsAt: new Date("2026-08-25T12:00:00.000Z"),
              endsAt: new Date("2026-08-25T17:00:00.000Z"),
            },
          ],
        },
      ],
    };
    const week = staffWeek({
      people: [crewing],
      gaps: [],
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      blocks: [AWAY],
      now: BEFORE,
    });
    const tuesday = week.people[0]?.days.find((day) => day.date === "2026-08-25");
    expect(tuesday?.crewing[0]?.awayBlocks).toEqual([]);
  });

  it("offers the ask only when the write would take it", () => {
    const ask = (extra: Parameters<typeof staffWeek>[0]) =>
      staffWeek(extra).gapDays.flatMap((day) => day.gaps)[0]?.viewerMayRequest;
    const base = {
      people: [KEIKO],
      gaps: [GAP],
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      now: BEFORE,
    } as const;

    expect(ask({ ...base, viewer: { personId: "person-1", isCrew: true } })).toBe(true);
    // Nobody reading: the affordance is not offered to a page that has no
    // viewer to speak of (every caller written before this slice).
    expect(ask({ ...base })).toBe(false);
    // The blackout the write refuses on — GAP meets on the 27th.
    expect(
      ask({
        ...base,
        viewer: { personId: "person-1", isCrew: true },
        blocks: [{ ...AWAY, startsOn: "2026-08-27", endsOn: "2026-08-27" }],
      }),
    ).toBe(false);
    // And an ask already on file.
    expect(
      ask({
        ...base,
        viewer: { personId: "person-1", isCrew: true },
        requests: [
          {
            id: "r1",
            tripId: GAP.tripId,
            personId: "person-1",
            personName: "Keiko Tanaka",
            state: "pending",
            requestedAt: BEFORE,
          },
        ],
      }),
    ).toBe(false);
  });

  it("hangs a request on the departure it is for, and on no other", () => {
    const week = staffWeek({
      people: [KEIKO],
      gaps: [GAP],
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      now: BEFORE,
      requests: [
        {
          id: "r1",
          tripId: GAP.tripId,
          personId: "person-2",
          personName: "Sal Moretti",
          state: "pending",
          requestedAt: BEFORE,
        },
        {
          id: "r2",
          tripId: "some-other-trip",
          personId: "person-2",
          personName: "Sal Moretti",
          state: "pending",
          requestedAt: BEFORE,
        },
      ],
    });
    const gap = week.gapDays.flatMap((day) => day.gaps)[0];
    expect(gap?.requests.map((request) => request.id)).toEqual(["r1"]);
  });

  it("counts a week with nothing but somebody's days away as having entries", () => {
    // The empty line is the page saying "nothing at all"; a recorded holiday is
    // something, and the week must not claim otherwise.
    const week = staffWeek({
      people: [{ ...KEIKO, shifts: [] }],
      gaps: [],
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      blocks: [AWAY],
      now: BEFORE,
    });
    expect(week.hasEntries).toBe(true);
  });
});
