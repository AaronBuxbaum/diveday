import { describe, expect, it } from "vitest";
import { HOUR_MS } from "./clock";
import {
  DEFAULT_FLY_SAFE_HOURS,
  FLY_SAFE_LIMITS,
  flySafeFrom,
  parseFlySafeHours,
} from "./fly-safe";
import { formatWeekdayTime } from "./format";
import { DEPARTURE_BUFFER_MS } from "./trips";

const endsAt = new Date("2026-07-25T22:00:00.000Z");
/**
 * The instant the rest of the product calls the boat home, and the only
 * scheduled-return anchor this module may use: boats run late, `hasReturned`
 * is what says one is back, and it allows the departure buffer first.
 */
const scheduledHome = new Date(endsAt.getTime() + DEPARTURE_BUFFER_MS);
const home = new Date(endsAt.getTime() + 2 * HOUR_MS);
const hours = DEFAULT_FLY_SAFE_HOURS;

describe("flySafeFrom", () => {
  it("anchors on the last recorded exit and takes the single-dive hours for a one-tank day", () => {
    const exit = new Date("2026-07-25T20:10:00.000Z");
    const result = flySafeFrom({
      executedDives: [{ diveNumber: 1, exitedAt: exit }],
      plannedDives: 1,
      endsAt,
      divedRecently: false,
      now: home,
      hours,
    });
    expect(result).toEqual({
      from: new Date(exit.getTime() + 18 * HOUR_MS),
      basis: "single",
      reason: "one_dive",
      anchor: "last_dive",
      hours: 18,
    });
  });

  it("takes the repetitive hours once the day held more than one dive, from the later exit", () => {
    const first = new Date("2026-07-25T19:00:00.000Z");
    const second = new Date("2026-07-25T21:15:00.000Z");
    const result = flySafeFrom({
      executedDives: [
        { diveNumber: 2, exitedAt: second },
        { diveNumber: 1, exitedAt: first },
      ],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: home,
      hours,
    });
    expect(result).toMatchObject({ basis: "repetitive", anchor: "last_dive", hours: 24 });
    expect(result?.from).toEqual(new Date(second.getTime() + 24 * HOUR_MS));
  });

  it("reads today's single tank as repetitive for a diver who already dived here yesterday", () => {
    // The case issue #1439 is about. DAN's 18 hours covers "repetitive dives
    // *or* multiple days of diving", and this is the second half: one tank
    // today, but not this diver's first day in the water.
    const exit = new Date("2026-07-25T20:10:00.000Z");
    const result = flySafeFrom({
      executedDives: [{ diveNumber: 1, exitedAt: exit }],
      plannedDives: 1,
      endsAt,
      divedRecently: true,
      now: home,
      hours,
    });
    expect(result).toEqual({
      from: new Date(exit.getTime() + 24 * HOUR_MS),
      basis: "repetitive",
      reason: "earlier_day",
      anchor: "last_dive",
      hours: 24,
    });
  });

  it("leaves a first day of diving alone", () => {
    // The inverse of the case above, and the only one that can catch the flag
    // being read backwards — a `!divedRecently` would pass that test and fail
    // this one.
    const exit = new Date("2026-07-25T20:10:00.000Z");
    expect(
      flySafeFrom({
        executedDives: [{ diveNumber: 1, exitedAt: exit }],
        plannedDives: 1,
        endsAt,
        divedRecently: false,
        now: home,
        hours,
      }),
    ).toMatchObject({ basis: "single", hours: 18 });
  });

  it("names which of the three routes reached repetitive, recorded count first", () => {
    // The diver's sentence branches on this, so it is not a label: a day the
    // crew logged as two tanks must say so rather than be explained by
    // yesterday, which is why the recorded count is read before the flag.
    const exit = new Date("2026-07-25T20:10:00.000Z");
    const one = { diveNumber: 1, exitedAt: exit };
    const two = { diveNumber: 2, exitedAt: exit };
    const reasonOf = (
      executedDives: (typeof one)[],
      plannedDives: number,
      divedRecently: boolean,
    ) =>
      flySafeFrom({ executedDives, plannedDives, endsAt, divedRecently, now: home, hours })?.reason;
    expect(reasonOf([one], 1, false)).toBe("one_dive");
    expect(reasonOf([one, two], 2, false)).toBe("dives_recorded");
    expect(reasonOf([one], 2, false)).toBe("dives_planned");
    expect(reasonOf([one], 1, true)).toBe("earlier_day");
    // A two-tank day is explained by its own record, not by yesterday.
    expect(reasonOf([one, two], 2, true)).toBe("dives_recorded");
  });

  it("is one more route to repetitive, never a different answer", () => {
    // A two-tank day by a diver who also dived yesterday is repetitive once,
    // not twice: the flag may widen who reaches this basis and may never move
    // the hours it carries.
    const first = new Date("2026-07-25T19:00:00.000Z");
    const second = new Date("2026-07-25T21:15:00.000Z");
    const dives = [
      { diveNumber: 1, exitedAt: first },
      { diveNumber: 2, exitedAt: second },
    ];
    expect(
      flySafeFrom({
        executedDives: dives,
        plannedDives: 2,
        endsAt,
        divedRecently: true,
        now: home,
        hours,
      }),
    ).toEqual(
      flySafeFrom({
        executedDives: dives,
        plannedDives: 2,
        endsAt,
        divedRecently: false,
        now: home,
        hours,
      }),
    );
  });

  it("reads a two-dive plan as repetitive even when the crew logged only one tank", () => {
    // Asserted whole, anchor and instant included. It used to assert the basis
    // and the hours alone, which left the one thing that was wrong unpinned:
    // the day's record is short of its plan, so tank one's exit is the last
    // *recorded* one rather than the last one, and the clock started there. On
    // a two-tank morning charter that is about two and a half hours early, and
    // at the settable minimum of 18 repetitive hours it lands under DAN's
    // floor.
    const exit = new Date("2026-07-25T20:10:00.000Z");
    const result = flySafeFrom({
      executedDives: [{ diveNumber: 1, exitedAt: exit }],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: home,
      hours,
    });
    expect(result).toEqual({
      from: new Date(scheduledHome.getTime() + 24 * HOUR_MS),
      basis: "repetitive",
      reason: "dives_planned",
      anchor: "scheduled_return",
      hours: 24,
    });
    expect(result?.from.getTime()).toBeGreaterThan(exit.getTime() + 24 * HOUR_MS);
  });

  it("says nothing, rather than tank one's answer, while a short record's boat is still out", () => {
    // The same treatment the untimed later dive gets: an unlogged tank is a
    // hole in the record, and until the boat is home there is no instant on it
    // that is not before the day's real last dive ended.
    const exit = new Date("2026-07-25T20:10:00.000Z");
    expect(
      flySafeFrom({
        executedDives: [{ diveNumber: 1, exitedAt: exit }],
        plannedDives: 2,
        endsAt,
        divedRecently: false,
        now: endsAt,
        hours,
      }),
    ).toBeNull();
  });

  it("keeps the logged exit when a short record's one tank ran past the buffered return", () => {
    // The return is a floor under the anchor, never a ceiling over it: a boat
    // that came in late must not shorten the wait. The exit is two hours past
    // the scheduled return so it is past the buffered one too — at one hour it
    // would merely tie with it and prove nothing.
    const lateExit = new Date(endsAt.getTime() + 2 * HOUR_MS);
    const result = flySafeFrom({
      executedDives: [{ diveNumber: 1, exitedAt: lateExit }],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: new Date(lateExit.getTime() + 3 * HOUR_MS),
      hours,
    });
    expect(result).toEqual({
      from: new Date(lateExit.getTime() + 24 * HOUR_MS),
      basis: "repetitive",
      reason: "dives_planned",
      anchor: "scheduled_return",
      hours: 24,
    });
  });

  it("anchors on the last exit once the crew logged every tank the departure planned", () => {
    // The other side of the line: a whole record is the crew's own answer and
    // the scheduled return never overrides it, late boat or early one.
    const first = new Date("2026-07-25T19:00:00.000Z");
    const second = new Date("2026-07-25T21:15:00.000Z");
    expect(
      flySafeFrom({
        executedDives: [
          { diveNumber: 1, exitedAt: first },
          { diveNumber: 2, exitedAt: second },
        ],
        plannedDives: 2,
        endsAt,
        divedRecently: false,
        now: home,
        hours,
      }),
    ).toEqual({
      from: new Date(second.getTime() + 24 * HOUR_MS),
      basis: "repetitive",
      reason: "dives_recorded",
      anchor: "last_dive",
      hours: 24,
    });
  });

  it("falls back to the scheduled return once the boat is home, when nothing was recorded", () => {
    const result = flySafeFrom({
      executedDives: [],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: home,
      hours,
    });
    expect(result).toEqual({
      from: new Date(scheduledHome.getTime() + 24 * HOUR_MS),
      basis: "repetitive",
      reason: "dives_planned",
      anchor: "scheduled_return",
      hours: 24,
    });
  });

  it("carries the departure buffer into the scheduled-return anchor", () => {
    // The hole this pins: the branch gated on `hasReturned` — scheduled return
    // plus the buffer, because boats run late — and then anchored on the bare
    // scheduled time, computing as if the same boat tied up punctually. A day
    // due back at 22:00Z that comes in at 23:30Z read an hour early, and at the
    // settable minimum of 18 repetitive hours that is a real interval of 17,
    // under DAN's floor in a sentence that ends by citing DAN.
    const result = flySafeFrom({
      executedDives: [],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: home,
      hours,
    });
    expect(result?.from).toEqual(new Date(endsAt.getTime() + DEPARTURE_BUFFER_MS + 24 * HOUR_MS));
    expect(result?.from.getTime()).toBeGreaterThan(endsAt.getTime() + 24 * HOUR_MS);
    // And it is exactly the buffer, not an hour this module spells for itself:
    // the earliest `now` that gets an answer at all is the anchor.
    const earliestAnswer = flySafeFrom({
      executedDives: [],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: scheduledHome,
      hours,
    });
    expect(earliestAnswer?.from).toEqual(new Date(scheduledHome.getTime() + 24 * HOUR_MS));
  });

  it("says nothing while the boat is still out by the one-hour buffer", () => {
    const justPastReturn = new Date(endsAt.getTime() + 30 * 60 * 1000);
    expect(
      flySafeFrom({
        executedDives: [],
        plannedDives: 2,
        endsAt,
        divedRecently: false,
        now: justPastReturn,
        hours,
      }),
    ).toBeNull();
    expect(
      flySafeFrom({
        executedDives: [],
        plannedDives: 2,
        endsAt: null,
        divedRecently: false,
        now: home,
        hours,
      }),
    ).toBeNull();
  });

  it("never anchors on an earlier dive when a later one was recorded without its exit", () => {
    const firstExit = new Date("2026-07-25T19:00:00.000Z");
    const dives = [
      { diveNumber: 1, exitedAt: firstExit },
      { diveNumber: 2, exitedAt: null },
    ];
    // Boat home: the return is the later of the two instants, so it anchors.
    expect(
      flySafeFrom({
        executedDives: dives,
        plannedDives: 2,
        endsAt,
        divedRecently: false,
        now: home,
        hours,
      }),
    ).toEqual({
      from: new Date(scheduledHome.getTime() + 24 * HOUR_MS),
      basis: "repetitive",
      reason: "dives_recorded",
      anchor: "scheduled_return",
      hours: 24,
    });
    // Boat not yet home: no honest answer at all, rather than dive one's.
    expect(
      flySafeFrom({
        executedDives: dives,
        plannedDives: 2,
        endsAt,
        divedRecently: false,
        now: endsAt,
        hours,
      }),
    ).toBeNull();
  });

  it("keeps a recorded exit that runs past the buffered return when the record is incomplete", () => {
    const lateExit = new Date(endsAt.getTime() + 2 * HOUR_MS);
    const result = flySafeFrom({
      executedDives: [
        { diveNumber: 1, exitedAt: lateExit },
        { diveNumber: 2, exitedAt: null },
      ],
      plannedDives: 2,
      endsAt,
      divedRecently: false,
      now: new Date(lateExit.getTime() + 3 * HOUR_MS),
      hours,
    });
    expect(result?.from).toEqual(new Date(lateExit.getTime() + 24 * HOUR_MS));
  });

  it("renders in the shop's zone through the shared formatter", () => {
    const exit = new Date("2026-07-25T20:10:00.000Z");
    const result = flySafeFrom({
      executedDives: [{ diveNumber: 1, exitedAt: exit }],
      plannedDives: 1,
      endsAt,
      divedRecently: false,
      now: home,
      hours,
    });
    if (!result) throw new Error("expected a result");
    // 20:10Z + 18h = 14:10Z on the 26th, a Sunday, which is 10:10 AM in Key Largo.
    expect(formatWeekdayTime(result.from, "en-US", "America/New_York")).toBe("Sunday 10:10 AM");
    expect(formatWeekdayTime(result.from, "es-ES", "America/New_York")).toBe("domingo, 10:10");
    expect(formatWeekdayTime(result.from, "en-US", "UTC")).toBe("Sunday 2:10 PM");
  });
});

