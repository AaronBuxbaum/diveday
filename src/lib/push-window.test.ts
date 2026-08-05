import { describe, expect, it } from "vitest";
import { isInPushWindow, WINDOW_AFTER_MS, WINDOW_BEFORE_MS } from "./push-window";

const startsAt = new Date("2026-08-05T08:00:00.000Z");
const endsAt = new Date("2026-08-05T12:00:00.000Z");
const dayBoat = { startsAt, endsAt };

const at = (base: Date, offsetMs: number) => new Date(base.getTime() + offsetMs);

describe("isInPushWindow", () => {
  it("is open at departure", () => {
    expect(isInPushWindow(dayBoat, startsAt)).toBe(true);
  });

  it("opens exactly WINDOW_BEFORE_MS ahead and not a millisecond earlier", () => {
    expect(isInPushWindow(dayBoat, at(startsAt, -WINDOW_BEFORE_MS))).toBe(true);
    expect(isInPushWindow(dayBoat, at(startsAt, -WINDOW_BEFORE_MS - 1))).toBe(false);
  });

  it("closes WINDOW_AFTER_MS past the trip's end, not past its start", () => {
    // The distinction that matters for a long day: a 4-hour trip stays live
    // four hours longer than a start-anchored window would allow.
    expect(isInPushWindow(dayBoat, at(endsAt, WINDOW_AFTER_MS))).toBe(true);
    expect(isInPushWindow(dayBoat, at(endsAt, WINDOW_AFTER_MS + 1))).toBe(false);
  });

  it("keeps day two of a multi-day course inside the window", () => {
    // An Open Water weekend: day two sits ~24h past the start, so any
    // start-anchored close would have gone silent for the whole second day —
    // students in the water, entry-level ratios in play.
    const weekend = {
      startsAt: new Date("2026-08-05T08:00:00.000Z"),
      endsAt: new Date("2026-08-06T16:00:00.000Z"),
    };
    const dayTwoMorning = new Date("2026-08-06T09:00:00.000Z");
    expect(isInPushWindow(weekend, dayTwoMorning)).toBe(true);
  });

  it("follows a trip that moved earlier", () => {
    // The moved-departure case: the window is computed from the trip row, so a
    // 14:00 charter pulled forward to 07:00 is live at 06:00 rather than
    // waiting for a window anchored to a time that no longer exists.
    const moved = {
      startsAt: new Date("2026-08-05T07:00:00.000Z"),
      endsAt: new Date("2026-08-05T11:00:00.000Z"),
    };
    expect(isInPushWindow(moved, new Date("2026-08-05T06:00:00.000Z"))).toBe(true);
  });

  it("is shut for next week's trip", () => {
    expect(isInPushWindow(dayBoat, new Date("2026-07-29T08:00:00.000Z"))).toBe(false);
  });

  it("never closes before the departure itself, even on a degenerate row", () => {
    // `ends_at` before `starts_at` should not exist, but if it does the window
    // must not be shut at the moment the boat is leaving.
    const backwards = { startsAt, endsAt: new Date("2026-08-05T06:00:00.000Z") };
    expect(isInPushWindow(backwards, startsAt)).toBe(true);
  });
});
