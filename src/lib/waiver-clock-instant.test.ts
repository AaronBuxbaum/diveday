import { describe, expect, it } from "vitest";
import { waiverClockInstant } from "./waivers";

describe("waiverClockInstant (issue #2611)", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const hour = 60 * 60 * 1000;
  const startsAt = new Date(now.getTime() + 20 * hour);

  it("is the start of a single-day trip", () => {
    const endsAt = new Date(startsAt.getTime() + 5 * hour);
    expect(waiverClockInstant({ now, startsAt, endsAt })).toEqual(startsAt);
  });

  it("is the end of a trip that runs a day or more", () => {
    const exactlyADay = new Date(startsAt.getTime() + 24 * hour);
    expect(waiverClockInstant({ now, startsAt, endsAt: exactlyADay })).toEqual(exactlyADay);
    const week = new Date(startsAt.getTime() + 7 * 24 * hour);
    expect(waiverClockInstant({ now, startsAt, endsAt: week })).toEqual(week);
    const justUnder = new Date(startsAt.getTime() + 24 * hour - 1);
    expect(waiverClockInstant({ now, startsAt, endsAt: justUnder })).toEqual(startsAt);
  });

  it("is never earlier than now", () => {
    const past = new Date(now.getTime() - 3 * hour);
    expect(
      waiverClockInstant({ now, startsAt: past, endsAt: new Date(past.getTime() + hour) }),
    ).toEqual(now);
    const underWay = new Date(now.getTime() - hour);
    expect(
      waiverClockInstant({ now, startsAt: underWay, endsAt: new Date(now.getTime() + 2 * hour) }),
    ).toEqual(now);
  });

  it("is now when the trip is unknown", () => {
    expect(waiverClockInstant({ now, startsAt: null, endsAt: null })).toEqual(now);
  });
});
