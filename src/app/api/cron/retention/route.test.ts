import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/retention", () => ({ pruneExpiredRecords: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { pruneExpiredRecords } = await import("@/db/retention");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/retention", { headers });
}

function cleanSummary() {
  return {
    outcomes: [
      {
        table: "stripe_webhook_events" as const,
        deleted: 12,
        capped: false,
        failed: false,
        retentionDays: 400,
      },
      {
        table: "activity_events" as const,
        deleted: 3,
        capped: false,
        failed: false,
        retentionDays: 1095,
      },
    ],
    totalDeleted: 15,
    failedTables: [],
  };
}

/** The single `console.log` summary line the pass emits, parsed. */
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
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(pruneExpiredRecords)
    .mockReset()
    .mockResolvedValue(cleanSummary() as never);
});

// Same fail-closed posture as /api/cron/reminders: a prune deletes rows, so an
// unconfigured or unauthenticated deployment must delete nothing at all.
describe("GET /api/cron/retention — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(pruneExpiredRecords).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(pruneExpiredRecords).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(pruneExpiredRecords).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe", async () => {
    await GET(cronRequest("Bearer wrong"));
    vi.stubEnv("CRON_SECRET", "");
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/retention — reporting", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("reports what it deleted, per table and in total", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ totalDeleted: 15 });

    expect(summaryLine()).toEqual(
      expect.objectContaining({
        event: "cron_retention.prune_complete",
        level: "info",
        totalDeleted: 15,
        tablesFailed: 0,
        stripe_webhook_events_deleted: 12,
        activity_events_deleted: 3,
      }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  // "Nothing was eligible" and "the pass silently stopped running" must not
  // look the same — the whole reason this reports at all.
  it("still emits a summary line when nothing was eligible", async () => {
    vi.mocked(pruneExpiredRecords).mockResolvedValue({
      outcomes: [],
      totalDeleted: 0,
      failedTables: [],
    } as never);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(summaryLine()).toEqual(
      expect.objectContaining({ event: "cron_retention.prune_complete", totalDeleted: 0 }),
    );
  });

  it("names the tables still draining under the batch cap", async () => {
    vi.mocked(pruneExpiredRecords).mockResolvedValue({
      outcomes: [
        {
          table: "activity_events",
          deleted: 5000,
          capped: true,
          failed: false,
          retentionDays: 1095,
        },
      ],
      totalDeleted: 5000,
      failedTables: [],
    } as never);
    await GET(cronRequest(`Bearer ${secret}`));
    expect(summaryLine()).toEqual(expect.objectContaining({ tablesCapped: "activity_events" }));
  });

  // A partial pass answers 500 so the scheduler's invocation log and Sentry
  // agree with each other that this run was not clean.
  it("answers 500 and flags the monitor when an arm failed", async () => {
    vi.mocked(pruneExpiredRecords).mockResolvedValue({
      outcomes: [
        {
          table: "account_tokens",
          deleted: 0,
          capped: false,
          failed: true,
          retentionDays: 90,
        },
      ],
      totalDeleted: 0,
      failedTables: ["account_tokens"],
    } as never);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(summaryLine()).toEqual(
      expect.objectContaining({ tablesFailed: 1, failedTables: "account_tokens" }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: { retention_table: "account_tokens" } }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("closes out the check-in when the database never came up", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("no database"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});
