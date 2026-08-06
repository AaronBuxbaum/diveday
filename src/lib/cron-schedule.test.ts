import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DAILY_TICK_CRONTAB,
  DAILY_TICK_INTERVAL_MS,
  dailyPassesWithin,
  nextDailyTickAtOrAfter,
} from "./cron-schedule";

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

  it("is the fastest wake-up there is, so a day is the floor on retry latency", () => {
    // What `src/db/notifications.ts` actually depends on is not that the
    // reminders tick is the *only* daily cron — a second daily entry is fine,
    // and `/api/cron/usage` is one — but that nothing wakes the process more
    // often than daily. That is what makes "one attempt per pass" mean one
    // attempt per day and the three-pass retry window mean three days. A
    // sub-daily entry (`*/10 * * * *`, `0 */4 * * *`) would quietly make both
    // statements false, so adding one has to be a deliberate act that comes
    // through here.
    const subDaily = vercelCrons().filter((cron) => {
      const [minute, hour] = cron.schedule.split(" ");
      return minute.includes("/") || minute === "*" || hour.includes("/") || hour === "*";
    });
    expect(subDaily).toEqual([]);
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
