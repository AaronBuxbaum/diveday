import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/reminders", () => ({ sendDueReminders: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { sendDueReminders } = await import("@/db/reminders");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";
const FAKE_DB = { fake: "db" };

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/trip-reminders", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(sendDueReminders)
    .mockReset()
    .mockResolvedValue({ scanned: 5, sent: 2, skipped: 1, held: 2, failed: 0 });
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
});

describe("GET /api/cron/trip-reminders", () => {
  it("fails closed until the cron secret is configured and presented", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest(`Bearer ${secret}`))).status).toBe(503);

    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest())).status).toBe(401);
    expect(sendDueReminders).not.toHaveBeenCalled();
  });

  /**
   * **Hourly, and its own monitor.** The reminder scan used to ride the daily
   * 14:00 UTC tick, which is 10am in Florida and 03:00 in Fiji — so every shop
   * in the signup picker's Asia-Pacific group texted its divers in the middle
   * of the night, every day (issue #697). A fixed UTC hour cannot serve more
   * than one longitude; an hourly pass plus each shop's own send window can.
   */
  it("runs the reminder scan hourly and records its own check-in", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    // `held` rides the response, not just the log: an operator has to be able
    // to tell "nothing was due" from "plenty was, and it is waiting for
    // daylight somewhere".
    expect(await response.json()).toEqual({ scanned: 5, sent: 2, skipped: 1, held: 2, failed: 0 });
    expect(sendDueReminders).toHaveBeenCalledWith(FAKE_DB);
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "diveday-trip-reminders", status: "in_progress" },
      // The dead-man's switch has to know the real cadence, or a missed pass
      // never reads as missed.
      expect.objectContaining({ schedule: { type: "crontab", value: "10 * * * *" } }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-trip-reminders",
      status: "ok",
    });
  });

  it("reports an unavailable scan without leaving the monitor open", async () => {
    const failure = new Error("provider unavailable");
    vi.mocked(sendDueReminders).mockRejectedValue(failure);

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { cron_scan: "trip_reminders" },
    });
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-trip-reminders",
      status: "error",
    });
  });
});
