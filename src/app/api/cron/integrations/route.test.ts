import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/features/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/integrations")>();
  return { ...actual, dispatchDueIntegrationDeliveries: vi.fn() };
});
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { dispatchDueIntegrationDeliveries } = await import("@/features/integrations");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";
const FAKE_DB = { fake: "db" };
const SUMMARY = { scanned: 2, delivered: 1, retried: 1, failed: 0 };

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/integrations", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(dispatchDueIntegrationDeliveries).mockReset().mockResolvedValue(SUMMARY);
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
});

describe("GET /api/cron/integrations", () => {
  it("fails closed until the cron secret is configured and presented", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest(`Bearer ${secret}`))).status).toBe(503);

    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest())).status).toBe(401);
    expect(dispatchDueIntegrationDeliveries).not.toHaveBeenCalled();
  });

  /**
   * An unauthorized probe must never be able to tell the monitor that the drain
   * happened — that would turn the dead-man's switch into a thing anyone on the
   * internet can hold open.
   */
  it("opens no check-in for a request that never passed the bearer gate", async () => {
    await GET(cronRequest());
    await GET(cronRequest("Bearer wrong"));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it("drains the outbox and records its own half-hourly check-in", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUMMARY);
    expect(dispatchDueIntegrationDeliveries).toHaveBeenCalledWith(FAKE_DB, { limit: 50 });
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "diveday-integrations", status: "in_progress" },
      expect.objectContaining({ schedule: { type: "crontab", value: "0,30 * * * *" } }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-integrations",
      status: "ok",
    });
  });

  it("reports an unavailable drain without leaving the monitor open", async () => {
    const failure = new Error("provider unavailable");
    vi.mocked(dispatchDueIntegrationDeliveries).mockRejectedValue(failure);

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, {
      tags: { cron_scan: "integrations" },
    });
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-integrations",
      status: "error",
    });
  });

  /**
   * The database being unreachable is the case ADR
   * 20260919-health-check-does-not-wake-the-database leans on: `/api/health` no
   * longer notices it, so the cron monitors are what do. An `error` check-in
   * rather than a silent 503 is the difference between Sentry alerting and
   * nobody hearing about it.
   */
  it("sends an error check-in when the database itself is unreachable", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await GET(cronRequest(`Bearer ${secret}`));

    expect(response.status).toBe(503);
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-integrations",
      status: "error",
    });
  });
});
