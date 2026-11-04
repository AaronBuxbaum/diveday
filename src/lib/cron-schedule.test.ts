import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRICING_CLOSE_CRONTAB } from "./billing/pricing-plans";
import { BOOKKEEPER_CRON_CRONTAB } from "./bookkeeper";
import {
  DAILY_TICK_CRONTAB,
  DAILY_TICK_INTERVAL_MS,
  dailyPassesWithin,
  nextDailyTickAtOrAfter,
  SHOP_TICK_CRONTAB,
} from "./cron-schedule";
import { DIETARY_RETENTION_CRONTAB } from "./retention";
import { WEEKLY_DIGEST_CRON_CRONTAB } from "./weekly-digest";

/**
 * vercel.json is the deployed schedule. Everything else that names a cadence
 * (this module, the Sentry Cron Monitor config, the retry bounds in
 * `src/db/notifications.ts`) restates it and can drift; reading the real file
 * is what catches a change made in one place only.
 */
function vercelCrons(): Array<{ path: string; schedule: string }> {
  const raw = readFileSync(path.join(process.cwd(), "config", "crons.json"), "utf8");
  return JSON.parse(raw).crons;
}

describe("the daily tick", () => {
  it("matches the daily dietary sweep and preserves weekly table retention", () => {
    expect(
      vercelCrons().find((cron) => cron.path === "/api/cron/dietary-retention")?.schedule,
    ).toBe(DIETARY_RETENTION_CRONTAB);
    expect(vercelCrons().find((cron) => cron.path === "/api/cron/retention")?.schedule).toBe(
      "8 3 * * 0",
    );
  });
  it("matches the deployed vercel.json schedule for /api/cron/reminders", () => {
    const reminders = vercelCrons().find((cron) => cron.path === "/api/cron/reminders");
    expect(reminders?.schedule).toBe(DAILY_TICK_CRONTAB);
  });

  it("matches the deployed hourly schedule for /api/cron/shop-tick", () => {
    const tick = vercelCrons().find((cron) => cron.path === "/api/cron/shop-tick");
    expect(tick?.schedule).toBe(SHOP_TICK_CRONTAB);
  });

  it("serves every shop cadence from the one tick, not a route of its own", () => {
    // Folded into the shop tick (issue #2715); a route coming back would be a
    // second schedule for a shop's day.
    for (const retired of [
      "trip-reminders",
      "recaps",
      "minimum-seats",
      "crew-notices",
      "desk-pings",
    ]) {
      expect(vercelCrons().some((cron) => cron.path === `/api/cron/${retired}`)).toBe(false);
    }
  });

  it("matches the deployed hourly schedule for /api/cron/weekly-digest", () => {
    const digest = vercelCrons().find((cron) => cron.path === "/api/cron/weekly-digest");
    expect(digest?.schedule).toBe(WEEKLY_DIGEST_CRON_CRONTAB);
  });

  it("matches the deployed schedule for /api/cron/bookkeeper", () => {
    const pass = vercelCrons().find((cron) => cron.path === "/api/cron/bookkeeper");
    expect(pass?.schedule).toBe(BOOKKEEPER_CRON_CRONTAB);
  });

  it("matches the deployed schedule for /api/cron/pricing-volume", () => {
    const pass = vercelCrons().find((cron) => cron.path === "/api/cron/pricing-volume");
    expect(pass?.schedule).toBe(PRICING_CLOSE_CRONTAB);
  });

  /**
   * **One database wake an hour, without one stampede an hour.** A serverless
   * Postgres compute sleeps after five idle minutes and bills for the time it
   * is awake, so passes inside five consecutive minutes wake it once, and the
   * same passes spread at `:00`, `:10`, `:20` wake it three times. Within those
   * minutes each pass takes its own, so cold functions do not open pools
   * against the pooler at one second. The assertion holds both: one pass to a
   * minute, and no gap of five minutes between one hourly pass and the next.
   */
  it("keeps the hourly passes one to a minute, with no five-minute gap between them", () => {
    const hourlyMinutes = vercelCrons()
      .filter((cron) => cron.schedule.split(" ")[1] === "*")
      .flatMap((cron) => cron.schedule.split(" ")[0].split(","))
      .map(Number);
    expect(hourlyMinutes.length).toBeGreaterThan(0);
    const sorted = [...hourlyMinutes].sort((a, b) => a - b);
    expect(sorted[0]).toBe(0);
    expect(new Set(sorted).size).toBe(sorted.length);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(sorted[index] - sorted[index - 1]).toBeLessThan(5);
    }
  });

  /**
   * **The dailies and the nightlies ride the same wake.** The assertion above
   * sees hourlies only; every entry, whatever its cadence, takes a minute
   * nothing else in its hour fires on, and every minute sits within five of the
   * one before it from `:00`, so an hour wakes the compute once.
   */
  it("gives every pass in an hour its own minute, all inside one wake", () => {
    const hoursOf = (field: string) =>
      field === "*" ? Array.from({ length: 24 }, (_, hour) => hour) : field.split(",").map(Number);
    for (let hour = 0; hour < 24; hour += 1) {
      const minutes = vercelCrons()
        .filter((cron) => hoursOf(cron.schedule.split(" ")[1]).includes(hour))
        .flatMap((cron) => cron.schedule.split(" ")[0].split(","))
        .map(Number)
        .sort((a, b) => a - b);
      expect(new Set(minutes).size, `hour ${hour}: ${minutes.join(", ")}`).toBe(minutes.length);
      expect(minutes[0]).toBe(0);
      for (let index = 1; index < minutes.length; index += 1) {
        expect(
          minutes[index] - minutes[index - 1],
          `hour ${hour}: ${minutes.join(", ")}`,
        ).toBeLessThan(5);
      }
    }
  });

  it("wakes no *queue-draining* pass more often than daily, so a day is the floor on retry latency", () => {
    // `src/db/notifications.ts` depends on nothing **draining the notification
    // send queue** more often than daily, which is what makes "one attempt per
    // pass" mean one attempt per day. A second daily cron is fine; the guard is
    // an allowlist, and adding a route is a product and operations change. Each
    // allowed route owns one user-visible promise that a daily UTC hour cannot
    // keep and calls only a fresh-send function, never the queue:
    // - minimum-seats: cancels at a moment printed on the booking page (ADR
    //   20260813-minimum-head-count-departures).
    // - recaps: never before four hours, normally within an hour after
    //   (`sendDueRecaps`).
    // - trip-reminders: a reminder lands inside the shop's own daytime, which
    //   no fixed UTC hour does across zones (issue #697; `sendDueReminders`).
    const SUB_DAILY_ALLOWED = new Set([
      // shop-tick: every shop cadence (src/features/shop-tick), each a promise
      // a fixed UTC hour cannot keep across zones: the minimum-head-count
      // decision at the moment printed on the booking page (ADR
      // 20260813-minimum-head-count-departures); a reminder inside the shop's
      // own daytime (issue #697); a recap never before four hours and normally
      // within an hour after; crew hearing about tomorrow's boat today (ADR
      // 20261009-crew-hear-about-their-boats); the desk's trailing catch-up
      // (#2311). Each scan calls a fresh-send function, never the queue.
      "/api/cron/shop-tick",
      "/api/cron/integrations",
      // weekly-digest: a Monday-morning email in the shop's own zone
      // (`sendDueWeeklyDigests`); later passes stop at the per-person,
      // per-week claim.
      "/api/cron/weekly-digest",
    ]);
    const subDaily = vercelCrons().filter((cron) => {
      const [minute, hour] = cron.schedule.split(" ");
      return minute.includes("/") || minute === "*" || hour.includes("/") || hour === "*";
    });
    expect(subDaily.filter((cron) => !SUB_DAILY_ALLOWED.has(cron.path))).toEqual([]);
  });

  /**
   * The allowlist relies on its routes not reaching the durable queue
   * (`sendNotification`/`sendNotificationBatch`, src/db/notifications.ts).
   * This source check covers only the files listed, not indirect call paths.
   */
  it("keeps the sub-daily routes off the generic notification queue", () => {
    for (const routePath of [
      "src/app/api/cron/shop-tick/route.ts",
      "src/features/shop-tick/shop-tick.ts",
      "src/features/shop-tick/minimum-seats.ts",
    ]) {
      const route = readFileSync(path.join(process.cwd(), routePath), "utf8");
      expect(route).not.toMatch(/sendNotification\b|sendNotificationBatch\b/);
    }
  });
});

