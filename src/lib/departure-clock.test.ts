import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "./clock";
import {
  DEPARTURE_BUFFER_MS,
  DEPARTURE_RUNGS,
  departurePhase,
  hasPassed,
  hasReached,
  pushIsLive,
  rungTime,
} from "./departure-clock";

const startsAt = new Date("2026-08-05T08:00:00.000Z");
const endsAt = new Date("2026-08-05T12:00:00.000Z");
const trip = { startsAt, endsAt };
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe("the departure's ladder", () => {
  it("keeps the standing hour of grace the sailed and returned rungs sit on", () => {
    expect(DEPARTURE_BUFFER_MS).toBe(HOUR_MS);
    expect(rungTime("sailed", { startsAt }).getTime()).toBe(startsAt.getTime() + HOUR_MS);
    expect(rungTime("returned", { endsAt }).getTime()).toBe(endsAt.getTime() + HOUR_MS);
  });

  it("orders its rungs in time for an ordinary day boat, so a phase is the last rung reached", () => {
    const times = DEPARTURE_RUNGS.map((rung) =>
      rungTime(rung, trip as { startsAt: Date; endsAt: Date }).getTime(),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it("reaches a rung at its instant and not a millisecond before; passes it a millisecond after", () => {
    const sailed = rungTime("sailed", { startsAt });
    expect(hasReached("sailed", { startsAt }, at(sailed, -1))).toBe(false);
    expect(hasReached("sailed", { startsAt }, sailed)).toBe(true);
    expect(hasPassed("sailed", { startsAt }, sailed)).toBe(false);
    expect(hasPassed("sailed", { startsAt }, at(sailed, 1))).toBe(true);
  });
});

describe("departurePhase", () => {
  const phaseAt = (now: Date) => departurePhase(trip, now);

  it("walks a day boat from a week out to long past", () => {
    expect(phaseAt(at(startsAt, -7 * DAY_MS))).toBe("week_out");
    expect(phaseAt(at(startsAt, -DAY_MS))).toBe("day_before");
    expect(phaseAt(at(startsAt, -6 * HOUR_MS))).toBe("morning_of");
    expect(phaseAt(startsAt)).toBe("boarding");
    expect(phaseAt(at(startsAt, HOUR_MS - 1))).toBe("boarding");
    expect(phaseAt(at(startsAt, HOUR_MS))).toBe("sailed");
    expect(phaseAt(at(endsAt, HOUR_MS - 1))).toBe("sailed");
    expect(phaseAt(at(endsAt, HOUR_MS))).toBe("returned");
    expect(phaseAt(at(endsAt, 4 * HOUR_MS))).toBe("settled");
    expect(phaseAt(at(endsAt, 12 * HOUR_MS))).toBe("settled");
    expect(phaseAt(at(endsAt, 12 * HOUR_MS + 1))).toBe("past");
  });

  it("never reads a departure as sailed before its hour of grace, however late it runs", () => {
    expect(phaseAt(at(startsAt, 59 * 60_000))).not.toBe("sailed");
  });

  it("holds a multi-day course on the water for its whole run, not 24 hours of it", () => {
    const weekend = { startsAt, endsAt: new Date("2026-08-06T16:00:00.000Z") };
    expect(departurePhase(weekend, new Date("2026-08-06T09:00:00.000Z"))).toBe("sailed");
  });
});

describe("pushIsLive, a named question on the ladder", () => {
  it("is live from the morning-of rung to the past rung, both ends inclusive of the last instant", () => {
    expect(pushIsLive(trip, at(startsAt, -6 * HOUR_MS - 1))).toBe(false);
    expect(pushIsLive(trip, at(startsAt, -6 * HOUR_MS))).toBe(true);
    expect(pushIsLive(trip, at(endsAt, 12 * HOUR_MS))).toBe(true);
    expect(pushIsLive(trip, at(endsAt, 12 * HOUR_MS + 1))).toBe(false);
  });

  it("never closes before the departure on a row that ends before it starts", () => {
    const backwards = { startsAt, endsAt: new Date("2026-08-05T06:00:00.000Z") };
    expect(pushIsLive(backwards, startsAt)).toBe(true);
    expect(pushIsLive(backwards, at(startsAt, 12 * HOUR_MS))).toBe(true);
    expect(pushIsLive(backwards, at(startsAt, 12 * HOUR_MS + 1))).toBe(false);
  });
});
