import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/checkout-recovery", () => ({ sendDueCheckoutRecoveries: vi.fn() }));
vi.mock("@/db/media-deletions", () => ({ retryPendingMediaDeletions: vi.fn() }));
vi.mock("@/db/notifications", () => ({ drainNotificationRetries: vi.fn() }));
vi.mock("@/db/processor-erasure", () => ({ retryPendingProcessorErasures: vi.fn() }));
vi.mock("@/db/recap", () => ({ sendDueRecaps: vi.fn() }));
vi.mock("@/db/reminders", () => ({ sendDueReminders: vi.fn() }));
vi.mock("@/db/seed", () => ({ reapExpiredDemoShops: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { sendDueCheckoutRecoveries } = await import("@/db/checkout-recovery");
const { retryPendingMediaDeletions } = await import("@/db/media-deletions");
const { drainNotificationRetries } = await import("@/db/notifications");
const { retryPendingProcessorErasures } = await import("@/db/processor-erasure");
const { sendDueRecaps } = await import("@/db/recap");
const { sendDueReminders } = await import("@/db/reminders");
const { reapExpiredDemoShops } = await import("@/db/seed");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/reminders", { headers });
}

/** The single `console.log` summary line the tick emits, parsed. */
function summaryLine(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0]?.[0] as string);
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(drainNotificationRetries)
    .mockReset()
    .mockResolvedValue({ scanned: 1, sent: 1, queued: 0, failed: 0 });
  vi.mocked(sendDueReminders)
    .mockReset()
    .mockResolvedValue({ scanned: 2, sent: 2, skipped: 0, failed: 0 });
  vi.mocked(sendDueRecaps)
    .mockReset()
    .mockResolvedValue({ scanned: 3, sent: 3, skipped: 0, failed: 0, optedOut: 0 });
  vi.mocked(sendDueCheckoutRecoveries).mockReset().mockResolvedValue({
    scanned: 4,
    sent: 4,
    resolved: 0,
    cancelled: 0,
    departed: 0,
    settled: 0,
    unreconciled: 0,
    optedOut: 0,
    unaddressable: 0,
    failed: 0,
  });
  vi.mocked(retryPendingMediaDeletions)
    .mockReset()
    .mockResolvedValue({ attempted: 5, succeeded: 5 });
  vi.mocked(retryPendingProcessorErasures)
    .mockReset()
    .mockResolvedValue({ attempted: 7, discharged: 7 });
  vi.mocked(reapExpiredDemoShops).mockReset().mockResolvedValue({ deleted: 6, slugs: [] });
});

describe("GET /api/cron/reminders — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(drainNotificationRetries).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(drainNotificationRetries).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(drainNotificationRetries).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe — the monitor must not be told a tick happened", async () => {
    await GET(cronRequest("Bearer wrong"));
    vi.stubEnv("CRON_SECRET", "");
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/reminders — structured logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("logs one summary line per scan already computed for the response", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);

    expect(console.log).toHaveBeenCalledTimes(1);
    expect(summaryLine()).toEqual(
      expect.objectContaining({
        event: "cron_reminders.scan_complete",
        level: "info",
        scansFailed: 0,
        notificationRetriesScanned: 1,
        notificationRetriesSent: 1,
        remindersScanned: 2,
        remindersSent: 2,
        recapsScanned: 3,
        recapsSent: 3,
        checkoutRecoveriesScanned: 4,
        checkoutRecoveriesSent: 4,
        mediaDeletionsAttempted: 5,
        mediaDeletionsSucceeded: 5,
        processorErasuresAttempted: 7,
        processorErasuresDischarged: 7,
        demoShopsDeleted: 6,
      }),
    );
  });
});

