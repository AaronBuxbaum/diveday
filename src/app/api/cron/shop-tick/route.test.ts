import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/seed-boat-at-sea", () => ({ bringDemoBoatsAtSeaHome: vi.fn() }));
vi.mock("@/db/trips", () => ({
  cancelDeparturesBelowMinimum: vi.fn(),
  listMinimumNotMetRecipients: vi.fn(),
}));
vi.mock("@/db/reminders", () => ({ sendDueReminders: vi.fn() }));
vi.mock("@/db/held-sends", () => ({ drainHeldSends: vi.fn() }));
vi.mock("@/db/work-order-follow-up", () => ({ sendDueServiceReminders: vi.fn() }));
vi.mock("@/db/recap", () => ({ sendDueRecaps: vi.fn() }));
vi.mock("@/db/crew-notices", () => ({ sendDueCrewNotices: vi.fn() }));
vi.mock("@/db/roll-call-alerts", () => ({ sendStaleRollCallAlerts: vi.fn() }));
vi.mock("@/db/missing-diver-alerts", () => ({ sendMissingDiverAlerts: vi.fn() }));
vi.mock("@/db/desk-pings", () => ({ sendTrailingDeskPings: vi.fn() }));
// The routes report only where a DSN is configured; the suite runs without one.
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { bringDemoBoatsAtSeaHome } = await import("@/db/seed-boat-at-sea");
const { cancelDeparturesBelowMinimum } = await import("@/db/trips");
const { sendDueReminders } = await import("@/db/reminders");
const { drainHeldSends } = await import("@/db/held-sends");
const { sendDueServiceReminders } = await import("@/db/work-order-follow-up");
const { sendDueRecaps } = await import("@/db/recap");
const { sendDueCrewNotices } = await import("@/db/crew-notices");
const { sendStaleRollCallAlerts } = await import("@/db/roll-call-alerts");
const { sendMissingDiverAlerts } = await import("@/db/missing-diver-alerts");
const { sendTrailingDeskPings } = await import("@/db/desk-pings");
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
  drainHeldSends,
  sendDueServiceReminders,
  sendDueRecaps,
  sendDueCrewNotices,
  sendStaleRollCallAlerts,
  sendMissingDiverAlerts,
  sendTrailingDeskPings,
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
  vi.mocked(drainHeldSends).mockReset().mockResolvedValue({ sent: 0, failed: 0 });
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
    expect(sendDueRecaps).toHaveBeenCalledWith(FAKE_DB, { now });
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
    vi.mocked(sendDueRecaps).mockRejectedValue(new Error("provider down"));
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recaps).toBeNull();
    expect(body["trip-reminders"]).toEqual({ scanned: 1, sent: 1 });
    expect(sendMissingDiverAlerts).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { cron_scan: "recaps" },
    });
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

  it("runs only the named scans when asked", async () => {
    const body = await (await GET(cronRequest("?scan=minimum-seats&scan=recaps"))).json();
    expect(cancelDeparturesBelowMinimum).toHaveBeenCalledTimes(1);
    expect(sendDueRecaps).toHaveBeenCalledTimes(1);
    expect(sendDueReminders).not.toHaveBeenCalled();
    expect(bringDemoBoatsAtSeaHome).not.toHaveBeenCalled();
    expect(Object.keys(body).sort()).toEqual(["minimum-seats", "recaps"]);
  });

  it("refuses an unknown scan name rather than running the whole tick", async () => {
    const response = await GET(cronRequest("?scan=recap"));
    expect(response.status).toBe(503);
    for (const scan of ALL_SCANS) expect(scan).not.toHaveBeenCalled();
    expect(lastCheckInStatus()).toBe("error");
  });
});
