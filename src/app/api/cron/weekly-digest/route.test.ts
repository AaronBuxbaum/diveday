import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/weekly-digest", () => ({ sendDueWeeklyDigests: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { sendDueWeeklyDigests } = await import("@/db/weekly-digest");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";
const FAKE_DB = { fake: "db" };

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/weekly-digest", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(sendDueWeeklyDigests).mockReset().mockResolvedValue({
    shopsDue: 2,
    sent: 2,
    alreadySent: 0,
    failed: 0,
    quietShops: 1,
    shopErrors: 0,
  });
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
});

describe("GET /api/cron/weekly-digest", () => {
  it("fails closed until the cron secret is configured and presented", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest(`Bearer ${secret}`))).status).toBe(503);

    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest())).status).toBe(401);
    expect(sendDueWeeklyDigests).not.toHaveBeenCalled();
  });

  it("runs every Monday-morning shop and records its own hourly check-in", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      shopsDue: 2,
      sent: 2,
      alreadySent: 0,
      failed: 0,
      quietShops: 1,
      shopErrors: 0,
    });
    expect(sendDueWeeklyDigests).toHaveBeenCalledWith(FAKE_DB);
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "diveday-weekly-digest", status: "in_progress" },
      expect.objectContaining({ schedule: { type: "crontab", value: "0 * * * *" } }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-weekly-digest",
      status: "ok",
    });
  });

  it("reports an unavailable digest scan without leaving the monitor open", async () => {
    const failure = new Error("provider unavailable");
    vi.mocked(sendDueWeeklyDigests).mockRejectedValue(failure);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { cron_scan: "weekly_digest" },
    });
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-weekly-digest",
      status: "error",
    });
  });
});