describe("GET /api/cron/reminders — per-scan isolation", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("runs every later scan even when the very first one throws", async () => {
    vi.mocked(drainNotificationRetries).mockRejectedValue(new Error("boom"));

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response).toBeDefined();
    expect(sendDueReminders).toHaveBeenCalledTimes(1);
    expect(sendDueRecaps).toHaveBeenCalledTimes(1);
    expect(sendDueCheckoutRecoveries).toHaveBeenCalledTimes(1);
    expect(retryPendingMediaDeletions).toHaveBeenCalledTimes(1);
    expect(reapExpiredDemoShops).toHaveBeenCalledTimes(1);
  });

  it("still emits the summary line — and its counts — when a scan throws", async () => {
    vi.mocked(sendDueRecaps).mockRejectedValue(new Error("boom"));

    await GET(cronRequest(`Bearer ${secret}`));

    const line = summaryLine();
    expect(line).toEqual(
      expect.objectContaining({
        event: "cron_reminders.scan_complete",
        scansFailed: 1,
        failedScans: "recaps",
        remindersSent: 2,
        demoShopsDeleted: 6,
      }),
    );
    // No counts at all for the scan that threw, so "nothing was due" and "this
    // never ran" can never be read as the same thing.
    expect(line).not.toHaveProperty("recapsScanned");
    expect(line).not.toHaveProperty("recapsSent");
  });

  it("answers with a body that distinguishes a scan that ran from one that threw", async () => {
    vi.mocked(retryPendingMediaDeletions).mockRejectedValue(new Error("boom"));

    const response = await GET(cronRequest(`Bearer ${secret}`));
    const body = (await response.json()) as Record<string, { status: string; result?: unknown }>;

    expect(response.status).toBe(500);
    expect(body.mediaDeletions).toEqual({ status: "error" });
    expect(body.reminders).toEqual({
      status: "ok",
      result: { scanned: 2, sent: 2, skipped: 0, failed: 0 },
    });
  });

  it("answers 200 when every scan ran", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, { status: string }>;
    expect(Object.values(body).every((outcome) => outcome.status === "ok")).toBe(true);
  });

  it("reports each failed scan to Sentry tagged with its name", async () => {
    const failure = new Error("boom");
    vi.mocked(sendDueReminders).mockRejectedValue(failure);

    await GET(cronRequest(`Bearer ${secret}`));

    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { cron_scan: "reminders" },
    });
  });

  it("uses one name for a scan across the Sentry tag, the error line and failedScans", async () => {
    const failure = new Error("boom");
    vi.mocked(retryPendingMediaDeletions).mockRejectedValue(failure);

    await GET(cronRequest(`Bearer ${secret}`));

    // An operator grepping "mediaDeletions" must find all three surfaces.
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { cron_scan: "mediaDeletions" },
    });
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]?.[0] as string)).toEqual(
      expect.objectContaining({ event: "cron_reminders.scan_failed", scan: "mediaDeletions" }),
    );
    expect(summaryLine()).toEqual(expect.objectContaining({ failedScans: "mediaDeletions" }));
  });

  it("logs a failed scan on console.error, leaving the single summary line intact", async () => {
    vi.mocked(sendDueReminders).mockRejectedValue(new Error("boom"));

    await GET(cronRequest(`Bearer ${secret}`));

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(vi.mocked(console.error).mock.calls[0]?.[0] as string);
    expect(line).toEqual(
      expect.objectContaining({
        event: "cron_reminders.scan_failed",
        level: "error",
        scan: "reminders",
      }),
    );
  });

  it("keeps going when several scans throw", async () => {
    vi.mocked(drainNotificationRetries).mockRejectedValue(new Error("boom"));
    vi.mocked(reapExpiredDemoShops).mockRejectedValue(new Error("boom"));

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(500);
    expect(sendDueRecaps).toHaveBeenCalledTimes(1);
    expect(summaryLine()).toEqual(
      expect.objectContaining({ scansFailed: 2, failedScans: "notificationRetries,demoShops" }),
    );
  });
});

describe("GET /api/cron/reminders — dead-man's switch", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("opens an in-progress check-in carrying the schedule vercel.json declares", async () => {
    await GET(cronRequest(`Bearer ${secret}`));

    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "diveday-daily-tick", status: "in_progress" },
      expect.objectContaining({ schedule: { type: "crontab", value: "0 14 * * *" } }),
    );
  });

  it("closes the check-in as ok when every scan ran", async () => {
    await GET(cronRequest(`Bearer ${secret}`));

    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-daily-tick",
      status: "ok",
    });
  });

  it("closes the check-in as error when any scan threw", async () => {
    vi.mocked(sendDueRecaps).mockRejectedValue(new Error("boom"));

    await GET(cronRequest(`Bearer ${secret}`));

    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-daily-tick",
      status: "error",
    });
  });

  it("honours SENTRY_CRON_MONITOR_SLUG so one Sentry project can watch several environments", async () => {
    vi.stubEnv("SENTRY_CRON_MONITOR_SLUG", "diveday-staging-tick");
    vi.resetModules();
    const { GET: freshGet } = await import("./route");

    await freshGet(cronRequest(`Bearer ${secret}`));

    expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ monitorSlug: "diveday-staging-tick" }),
      expect.anything(),
    );
  });

  it("closes the check-in as error and answers 503 when the database never opens", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-daily-tick",
      status: "error",
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { cron_scan: "bootstrap" },
    });
    expect(drainNotificationRetries).not.toHaveBeenCalled();
  });
});
