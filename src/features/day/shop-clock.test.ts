import { describe, expect, it } from "vitest";
import { shopClock } from "./shop-clock";

const KEY_LARGO = { timezone: "America/New_York" };

describe("shopClock", () => {
  it("names the shop's own date, not the server's", () => {
    // 02:30Z on 15 July is still the evening of the 14th in Key Largo.
    const clock = shopClock(KEY_LARGO, new Date("2026-07-15T02:30:00Z"));
    expect(clock.today).toBe("2026-07-14");
    expect(clock.wall).toMatchObject({ year: 2026, month: 7, day: 14, hour: 22, minute: 30 });
  });

  it("brackets the shop's day exactly, from local midnight to the next", () => {
    const clock = shopClock(KEY_LARGO, new Date("2026-07-14T23:59:00Z"));
    expect(clock.day.from.toISOString()).toBe("2026-07-14T04:00:00.000Z");
    expect(clock.day.to.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("holds a 25-hour day across the autumn clock change", () => {
    const clock = shopClock(KEY_LARGO, new Date("2026-11-01T12:00:00Z"));
    expect(clock.today).toBe("2026-11-01");
    expect(clock.day.to.getTime() - clock.day.from.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("holds a day that runs 14 hours ahead of UTC", () => {
    const clock = shopClock({ timezone: "Pacific/Kiritimati" }, new Date("2026-03-01T11:00:00Z"));
    expect(clock.today).toBe("2026-03-02");
    expect(clock.day.from.toISOString()).toBe("2026-03-01T10:00:00.000Z");
  });

  it("is frozen, and does not share the instant it was given", () => {
    const given = new Date("2026-07-14T15:00:00Z");
    const clock = shopClock(KEY_LARGO, given);
    given.setUTCFullYear(2000);
    expect(clock.now.toISOString()).toBe("2026-07-14T15:00:00.000Z");
    expect(Object.isFrozen(clock)).toBe(true);
    expect(Object.isFrozen(clock.day)).toBe(true);
  });

  it("asks the send window in the shop's zone", () => {
    // 03:00 in Key Largo is quiet hours; a reminder waits.
    expect(
      shopClock(KEY_LARGO, new Date("2026-07-14T07:00:00Z")).maySend("trip_reminder_24h"),
    ).toBe(false);
    // 10:00 in Key Largo is inside the window.
    expect(
      shopClock(KEY_LARGO, new Date("2026-07-14T14:00:00Z")).maySend("trip_reminder_24h"),
    ).toBe(true);
    // A blowout is exempt: divers need it before they set off.
    expect(shopClock(KEY_LARGO, new Date("2026-07-14T07:00:00Z")).maySend("trip_blowout")).toBe(
      true,
    );
  });
});
