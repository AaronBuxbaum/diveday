import { describe, expect, it } from "vitest";
import { HOUR_MS } from "./clock";
import {
  DEPARTURE_BUFFER_MS,
  hasPassed,
  hasReached,
  pushIsLive,
  rungOffsetMs,
  rungTime,
} from "./departure-clock";

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

  it("measures the recap and push offsets from the end, and the push opening from the start", () => {
    expect(rungOffsetMs("recap_due")).toBe(4 * HOUR_MS);
    expect(rungTime("recap_due", { endsAt }).getTime()).toBe(endsAt.getTime() + 4 * HOUR_MS);
    expect(rungTime("push_opens", { startsAt }).getTime()).toBe(startsAt.getTime() - 6 * HOUR_MS);
    expect(rungTime("push_closes", { endsAt }).getTime()).toBe(endsAt.getTime() + 12 * HOUR_MS);
  });

  it("reaches a rung at its instant and not a millisecond before; passes it a millisecond after", () => {
    const rung = rungTime("sailing_grace_over", { startsAt });
    expect(hasReached("sailing_grace_over", { startsAt }, at(rung, -1))).toBe(false);
    expect(hasReached("sailing_grace_over", { startsAt }, rung)).toBe(true);
    expect(hasPassed("sailing_grace_over", { startsAt }, rung)).toBe(false);
    expect(hasPassed("sailing_grace_over", { startsAt }, at(rung, 1))).toBe(true);
  });
});

describe("pushIsLive, a named question on the ladder", () => {
  it("is live from push_opens to push_closes, the last instant included", () => {
    expect(pushIsLive(trip, at(startsAt, -6 * HOUR_MS - 1))).toBe(false);
    expect(pushIsLive(trip, at(startsAt, -6 * HOUR_MS))).toBe(true);
    expect(pushIsLive(trip, at(endsAt, 12 * HOUR_MS))).toBe(true);
    expect(pushIsLive(trip, at(endsAt, 12 * HOUR_MS + 1))).toBe(false);
  });

  it("keeps day two of a multi-day course inside the window", () => {
    const weekend = { startsAt, endsAt: new Date("2026-08-06T16:00:00.000Z") };
    expect(pushIsLive(weekend, new Date("2026-08-06T09:00:00.000Z"))).toBe(true);
  });

  it("never closes before the departure on a row that ends before it starts", () => {
    const backwards = { startsAt, endsAt: new Date("2026-08-05T06:00:00.000Z") };
    expect(pushIsLive(backwards, startsAt)).toBe(true);
    expect(pushIsLive(backwards, at(startsAt, 12 * HOUR_MS))).toBe(true);
    expect(pushIsLive(backwards, at(startsAt, 12 * HOUR_MS + 1))).toBe(false);
  });
});
