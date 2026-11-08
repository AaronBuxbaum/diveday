import { beforeEach, describe, expect, it, vi } from "vitest";
import { marineLifeNamesIn } from "@/i18n/marine-life-labels";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/seed-boat-at-sea", () => ({ bringDemoBoatsAtSeaHome: vi.fn() }));
vi.mock("@/db/trips", () => ({
  cancelDeparturesBelowMinimum: vi.fn(),
  listMinimumNotMetRecipients: vi.fn(),
}));
vi.mock("../../../../features/reminders/store", () => ({ sendDueReminders: vi.fn() }));
vi.mock("@/db/notifications", () => ({ drainNotificationRetries: vi.fn() }));
vi.mock("../../../../features/work-order-follow-up/store", () => ({
  sendDueServiceReminders: vi.fn(),
}));
vi.mock("../../../../features/recap/store", () => ({ sendDueRecaps: vi.fn() }));
vi.mock("@/db/crew-notices", () => ({ sendDueCrewNotices: vi.fn() }));
vi.mock("../../../../features/roll-call-alerts/store", () => ({
  sendStaleRollCallAlerts: vi.fn(),
}));
vi.mock("@/db/missing-diver-alerts", () => ({ sendMissingDiverAlerts: vi.fn() }));
vi.mock("../../../../features/desk-pings/store", () => ({ sendTrailingDeskPings: vi.fn() }));
vi.mock("../../../../features/seat-sold-alerts/store", () => ({ sendSeatSoldAlerts: vi.fn() }));
// The routes report only where a DSN is configured; the suite runs without one.
vi.mock("../../../../features/sentry-dsn/rules", () => ({
  SENTRY_DSN: "https://key@sentry.invalid/1",
}));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { bringDemoBoatsAtSeaHome } = await import("@/db/seed-boat-at-sea");
const { cancelDeparturesBelowMinimum } = await import("@/db/trips");
const { sendDueReminders } = await import("../../../../features/reminders/store");
const { drainNotificationRetries } = await import("@/db/notifications");
const { sendDueServiceReminders } = await import("../../../../features/work-order-follow-up/store");
const { sendDueRecaps } = await import("../../../../features/recap/store");
const { sendDueCrewNotices } = await import("@/db/crew-notices");
const { sendStaleRollCallAlerts } = await import("../../../../features/roll-call-alerts/store");
const { sendMissingDiverAlerts } = await import("@/db/missing-diver-alerts");
const { sendTrailingDeskPings } = await import("../../../../features/desk-pings/store");
const { sendSeatSoldAlerts } = await import("../../../../features/seat-sold-alerts/store");
const Sentry = await import("@sentry/nextjs");
const { SHOP_TICK_CRONTAB } = await import("@/lib/cron-schedule");
const { nowDate } = await import("@/lib/clock");
const { GET } = await import("./route");

const secret = "cron-test-secret";
const FAKE_DB = { fake: "db" };

function cronRequest(query = "", authorization: string | null = `Bearer ${secret}`) {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  return new Request(`http://localhost/api/cron/shop-tick${query}`, { headers });
}

const ALL_SCANS = [
  bringDemoBoatsAtSeaHome,
  cancelDeparturesBelowMinimum,
  sendDueReminders,
  drainNotificationRetries,
  sendDueServiceReminders,
  sendDueRecaps,
  sendDueCrewNotices,
  sendStaleRollCallAlerts,
  sendMissingDiverAlerts,
  sendTrailingDeskPings,
  sendSeatSoldAlerts,
] as const;

function lastCheckInStatus() {
  const calls = vi.mocked(Sentry.captureCheckIn).mock.calls;
  const last = calls.at(-1);
  return (last?.[0] as { status: string } | undefined)?.status;
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(bringDemoBoatsAtSeaHome).mockReset().mockResolvedValue(0);
  vi.mocked(cancelDeparturesBelowMinimum)
    .mockReset()
    .mockResolvedValue({ considered: 0, cancelled: [], deferred: 0 } as never);
  vi.mocked(sendDueReminders)
    .mockReset()
    .mockResolvedValue({ scanned: 1, sent: 1 } as never);
  vi.mocked(drainNotificationRetries)
    .mockReset()
    .mockResolvedValue({
      scanned: 0,
      sent: 0,
      queued: 0,
      failed: 0,
      held: { sent: 0, failed: 0 },
    });
  vi.mocked(sendDueServiceReminders)
    .mockReset()
    .mockResolvedValue({ sent: 0 } as never);
  vi.mocked(sendDueRecaps)
    .mockReset()
    .mockResolvedValue({ sent: 2 } as never);
  vi.mocked(sendDueCrewNotices)
    .mockReset()
    .mockResolvedValue({ sent: 0 } as never);
  vi.mocked(sendStaleRollCallAlerts)
    .mockReset()
    .mockResolvedValue({ alerted: 0 } as never);
  vi.mocked(sendMissingDiverAlerts)
    .mockReset()
    .mockResolvedValue({ checked: 0, alerted: 0, overdue: 0 } as never);
  vi.mocked(sendTrailingDeskPings).mockReset().mockResolvedValue({ shops: 0, sent: 0, failed: 0 });
  vi.mocked(sendSeatSoldAlerts)
    .mockReset()
    .mockResolvedValue({ shops: 0, sent: 0, failed: 0, seats: 0 });
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
});

