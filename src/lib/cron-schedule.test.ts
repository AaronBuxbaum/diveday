import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CREW_NOTICE_CRON_CRONTAB } from "./crew-notices";
import {
  DAILY_TICK_CRONTAB,
  DAILY_TICK_INTERVAL_MS,
  dailyPassesWithin,
  nextDailyTickAtOrAfter,
} from "./cron-schedule";
import { MINIMUM_SEATS_CRON_CRONTAB } from "./minimum-seats";
import { RECAP_CRON_CRONTAB } from "./recap-schedule";
import { TRIP_REMINDER_CRON_CRONTAB } from "./reminders";
import { WEEKLY_DIGEST_CRON_CRONTAB } from "./weekly-digest";

/**
 * vercel.json is the deployed schedule. Everything else in the repo that names
 * a cadence — this module, the Sentry Cron Monitor config in the reminders
 * route, the retry bounds in `src/db/notifications.ts` — is a restatement of
 * it, and restatements drift. Reading the real file is the only assertion here
 * that can catch a schedule change made in one place and not the others.
 */
function vercelCrons(): Array<{ path: string; schedule: string }> {
  const raw = readFileSync(path.join(process.cwd(), "vercel.json"), "utf8");
  return JSON.parse(raw).crons;
}

describe("the daily tick", () => {
  it("matches the deployed vercel.json schedule for /api/cron/reminders", () => {
    const reminders = vercelCrons().find((cron) => cron.path === "/api/cron/reminders");
    expect(reminders?.schedule).toBe(DAILY_TICK_CRONTAB);
  });

  it("matches the deployed hourly schedule for /api/cron/recaps", () => {
    const recaps = vercelCrons().find((cron) => cron.path === "/api/cron/recaps");
    expect(recaps?.schedule).toBe(RECAP_CRON_CRONTAB);
  });

  it("matches the deployed hourly schedule for /api/cron/trip-reminders", () => {
    const reminders = vercelCrons().find((cron) => cron.path === "/api/cron/trip-reminders");
    expect(reminders?.schedule).toBe(TRIP_REMINDER_CRON_CRONTAB);
  });

  it("matches the deployed hourly schedule for /api/cron/weekly-digest", () => {
    const digest = vercelCrons().find((cron) => cron.path === "/api/cron/weekly-digest");
    expect(digest?.schedule).toBe(WEEKLY_DIGEST_CRON_CRONTAB);
  });

  it("matches the deployed hourly schedule for /api/cron/crew-notices", () => {
    const pass = vercelCrons().find((cron) => cron.path === "/api/cron/crew-notices");
    expect(pass?.schedule).toBe(CREW_NOTICE_CRON_CRONTAB);
  });

  it("matches the deployed hourly schedule for /api/cron/minimum-seats", () => {
    const sweep = vercelCrons().find((cron) => cron.path === "/api/cron/minimum-seats");
    expect(sweep?.schedule).toBe(MINIMUM_SEATS_CRON_CRONTAB);
  });

  /**
   * **One database wake an hour, without one stampede an hour.** A serverless
   * Postgres compute sleeps after five idle minutes and bills for the time it
   * is awake, so what the bill tracks is the number of separate stretches
   * something wakes it, not the number of passes: passes inside five
   * consecutive minutes keep one compute awake once, and the same passes at
   * `:00`, `:10` and `:20` wake it three times. That is what this assertion
   * stops a future "spread them across the hour" from quietly restoring. The
   * integrations drain had `:30` until 2026-10-06, when it joined the others
   * to halve the idle wake-ups.
   *
   * Inside those minutes they are a minute apart rather than on one: six cold
   * functions opening pools against the pooler at the same second was a
   * connection spike at the top of every hour (code review 2026-10-10, item
   * 11). Aaron chose `:00`–`:04` over a wider spread, to keep the one wake.
   */
  it("keeps every hourly pass inside the hour's first five minutes, at most two to a minute", () => {
    const hourlyMinutes = vercelCrons()
      .filter((cron) => cron.schedule.split(" ")[1] === "*")
      .flatMap((cron) => cron.schedule.split(" ")[0].split(","))
      .map(Number);
    expect(hourlyMinutes.length).toBeGreaterThan(0);
    for (const minute of hourlyMinutes) {
      expect(minute).toBeGreaterThanOrEqual(0);
      expect(minute).toBeLessThanOrEqual(4);
    }
    const perMinute = new Map<number, number>();
    for (const minute of hourlyMinutes) perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
    expect(Math.max(...perMinute.values())).toBeLessThanOrEqual(2);
  });

  it("wakes no *queue-draining* pass more often than daily, so a day is the floor on retry latency", () => {
    // What `src/db/notifications.ts` actually depends on is not that the
    // reminders tick is the *only* daily cron — a second daily entry is fine,
    // and `/api/cron/usage` is one — but that nothing **drains the notification
    // send queue** more often than daily. That is what makes "one attempt per
    // pass" mean one attempt per day and the three-pass retry window mean
    // three days.
    //
    // This started life as "no sub-daily entry at all", which is a proxy for
    // that and was the right proxy while every cron drained the queue by
    // arriving. It stopped being the right proxy on 2026-08-13, when the
    // minimum-head-count sweep landed (ADR
    // 20260813-minimum-head-count-departures): its whole product claim is that
    // a departure cancels itself at a moment printed on the booking page, and
    // a daily pass makes that promise true to within about a day.
    //
    // So the guard is now an allowlist rather than a ban. The hourly recap
    // pass is the second deliberate exception: unlike generic retry work, it
    // owns one user-visible promise (never before four hours; normally within
    // an hour after that) and calls only `sendDueRecaps`, whose query holds
    // that floor. Adding a route here is still a product and operations change,
    // not a scheduling convenience.
    // `/api/cron/trip-reminders` is the third, and the case for it is the same
    // shape as the recap pass's. It owns one user-visible promise — a reminder
    // reaches a diver inside their shop's own daytime — and a fixed daily UTC
    // hour cannot keep it: 14:00 UTC is 10am in Florida and 03:00 in Fiji, so
    // every shop in the picker's Asia-Pacific group was texting divers in the
    // middle of the night (issue #697). It calls only `sendDueReminders`, which
    // sends fresh messages; it does **not** drain the notification send queue,
    // so the daily floor on retry latency that this test protects is untouched.
    // That is also why the reminder scan *moved* rather than the daily tick
    // becoming hourly.
    const SUB_DAILY_ALLOWED = new Set([
      "/api/cron/minimum-seats",
      "/api/cron/recaps",
      "/api/cron/trip-reminders",
      "/api/cron/integrations",
      // The Monday email (market audit item 51) is the fifth, on the
      // trip-reminder pass's argument: a weekly message promised for Monday
      // morning in the shop's own zone cannot ride one fixed UTC hour. It
      // calls only `sendDueWeeklyDigests`, which sends fresh mail and never
      // drains the queue; every pass after a shop's first on its Monday stops
      // at the per-person, per-week claim.
      "/api/cron/weekly-digest",
      // Crew news (ADR 20261009-crew-hear-about-their-boats) is the sixth: a
      // crew member taken off tomorrow's boat cannot hear it a day later. It
      // calls only `sendDueCrewNotices`, which sends fresh mail of a kind that
      // is never queued, and it runs inside the others' five minutes.
      "/api/cron/crew-notices",
    ]);
    const subDaily = vercelCrons().filter((cron) => {
      const [minute, hour] = cron.schedule.split(" ");
      return minute.includes("/") || minute === "*" || hour.includes("/") || hour === "*";
    });
    expect(subDaily.filter((cron) => !SUB_DAILY_ALLOWED.has(cron.path))).toEqual([]);
  });

  /**
   * The allowlist above is only as good as this: the routes on it must not
   * reach the durable queue. `sendNotification`/`sendNotificationBatch` are the
   * two functions that enqueue and drain it (src/db/notifications.ts), so a
   * sub-daily route importing either is the mistake the allowlist would
   * otherwise silently permit.
   */
  it("keeps the sub-daily routes off the generic notification queue", () => {
    for (const routePath of [
      "src/app/api/cron/minimum-seats/route.ts",
      "src/app/api/cron/recaps/route.ts",
    ]) {
      const route = readFileSync(path.join(process.cwd(), routePath), "utf8");
      expect(route).not.toMatch(/sendNotification\b|sendNotificationBatch\b/);
    }
  });
});

describe("nextDailyTickAtOrAfter", () => {
  it("returns today's tick when the instant is before it", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-08-06T09:15:00.000Z")).toISOString()).toBe(
      "2026-08-06T14:00:00.000Z",
    );
  });

  it("returns the instant itself when it lands exactly on a tick", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-08-06T14:00:00.000Z")).toISOString()).toBe(
      "2026-08-06T14:00:00.000Z",
    );
  });

  it("rolls to tomorrow's tick one millisecond after today's", () => {
    expect(nextDailyTickAtOrAfter(new Date("2026-08-06T14:00:00.001Z")).toISOString()).toBe(
      "2026-08-07T14:00:00.000Z",
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
      "2026-02-01T14:00:00.000Z",
    );
    expect(nextDailyTickAtOrAfter(new Date("2026-12-31T20:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T14:00:00.000Z",
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
