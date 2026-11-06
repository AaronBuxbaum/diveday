import { describe, expect, it } from "vitest";
import { HOUR_MS } from "./clock";
import {
  arrivalsWindow,
  DEPARTURE_BUFFER_MS,
  DEPARTURE_PHASES,
  type DeparturePhase,
  departurePhase,
  hasCrossed,
  onArrivalsDesk,
  pushIsLive,
  recapIsDue,
  rungOffsetMs,
  rungTime,
  stageIsStale,
} from "./departure-clock";

// UTC instants: an offset in hours from a stored instant reads the same in every zone.
const startsAt = new Date("2026-08-05T08:00:00.000Z");
const endsAt = new Date("2026-08-05T12:00:00.000Z");
const trip = { startsAt, endsAt };
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe("the departure's ladder", () => {
  it("keeps the standing hour of grace the sailing and back rungs sit on", () => {
    expect(DEPARTURE_BUFFER_MS).toBe(HOUR_MS);
    expect(rungTime("sailing_grace_over", { startsAt }).getTime()).toBe(
      startsAt.getTime() + HOUR_MS,
    );
    expect(rungTime("back_grace_over", { endsAt }).getTime()).toBe(endsAt.getTime() + HOUR_MS);
  });

  it("spells every offset once, from the anchor it is measured from", () => {
    expect(rungOffsetMs("week_out")).toBe(-168 * HOUR_MS);
    expect(rungOffsetMs("desk_opens")).toBe(-36 * HOUR_MS);
    expect(rungOffsetMs("day_before")).toBe(-24 * HOUR_MS);
    expect(rungOffsetMs("push_opens")).toBe(-6 * HOUR_MS);
    expect(rungOffsetMs("scheduled_start")).toBe(0);
    expect(rungOffsetMs("desk_closes")).toBe(6 * HOUR_MS);
    expect(rungOffsetMs("stage_stale")).toBe(2 * HOUR_MS);
    expect(rungOffsetMs("recap_due")).toBe(4 * HOUR_MS);
    expect(rungTime("recap_due", { endsAt }).getTime()).toBe(endsAt.getTime() + 4 * HOUR_MS);
    expect(rungTime("push_closes", { endsAt }).getTime()).toBe(endsAt.getTime() + 12 * HOUR_MS);
  });

  it("crosses an `at` rung on its instant and an `after` rung only a millisecond past it", () => {
    const sailing = rungTime("sailing_grace_over", { startsAt });
    expect(hasCrossed("sailing_grace_over", { startsAt }, at(sailing, -1))).toBe(false);
    expect(hasCrossed("sailing_grace_over", { startsAt }, sailing)).toBe(true);
    const recap = rungTime("recap_due", { endsAt });
    expect(hasCrossed("recap_due", { endsAt }, recap)).toBe(false);
    expect(hasCrossed("recap_due", { endsAt }, at(recap, 1))).toBe(true);
  });
});

/**
 * Each rung's instant and crossing, pinned by name: changing one is a reviewed
 * diff here too. `at` crosses on its instant, `after` a millisecond later.
 */
describe("every rung", () => {
  const rungs = [
    ["week_out", "startsAt", -168 * HOUR_MS, "at"],
    ["desk_opens", "startsAt", -36 * HOUR_MS, "at"],
    ["day_before", "startsAt", -24 * HOUR_MS, "at"],
    ["push_opens", "startsAt", -6 * HOUR_MS, "at"],
    ["scheduled_start", "startsAt", 0, "at"],
    ["sailing_grace_over", "startsAt", HOUR_MS, "at"],
    ["desk_closes", "startsAt", 6 * HOUR_MS, "after"],
    ["back_grace_over", "endsAt", HOUR_MS, "at"],
    ["stage_stale", "endsAt", 2 * HOUR_MS, "after"],
    ["recap_due", "endsAt", 4 * HOUR_MS, "after"],
    ["push_closes", "endsAt", 12 * HOUR_MS, "after"],
  ] as const;

  it.each(rungs)("%s sits at %s %d ms and crosses %s", (rung, anchor, offset, crossing) => {
    const base = anchor === "startsAt" ? startsAt : endsAt;
    const anchors = { startsAt, endsAt };
    expect(rungTime(rung, anchors).getTime()).toBe(base.getTime() + offset);
    const instant = at(base, offset);
    expect(hasCrossed(rung, anchors, at(instant, -1))).toBe(false);
    expect(hasCrossed(rung, anchors, instant)).toBe(crossing === "at");
    expect(hasCrossed(rung, anchors, at(instant, 1))).toBe(true);
  });

  it("is the whole ladder", () => {
    expect(rungs).toHaveLength(11);
  });
});

