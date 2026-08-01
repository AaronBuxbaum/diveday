import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/checkout-recovery", () => ({ sendDueCheckoutRecoveries: vi.fn() }));
vi.mock("@/db/media-deletions", () => ({ retryPendingMediaDeletions: vi.fn() }));
vi.mock("@/db/notifications", () => ({ drainNotificationRetries: vi.fn() }));
vi.mock("@/db/recap", () => ({ sendDueRecaps: vi.fn() }));
vi.mock("@/db/reminders", () => ({ sendDueReminders: vi.fn() }));
vi.mock("@/db/seed", () => ({ reapExpiredDemoShops: vi.fn() }));

const { getDb } = await import("@/db/client");
const { sendDueCheckoutRecoveries } = await import("@/db/checkout-recovery");
const { retryPendingMediaDeletions } = await import("@/db/media-deletions");
const { drainNotificationRetries } = await import("@/db/notifications");
const { sendDueRecaps } = await import("@/db/recap");
const { sendDueReminders } = await import("@/db/reminders");
const { reapExpiredDemoShops } = await import("@/db/seed");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/reminders", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(FAKE_DB as never);
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
    failed: 0,
  });
  vi.mocked(retryPendingMediaDeletions)
    .mockReset()
    .mockResolvedValue({ attempted: 5, succeeded: 5 });
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
});

describe("GET /api/cron/reminders — structured logging", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
  });

  it("logs one summary line per scan already computed for the response", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);

    expect(console.log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(vi.mocked(console.log).mock.calls[0]?.[0] as string);
    expect(line).toEqual(
      expect.objectContaining({
        event: "cron_reminders.scan_complete",
        level: "info",
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
        demoShopsDeleted: 6,
      }),
    );
  });
});
