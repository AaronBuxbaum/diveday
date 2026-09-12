import { describe, expect, it } from "vitest";
import type { CrewAssignmentRequest } from "./crew-requests";
import {
  GAP_TONE,
  type StaffGapCode,
  staffGapForCourseGap,
  staffWeek,
  type WeekGap,
  type WeekPerson,
} from "./staffing-week";

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
  /** One ask on `GAP`. A divemaster by default — the #1339 case. */
  const askOn = (overrides: Partial<CrewAssignmentRequest> = {}): CrewAssignmentRequest => ({
    id: "r1",
    tripId: GAP.tripId,
    personId: "person-1",
    personName: "Keiko Tanaka",
    inWaterRole: "certified_assistant",
    state: "pending",
    requestedAt: BEFORE,
    ...overrides,
  });

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

    expect(
      ask({ ...base, viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: true } }),
    ).toBe(true);
    // Nobody reading: the affordance is not offered to a page that has no
    // viewer to speak of (every caller written before this slice).
    expect(ask({ ...base })).toBe(false);
    // The blackout the write refuses on — GAP meets on the 27th.
    expect(
      ask({
        ...base,
        viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: true },
        blocks: [{ ...AWAY, startsOn: "2026-08-27", endsOn: "2026-08-27" }],
      }),
    ).toBe(false);
    // And an ask already on file.
    expect(
      ask({
        ...base,
        viewer: { personId: "person-1", isCrew: true, holdsInstructorRole: true },
        requests: [askOn()],
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
        askOn({ personId: "person-2", personName: "Sal Moretti" }),
        askOn({
          id: "r2",
          tripId: "some-other-trip",
          personId: "person-2",
          personName: "Sal Moretti",
        }),
      ],
    });
    const gap = week.gapDays.flatMap((day) => day.gaps)[0];
    expect(gap?.requests.map((request) => request.id)).toEqual(["r1"]);
  });

  /**
   * Issue #1339. A divemaster could press "Ask for this one" on an intro/DSD
   * session that was over its ratio, and nothing on the roster said that their
   * being aboard raises an instructor-to-student cap by zero seats. The fix is
   * a word beside the ask, never a refusal of it: the owner chose warn, and a
   * second pair of hands in the water on a DSD session is a legitimate offer.
   */
  it("warns the reader whose ask cannot close an intro-ratio gap, and still offers it", () => {
    const intro: WeekGap = { ...GAP, gap: "over_intro_ratio" };
    const place = (holdsInstructorRole: boolean, gap = intro) =>
      staffWeek({
        people: [KEIKO],
        gaps: [gap],
        weekStart: MONDAY,
        timeZone: TZ,
        today: THURSDAY,
        now: BEFORE,
        viewer: { personId: "person-1", isCrew: true, holdsInstructorRole },
      }).gapDays.flatMap((day) => day.gaps)[0];

    const divemaster = place(false);
    expect(divemaster?.viewerAskWontClose).toBe(true);
    // The failure that matters: the warning must not have quietly become a
    // gate. The ask is offered on exactly the same terms as before.
    expect(divemaster?.viewerMayRequest).toBe(true);

    // Somebody who can close it is told nothing — the line is about them.
    expect(place(true)?.viewerAskWontClose).toBe(false);

    // And the entry-level cap, which a certified assistant does raise, keeps
    // its own word and earns no warning.
    expect(place(false, { ...GAP, gap: "over_ratio" })?.viewerAskWontClose).toBe(false);
  });

  /**
   * The half of #1339 that the first fix moved rather than closed: the line was
   * computed alongside `viewerMayRequest`, so it lived exactly as long as the
   * button did. A blackout taking it away is right — the ask is not theirs to
   * make, so there is no belief to correct. Having *asked* taking it away is
   * not: "I asked, so that shift is answered" is precisely the belief the line
   * exists against, and a divemaster already rostered on the over-ratio intro
   * session, the most operationally live case there is, never saw it at all.
   */
  it("keeps the fact on the departure after the ask, and for somebody already aboard", () => {
    const gaps = [{ ...GAP, gap: "over_intro_ratio" } as WeekGap];
    const base = {
      people: [KEIKO],
      gaps,
      weekStart: MONDAY,
      timeZone: TZ,
      today: THURSDAY,
      now: BEFORE,
    } as const;
    const divemaster = { personId: "person-1", isCrew: true, holdsInstructorRole: false } as const;
    const place = (extra: Partial<Parameters<typeof staffWeek>[0]>) =>
      staffWeek({ ...base, ...extra }).gapDays.flatMap((day) => day.gaps)[0];

    // No viewer at all: nobody to be wrong about it.
    expect(place({})?.viewerAskWontClose).toBe(false);

    // A blackout the write would refuse on: still hidden, and this is the
    // refusal that *should* hide it.
    const blocked = place({
      viewer: divemaster,
      blocks: [{ ...AWAY, startsOn: "2026-08-27", endsOn: "2026-08-27" }],
    });
    expect(blocked?.viewerMayRequest).toBe(false);
    expect(blocked?.viewerAskWontClose).toBe(false);

    // Having asked: the button is gone, the fact is not.
    const asked = place({ viewer: divemaster, requests: [askOn()] });
    expect(asked?.viewerMayRequest).toBe(false);
    expect(asked?.viewerAskWontClose).toBe(true);

    // Already on the crew of the session that is over ratio.
    const aboard = place({
      viewer: divemaster,
      people: [
        {
          ...KEIKO,
          crewingTrips: [{ tripId: GAP.tripId, title: GAP.title, meetings: GAP.meetings }],
        },
      ],
    });
    expect(aboard?.viewerMayRequest).toBe(false);
    expect(aboard?.viewerAskWontClose).toBe(true);

    // And an instructor in either of those two states is told nothing: the
    // line is about the reader who cannot close it.
    expect(
      place({
        viewer: { ...divemaster, holdsInstructorRole: true },
        requests: [askOn()],
      })?.viewerAskWontClose,
    ).toBe(false);
  });

  /**
   * The other half of #1339: the person who can actually close the gap. The
   * owner or manager working the queue saw "{person} asked" and two buttons,
   * approved, and read "Approved, and they're on the crew" about a session
   * still over ratio. `inWaterRole` rides on the request so the same sentence
   * can sit beside Approve.
   */
  it("says beside a pending ask whether approving it would close the gap", () => {
    const place = (gap: StaffGapCode, request: CrewAssignmentRequest) =>
      staffWeek({
        people: [KEIKO],
        gaps: [{ ...GAP, gap }],
        weekStart: MONDAY,
        timeZone: TZ,
        today: THURSDAY,
        now: BEFORE,
        requests: [request],
      }).gapDays.flatMap((day) => day.gaps)[0]?.requests[0]?.askWontClose;

    expect(place("over_intro_ratio", askOn())).toBe(true);
    // Somebody who does close it.
    expect(place("over_intro_ratio", askOn({ inWaterRole: "instructor" }))).toBe(false);
    // The entry-level cap, which a certified assistant does raise.
    expect(place("over_ratio", askOn())).toBe(false);
    // An answered request is history; the gap chip above it already says the
    // session is still short.
    expect(place("over_intro_ratio", askOn({ state: "approved" }))).toBe(false);
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

/**
 * The one place a course gap's ratio kind becomes a chip code (issue #1339).
 * `courseCrewGap` has always carried it; the staffing week threw it away.
 */
describe("staffGapForCourseGap", () => {
  it("keeps the intro cap apart from the entry-level one", () => {
    expect(
      staffGapForCourseGap({ code: "over_ratio", booked: 3, capacity: 2, ratio: "intro" }),
    ).toBe("over_intro_ratio");
    expect(
      staffGapForCourseGap({ code: "over_ratio", booked: 9, capacity: 8, ratio: "entry_level" }),
    ).toBe("over_ratio");
  });

  it("passes the instructor gap through and says nothing about an adequate session", () => {
    expect(staffGapForCourseGap({ code: "no_instructor" })).toBe("no_instructor");
    expect(staffGapForCourseGap({ code: "none" })).toBeNull();
  });

  it("draws the intro cap in the same warning ink as the ratio it splits from", () => {
    // A quieter tone would say the tighter of the two rules matters less.
    expect(GAP_TONE.over_intro_ratio).toBe("warning");
    expect(GAP_TONE.over_intro_ratio).toBe(GAP_TONE.over_ratio);
  });
});

/**
 * **A standing crew clash** (issue #1695): one person rostered on two
 * departures whose hours overlap. `setTripCrew` refuses to write that, so the
 * only door into it is `moveTrip` — and the week showed the person on both
 * boats as if it were a shift pattern.
 *
 * The rule is the **window**, never the day, and it is the same half-open
 * predicate the roster refuses on (`src/db/trips-crew.ts`): a morning boat plus
 * an afternoon boat is an ordinary double shift, and a warning that is
 * routinely wrong is one a crew learns to click past (#757, #1203).
 */
describe("a standing crew clash", () => {
  /** Thursday, Key Largo: 9:00 AM – 1:00 PM. */
  const DRIFT = {
    tripId: "trip-drift",
    title: "Reef drift",
    meetings: [
      {
        startsAt: new Date("2026-08-27T13:00:00.000Z"),
        endsAt: new Date("2026-08-27T17:00:00.000Z"),
      },
    ],
  };

  function clashesOn(date: string, crewingTrips: WeekPerson["crewingTrips"], tripId: string) {
    const week = build({ people: [person({ crewingTrips })] });
    const day = week.people[0]?.days.find((entry) => entry.date === date);
    return day?.crewing.find((trip) => trip.tripId === tripId)?.clashes ?? null;
  }

  it("names the other departure, on both chips", () => {
    const wreck = {
      tripId: "trip-wreck",
      title: "Spiegel Grove",
      // 10:00 AM – 2:00 PM, straight over the drift's second hour.
      meetings: [
        {
          startsAt: new Date("2026-08-27T14:00:00.000Z"),
          endsAt: new Date("2026-08-27T18:00:00.000Z"),
        },
      ],
    };
    expect(clashesOn("2026-08-27", [DRIFT, wreck], "trip-drift")).toEqual([
      { tripId: "trip-wreck", title: "Spiegel Grove" },
    ]);
    expect(clashesOn("2026-08-27", [DRIFT, wreck], "trip-wreck")).toEqual([
      { tripId: "trip-drift", title: "Reef drift" },
    ]);
  });

  it("leaves the ordinary double shift alone, and a hand-off at the dock too", () => {
    const afternoon = {
      tripId: "trip-afternoon",
      title: "Afternoon single",
      // 3:00 PM – 6:00 PM: two hours after the drift ties up.
      meetings: [
        {
          startsAt: new Date("2026-08-27T19:00:00.000Z"),
          endsAt: new Date("2026-08-27T22:00:00.000Z"),
        },
      ],
    };
    expect(clashesOn("2026-08-27", [DRIFT, afternoon], "trip-drift")).toEqual([]);

    // And the exact hand-off: the next boat sails the instant this one is back.
    const backToBack = {
      tripId: "trip-back-to-back",
      title: "The 1:00 PM",
      meetings: [
        {
          startsAt: new Date("2026-08-27T17:00:00.000Z"),
          endsAt: new Date("2026-08-27T21:00:00.000Z"),
        },
      ],
    };
    expect(clashesOn("2026-08-27", [DRIFT, backToBack], "trip-drift")).toEqual([]);
  });

  /**
   * **Per meeting, not per run.** A course clashing on its Tuesday leg is not
   * clashing on its Monday, and a chip that claimed otherwise would be warning
   * about a morning the instructor is genuinely free.
   */
  it("marks only the leg of a multi-day course that the overlap falls on", () => {
    const course = {
      tripId: "trip-course",
      title: "Rescue, Mon to Wed",
      meetings: [
        {
          startsAt: new Date("2026-08-24T13:00:00.000Z"),
          endsAt: new Date("2026-08-24T17:00:00.000Z"),
        },
        {
          startsAt: new Date("2026-08-25T13:00:00.000Z"),
          endsAt: new Date("2026-08-25T17:00:00.000Z"),
        },
        {
          startsAt: new Date("2026-08-26T13:00:00.000Z"),
          endsAt: new Date("2026-08-26T17:00:00.000Z"),
        },
      ],
    };
    const tuesdayBoat = {
      tripId: "trip-tuesday",
      title: "Tuesday's charter",
      meetings: [
        {
          startsAt: new Date("2026-08-25T14:00:00.000Z"),
          endsAt: new Date("2026-08-25T18:00:00.000Z"),
        },
      ],
    };
    expect(clashesOn("2026-08-24", [course, tuesdayBoat], "trip-course")).toEqual([]);
    expect(clashesOn("2026-08-25", [course, tuesdayBoat], "trip-course")).toEqual([
      { tripId: "trip-tuesday", title: "Tuesday's charter" },
    ]);
    expect(clashesOn("2026-08-26", [course, tuesdayBoat], "trip-course")).toEqual([]);
  });

  it("never counts a departure against itself, however many legs it has", () => {
    expect(clashesOn("2026-08-27", [DRIFT], "trip-drift")).toEqual([]);
  });
});
