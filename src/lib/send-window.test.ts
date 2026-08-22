import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEND_WINDOW,
  isWithinSendWindow,
  maySendNow,
  QUIET_HOURS_EXEMPT_KINDS,
  type SendWindow,
} from "./send-window";
import { CURATED_TIMEZONE_GROUPS } from "./timezones";
import { utcToWallTime } from "./zoned";

const at = (iso: string) => new Date(iso);

describe("a shop's send window", () => {
  it("opens on its first hour and closes before its last", () => {
    const window: SendWindow = { startHour: 8, endHour: 20 };
    // 12:00 UTC is 08:00 in New York in summer — the boundary, and inclusive.
    expect(isWithinSendWindow(at("2026-07-15T12:00:00Z"), "America/New_York", window)).toBe(true);
    expect(isWithinSendWindow(at("2026-07-15T11:59:00Z"), "America/New_York", window)).toBe(false);
    // 19:59 is in, 20:00 is out — `endHour` is exclusive so "20" reads as
    // "eight in the evening" to whoever sets it, not "up to and including 8pm".
    expect(isWithinSendWindow(at("2026-07-15T23:59:00Z"), "America/New_York", window)).toBe(true);
    expect(isWithinSendWindow(at("2026-07-16T00:00:00Z"), "America/New_York", window)).toBe(false);
  });

  /**
   * **The window is wall-clock, so it has to be read as wall-clock.**
   *
   * A window computed from a fixed UTC offset drifts an hour at each DST
   * transition, in the direction that puts the first send of the day *before*
   * the shop's floor — which is exactly the failure this whole rule exists to
   * prevent, arriving twice a year instead of daily.
   */
  it("holds its shop-local hour across a DST transition", () => {
    const window: SendWindow = { startHour: 8, endHour: 20 };
    // 2026-03-08 is the US spring-forward. 12:00 UTC is 08:00 EDT after it and
    // 07:00 EST before it — the same instant of day, two different local hours.
    expect(isWithinSendWindow(at("2026-03-07T12:00:00Z"), "America/New_York", window)).toBe(false);
    expect(isWithinSendWindow(at("2026-03-09T12:00:00Z"), "America/New_York", window)).toBe(true);
    // And the local 08:00 is inside the window on both sides of it, which is
    // the property that actually matters to a diver.
    expect(isWithinSendWindow(at("2026-03-07T13:00:00Z"), "America/New_York", window)).toBe(true);
    expect(isWithinSendWindow(at("2026-03-09T12:00:00Z"), "America/New_York", window)).toBe(true);
  });

  it("falls back to the default rather than muting a shop with a nonsense window", () => {
    // A window that cannot be satisfied would silence every reminder the shop
    // sends, permanently and invisibly. Whatever produced it, the shop keeps
    // its messages.
    for (const broken of [
      { startHour: 20, endHour: 8 },
      { startHour: -1, endHour: 20 },
      { startHour: 8, endHour: 25 },
      { startHour: 8, endHour: 8 },
      { startHour: 8.5, endHour: 20 },
    ]) {
      expect(isWithinSendWindow(at("2026-07-15T16:00:00Z"), "America/New_York", broken)).toBe(true);
      expect(isWithinSendWindow(at("2026-07-15T07:00:00Z"), "America/New_York", broken)).toBe(
        false,
      );
    }
  });

  it("lets a dawn-boat operation open earlier than the default", () => {
    const dawn: SendWindow = { startHour: 5, endHour: 20 };
    // 10:00 UTC is 06:00 in New York — quiet by default, fine for a shop whose
    // boats leave at seven.
    expect(isWithinSendWindow(at("2026-07-15T10:00:00Z"), "America/New_York", dawn)).toBe(true);
    expect(
      isWithinSendWindow(at("2026-07-15T10:00:00Z"), "America/New_York", DEFAULT_SEND_WINDOW),
    ).toBe(false);
  });
});

/**
 * **The table from issue #697, as an assertion.**
 *
 * A fixed 14:00 UTC batch reached Singapore at 22:00, Sydney at midnight and
 * Fiji at 03:00. This is what stops that returning: whatever the cron cadence,
 * no curated zone may be sent to outside its own window.
 */
describe("every timezone the signup picker promotes", () => {
  const zones = CURATED_TIMEZONE_GROUPS.flatMap((group) => group.zones);

  it("covers the whole curated list", () => {
    // Guards the guard: a zone added to the picker without reaching this sweep
    // would be silently unprotected.
    expect(zones.length).toBeGreaterThanOrEqual(17);
  });

  it("never lets a held message go out outside a shop's own daytime", () => {
    const offenders: string[] = [];
    for (const zone of zones) {
      // Every hour of a full day, both sides of the northern DST boundary, so a
      // southern-hemisphere zone's own transition is covered too.
      for (const day of ["2026-01-15", "2026-07-15"]) {
        for (let hour = 0; hour < 24; hour += 1) {
          const now = at(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
          if (!maySendNow("trip_reminder_24h", now, zone, DEFAULT_SEND_WINDOW)) continue;
          const local = utcToWallTime(now, zone).hour;
          if (local < DEFAULT_SEND_WINDOW.startHour || local >= DEFAULT_SEND_WINDOW.endHour) {
            offenders.push(`${zone} ${day}T${hour}Z → ${local}:00 local`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reaches every curated zone at some point in the day, so nothing is muted", () => {
    // The other half: a predicate that never returns true would pass the sweep
    // above and silence the product.
    for (const zone of zones) {
      const sendable = Array.from({ length: 24 }, (_, hour) =>
        maySendNow(
          "trip_reminder_24h",
          at(`2026-07-15T${String(hour).padStart(2, "0")}:00:00Z`),
          zone,
          DEFAULT_SEND_WINDOW,
        ),
      ).filter(Boolean).length;
      expect(sendable, zone).toBeGreaterThan(0);
    }
  });
});

describe("the kinds that ignore the window", () => {
  it("sends a cancellation at three in the morning", () => {
    // A blow-out at 05:00 for an 07:00 departure has to reach the diver at
    // 05:00: they would rather be woken than drive to the dock.
    const threeAm = at("2026-07-15T07:00:00Z"); // 03:00 in New York
    expect(maySendNow("trip_blowout", threeAm, "America/New_York", DEFAULT_SEND_WINDOW)).toBe(true);
    expect(
      maySendNow("trip_minimum_not_met", threeAm, "America/New_York", DEFAULT_SEND_WINDOW),
    ).toBe(true);
  });

  it("holds everything a diver would rather read at breakfast", () => {
    const threeAm = at("2026-07-15T07:00:00Z");
    for (const kind of [
      "trip_reminder_7d",
      "trip_reminder_24h",
      "trip_recap",
      "last_minute_deal",
    ] as const) {
      expect(maySendNow(kind, threeAm, "America/New_York", DEFAULT_SEND_WINDOW), kind).toBe(false);
    }
  });

  it("exempts cancellations and nothing else", () => {
    // Named as a set, so adding a kind to the exemption list is a deliberate
    // edit to a test rather than a line nobody reviews.
    expect([...QUIET_HOURS_EXEMPT_KINDS].sort()).toEqual(["trip_blowout", "trip_minimum_not_met"]);
  });
});
