import { describe, expect, it } from "vitest";
import { waiverClockInstant } from "./waivers";

describe("waiverClockInstant (issue #2611)", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const hour = 60 * 60 * 1000;
  const startsAt = new Date(now.getTime() + 20 * hour);

  it("is the end of a trip that has not started, however short it is", () => {
    const endsAt = new Date(startsAt.getTime() + 5 * hour);
    expect(waiverClockInstant({ now, startsAt, endsAt })).toEqual(endsAt);
    const nightDive = new Date(startsAt.getTime() + 1);
    expect(waiverClockInstant({ now, startsAt, endsAt: nightDive })).toEqual(nightDive);
  });

  it("is the end of a trip that runs a day or more", () => {
    const week = new Date(startsAt.getTime() + 7 * 24 * hour);
    expect(waiverClockInstant({ now, startsAt, endsAt: week })).toEqual(week);
  });

  it("is the start when the trip has no end after it", () => {
    expect(waiverClockInstant({ now, startsAt, endsAt: null })).toEqual(startsAt);
    expect(
      waiverClockInstant({ now, startsAt, endsAt: new Date(startsAt.getTime() - hour) }),
    ).toEqual(startsAt);
  });

  it("is now once the trip is under way, however many days it runs", () => {
    const underWay = new Date(now.getTime() - hour);
    expect(
      waiverClockInstant({
        now,
        startsAt: underWay,
        endsAt: new Date(now.getTime() + 6 * 24 * hour),
      }),
    ).toEqual(now);
    expect(
      waiverClockInstant({ now, startsAt: now, endsAt: new Date(now.getTime() + hour) }),
    ).toEqual(now);
    const past = new Date(now.getTime() - 3 * hour);
    expect(
      waiverClockInstant({ now, startsAt: past, endsAt: new Date(past.getTime() + hour) }),
    ).toEqual(now);
  });

  it("is now when the trip is unknown", () => {
    expect(waiverClockInstant({ now, startsAt: null, endsAt: null })).toEqual(now);
  });
});