describe("GET /api/cron/shop-tick", () => {
  it("fails closed until the cron secret is configured and presented, and runs nothing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest())).status).toBe(503);

    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest("", null))).status).toBe(401);
    expect((await GET(cronRequest("", "Bearer wrong"))).status).toBe(401);
    for (const scan of ALL_SCANS) expect(scan).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it("checks in to one monitor on the deployed hourly schedule", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
      { monitorSlug: "diveday-shop-tick", status: "in_progress" },
      expect.objectContaining({ schedule: { type: "crontab", value: SHOP_TICK_CRONTAB } }),
    );
    expect(lastCheckInStatus()).toBe("ok");
  });

  it("runs every scan once, at one instant", async () => {
    const body = await (await GET(cronRequest())).json();
    for (const scan of ALL_SCANS) expect(scan).toHaveBeenCalledTimes(1);
    const now = nowDate();
    expect(sendDueReminders).toHaveBeenCalledWith(FAKE_DB, { now });
    expect(sendDueRecaps).toHaveBeenCalledWith(FAKE_DB, { marineLifeNamesIn, now });
    expect(sendMissingDiverAlerts).toHaveBeenCalledWith(FAKE_DB, { now });
    expect(bringDemoBoatsAtSeaHome).toHaveBeenCalledWith(FAKE_DB, now);
    expect(body.recaps).toEqual({ sent: 2 });
    expect(body["trip-reminders"]).toEqual({ scanned: 1, sent: 1 });
  });

  it("brings the demo boats home before any other scan reads the day", async () => {
    const order: string[] = [];
    vi.mocked(bringDemoBoatsAtSeaHome).mockImplementation(async () => {
      order.push("demo");
      return 1;
    });
    vi.mocked(sendStaleRollCallAlerts).mockImplementation(async () => {
      order.push("roll-call");
      return { alerted: 0 } as never;
    });
    await GET(cronRequest());
    expect(order).toEqual(["demo", "roll-call"]);
  });

  it("isolates a failing scan: the others still run, and the check-in is an error", async () => {
    const failure = new Error("provider down for diver@example.com");
    vi.mocked(sendDueRecaps).mockRejectedValue(failure);
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recaps).toBeNull();
    expect(body["trip-reminders"]).toEqual({ scanned: 1, sent: 1 });
    expect(sendMissingDiverAlerts).toHaveBeenCalledTimes(1);
    // The stand-in, never the original: its message can quote a diver's email.
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "CronScanFailed", message: "cron scan failed" }),
      { tags: { cron_scan: "recaps", error_class: "Error" } },
    );
    expect(vi.mocked(Sentry.captureException).mock.calls[0]?.[0]).not.toBe(failure);
    expect(lastCheckInStatus()).toBe("error");
  });

  it("logs a failed reminder's error class and SQLSTATE without its private message", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("query included diver@example.com", {
      cause: Object.assign(new Error("private bound parameters"), { code: "23505" }),
    });
    vi.mocked(sendDueReminders).mockRejectedValue(failure);
    await GET(cronRequest());
    const lines = output.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines).toContainEqual(
      expect.objectContaining({
        event: "cron_shop_tick.scan_failed",
        scan: "trip-reminders",
        errorClass: "Error",
        errorCode: "23505",
      }),
    );
    expect(JSON.stringify(lines)).not.toMatch(/diver@example.com|private bound parameters/);
    expect(lastCheckInStatus()).toBe("error");
  });

  it("pages when a filed missing-diver report is still untold, even though every scan ran", async () => {
    vi.mocked(sendMissingDiverAlerts).mockResolvedValue({
      checked: 1,
      alerted: 0,
      overdue: 1,
    } as never);
    expect((await GET(cronRequest())).status).toBe(200);
    expect(lastCheckInStatus()).toBe("error");
  });

  it("decides the minimum head count before any reminder reads the day", async () => {
    const order: string[] = [];
    vi.mocked(cancelDeparturesBelowMinimum).mockImplementation(async () => {
      await Promise.resolve();
      order.push("minimum-seats");
      return { considered: 1, cancelled: [], deferred: 0 } as never;
    });
    vi.mocked(sendDueReminders).mockImplementation(async () => {
      order.push("reminders");
      return { scanned: 0, sent: 0 } as never;
    });
    await GET(cronRequest());
    expect(order).toEqual(["minimum-seats", "reminders"]);
  });

  it("runs only the named scans when asked, and never checks in to the hourly monitor", async () => {
    const body = await (await GET(cronRequest("?scan=minimum-seats&scan=recaps"))).json();
    expect(cancelDeparturesBelowMinimum).toHaveBeenCalledTimes(1);
    expect(sendDueRecaps).toHaveBeenCalledTimes(1);
    expect(sendDueReminders).not.toHaveBeenCalled();
    expect(bringDemoBoatsAtSeaHome).not.toHaveBeenCalled();
    expect(Object.keys(body).sort()).toEqual(["minimum-seats", "recaps"]);
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it("runs a repeated scan name once", async () => {
    await GET(cronRequest("?scan=recaps&scan=recaps"));
    expect(sendDueRecaps).toHaveBeenCalledTimes(1);
  });

  it("refuses a named rerun without the cron secret", async () => {
    expect((await GET(cronRequest("?scan=recaps", null))).status).toBe(401);
    expect(sendDueRecaps).not.toHaveBeenCalled();
  });

  it("answers an unknown scan name with 400 before anything runs, and pages no one", async () => {
    const response = await GET(cronRequest("?scan=recaps&scan=recap"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "unknown_scan", unknown: ["recap"] });
    for (const scan of ALL_SCANS) expect(scan).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});