describe("nextDailyTickAtOrAfter", () => {
  it("returns today's tick when the instant is before it", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-08-06T09:15:00.000Z")).toISOString()).toBe(
      "2026-08-06T14:07:00.000Z",
    );
  });

  it("returns the instant itself when it lands exactly on a tick", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-08-06T14:07:00.000Z")).toISOString()).toBe(
      "2026-08-06T14:07:00.000Z",
    );
  });

  it("rolls to tomorrow's tick one millisecond after today's", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-08-06T14:07:00.001Z")).toISOString()).toBe(
      "2026-08-07T14:07:00.000Z",
    );
  });

  it("never returns an instant in the past", () => {
    const instants = [
      "2026-01-01T00:00:00.000Z",
      "2026-02-28T23:59:59.999Z",
      "2026-06-15T13:59:59.999Z",
      "2026-12-31T23:00:00.000Z",
    ];
    for (const iso of instants) {
      const instant = new Date(iso);
      expect(nextDailyTickAtOrAfter(instant).getTime()).toBeGreaterThanOrEqual(instant.getTime());
    }
  });

  it("rolls across a month and a year boundary", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-01-31T20:00:00.000Z")).toISOString()).toBe(
      "2026-02-01T14:07:00.000Z",
    );
    expect(nextDailyTickAtOrAfter(new Date("2026-12-31T20:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T14:07:00.000Z",
    );
  });

  it("lands within one interval of the instant, whatever the time of day", () => {
    // The property that makes "one pass later" true: snapping forward can
    // never cost more than a single day, so an N-attempt budget is N days.
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const instant = new Date(Date.UTC(2026, 7, 6) + minute * 60_000);
      const delta = nextDailyTickAtOrAfter(instant).getTime() - instant.getTime();
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThan(DAILY_TICK_INTERVAL_MS);
    }
  });
});

describe("dailyPassesWithin", () => {
  it("counts whole passes inside a wall-clock budget", () => {
    expect(dailyPassesWithin(3 * DAILY_TICK_INTERVAL_MS)).toBe(3);
    expect(dailyPassesWithin(7 * DAILY_TICK_INTERVAL_MS)).toBe(7);
  });

  it("never reports zero passes, so a short budget still gets one try", () => {
    expect(dailyPassesWithin(0)).toBe(1);
    expect(dailyPassesWithin(60_000)).toBe(1);
  });
});