describe("parseFlySafeHours", () => {
  it("accepts whole hours inside DAN's floors and the three-day ceiling", () => {
    expect(parseFlySafeHours({ single: "18", repetitive: "24" })).toEqual({
      single: 18,
      repetitive: 24,
    });
    expect(parseFlySafeHours({ single: 12, repetitive: 18 })).toEqual({
      single: 12,
      repetitive: 18,
    });
  });

  it("refuses a value under DAN's minimum, over the ceiling, fractional, or missing", () => {
    expect(parseFlySafeHours({ single: "11", repetitive: "24" })).toBeNull();
    expect(parseFlySafeHours({ single: "18", repetitive: "17" })).toBeNull();
    expect(parseFlySafeHours({ single: "18", repetitive: "73" })).toBeNull();
    expect(parseFlySafeHours({ single: "18.5", repetitive: "24" })).toBeNull();
    expect(parseFlySafeHours({ single: "18" })).toBeNull();
    expect(parseFlySafeHours({ single: "abc", repetitive: "24" })).toBeNull();
  });

  it("refuses a repetitive wait shorter than the single one", () => {
    expect(parseFlySafeHours({ single: "30", repetitive: "24" })).toBeNull();
  });

  it("floors at DAN's published minimums so the attribution stays true", () => {
    expect(FLY_SAFE_LIMITS.single.min).toBe(12);
    expect(FLY_SAFE_LIMITS.repetitive.min).toBe(18);
  });
});