describe("departurePhase", () => {
  const cases: [number, Date, DeparturePhase][] = [
    [-168 * HOUR_MS - 1, startsAt, "ahead"],
    [-168 * HOUR_MS, startsAt, "week_out"],
    [-24 * HOUR_MS - 1, startsAt, "week_out"],
    [-24 * HOUR_MS, startsAt, "day_before"],
    [-6 * HOUR_MS, startsAt, "morning_of"],
    [-1, startsAt, "morning_of"],
    [0, startsAt, "due_out"],
    [HOUR_MS - 1, startsAt, "due_out"],
    [HOUR_MS, startsAt, "scheduled_out"],
    [HOUR_MS - 1, endsAt, "scheduled_out"],
    [HOUR_MS, endsAt, "scheduled_back"],
    [4 * HOUR_MS, endsAt, "scheduled_back"],
    [4 * HOUR_MS + 1, endsAt, "recap_due"],
    [12 * HOUR_MS, endsAt, "recap_due"],
    [12 * HOUR_MS + 1, endsAt, "past"],
  ];
  it.each(cases)("at %d ms from %s reads %s", (offset, base, phase) => {
    expect(departurePhase(trip, at(base, offset))).toBe(phase);
  });

  it("only moves forward as the clock does, on a short trip and a long one", () => {
    const course = { startsAt, endsAt: new Date("2026-08-07T16:00:00.000Z") };
    for (const departure of [trip, course]) {
      let previous = -1;
      for (let hour = -200; hour <= 80; hour += 1) {
        const phase = DEPARTURE_PHASES.indexOf(
          departurePhase(departure, at(startsAt, hour * HOUR_MS)),
        );
        expect(phase).toBeGreaterThanOrEqual(previous);
        previous = phase;
      }
      expect(previous).toBe(DEPARTURE_PHASES.indexOf("past"));
    }
  });

  it("reads a row that ends before it starts as ending when it starts", () => {
    const backwards = { startsAt, endsAt: new Date("2026-08-05T06:00:00.000Z") };
    expect(departurePhase(backwards, startsAt)).toBe("due_out");
    expect(departurePhase(backwards, at(startsAt, HOUR_MS))).toBe("scheduled_back");
  });
});

describe("pushIsLive", () => {
  it("is open at departure", () => {
    expect(pushIsLive(trip, startsAt)).toBe(true);
  });

  it("is live from push_opens to push_closes, the last instant included", () => {
    expect(pushIsLive(trip, at(startsAt, -6 * HOUR_MS - 1))).toBe(false);
    expect(pushIsLive(trip, at(startsAt, -6 * HOUR_MS))).toBe(true);
    expect(pushIsLive(trip, at(endsAt, 12 * HOUR_MS))).toBe(true);
    expect(pushIsLive(trip, at(endsAt, 12 * HOUR_MS + 1))).toBe(false);
  });

  it("keeps day two of a multi-day course inside the window", () => {
    // Day two sits ~24h past the start, so a start-anchored close would have
    // gone silent for the whole second day.
    const weekend = { startsAt, endsAt: new Date("2026-08-06T16:00:00.000Z") };
    expect(pushIsLive(weekend, new Date("2026-08-06T09:00:00.000Z"))).toBe(true);
  });

  it("follows a trip that moved earlier", () => {
    const moved = {
      startsAt: new Date("2026-08-05T07:00:00.000Z"),
      endsAt: new Date("2026-08-05T11:00:00.000Z"),
    };
    expect(pushIsLive(moved, new Date("2026-08-05T06:00:00.000Z"))).toBe(true);
  });

  it("is shut for next week's trip", () => {
    expect(pushIsLive(trip, new Date("2026-07-29T08:00:00.000Z"))).toBe(false);
  });

  it("never closes before the departure on a row that ends before it starts", () => {
    const backwards = { startsAt, endsAt: new Date("2026-08-05T06:00:00.000Z") };
    expect(pushIsLive(backwards, startsAt)).toBe(true);
    expect(pushIsLive(backwards, at(startsAt, 12 * HOUR_MS))).toBe(true);
    expect(pushIsLive(backwards, at(startsAt, 12 * HOUR_MS + 1))).toBe(false);
  });
});

describe("recapIsDue and stageIsStale", () => {
  it("makes the recap due strictly after four hours past the return", () => {
    expect(recapIsDue(endsAt, at(endsAt, 4 * HOUR_MS))).toBe(false);
    expect(recapIsDue(endsAt, at(endsAt, 4 * HOUR_MS + 1))).toBe(true);
  });

  it("retires the crew's word strictly after two buffers past the return, never sooner", () => {
    expect(stageIsStale(endsAt, at(endsAt, 2 * HOUR_MS))).toBe(false);
    expect(stageIsStale(endsAt, at(endsAt, 2 * HOUR_MS + 1))).toBe(true);
    expect(rungOffsetMs("stage_stale")).toBeGreaterThan(rungOffsetMs("back_grace_over"));
  });
});

describe("the arrivals desk", () => {
  const now = new Date("2026-08-03T09:00:00.000Z");

  it("turns the desk's rungs round into the bounds a query reads", () => {
    const window = arrivalsWindow(now);
    expect(window.from.getTime()).toBe(now.getTime() - 6 * HOUR_MS);
    expect(window.to.getTime()).toBe(now.getTime() + 36 * HOUR_MS);
  });

  it("agrees with the window at both inclusive edges", () => {
    const window = arrivalsWindow(now);
    expect(onArrivalsDesk(window.from, now)).toBe(true);
    expect(onArrivalsDesk(window.to, now)).toBe(true);
    expect(onArrivalsDesk(at(window.from, -1), now)).toBe(false);
    expect(onArrivalsDesk(at(window.to, 1), now)).toBe(false);
  });
});
