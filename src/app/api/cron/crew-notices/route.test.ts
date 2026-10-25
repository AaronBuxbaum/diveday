import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/crew-notices", () => ({ sendDueCrewNotices: vi.fn() }));
vi.mock("@/db/roll-call-alerts", () => ({ sendStaleRollCallAlerts: vi.fn() }));
vi.mock("@/db/missing-diver-alerts", () => ({ sendMissingDiverAlerts: vi.fn() }));
// The routes report only where a DSN is configured; the suite runs without one.
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { sendDueCrewNotices } = await import("@/db/crew-notices");
const { sendStaleRollCallAlerts } = await import("@/db/roll-call-alerts");
const { sendMissingDiverAlerts } = await import("@/db/missing-diver-alerts");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";
const missingDiver = {
  checked: 1,
  alerted: 1,
  emails: 1,
  pushes: 0,
  released: 0,
  overdue: 0,
  allClearsRetried: 0,
};
const rollCall = { checked: 1, alerted: 1, emails: 1, shoreEmails: 0, pushes: 2, released: 0 };

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/crew-notices", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue({ fake: "db" } as never);
  vi.mocked(sendDueCrewNotices)
    .mockReset()
    .mockResolvedValue({ settled: 2, sent: 1, failed: 0, quiet: 1 });
  vi.mocked(sendStaleRollCallAlerts).mockReset().mockResolvedValue(rollCall);
  vi.mocked(sendMissingDiverAlerts).mockReset().mockResolvedValue(missingDiver);
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureCheckIn).mockClear();
});

describe("GET /api/cron/crew-notices", () => {
  it("fails closed until the cron secret is configured and presented", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest(`Bearer ${secret}`))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest())).status).toBe(401);
    expect(sendDueCrewNotices).not.toHaveBeenCalled();
    expect(sendStaleRollCallAlerts).not.toHaveBeenCalled();
  });

  it("runs the pass and reports what it did", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settled: 2,
      sent: 1,
      failed: 0,
      quiet: 1,
      rollCall,
      missingDiver,
    });
  });

  it("still sends crew notices when the stale roll-call pass throws, and checks in as an error", async () => {
    vi.mocked(sendStaleRollCallAlerts).mockRejectedValueOnce(new Error("push down"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settled: 2,
      sent: 1,
      failed: 0,
      quiet: 1,
      rollCall: null,
      missingDiver,
    });
    expect(sendDueCrewNotices).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalled();
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("still raises the stale roll-call alert when crew notices throw", async () => {
    vi.mocked(sendDueCrewNotices).mockRejectedValueOnce(new Error("db down"));
    await GET(cronRequest(`Bearer ${secret}`));
    expect(sendStaleRollCallAlerts).toHaveBeenCalled();
  });

  it("still raises the stale roll-call alert when the missing-diver retry throws, and checks in as an error", async () => {
    vi.mocked(sendMissingDiverAlerts).mockRejectedValueOnce(new Error("push down"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ rollCall, missingDiver: null });
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("checks in as an error when a filed missing-diver report is still untold past the overdue wait", async () => {
    vi.mocked(sendMissingDiverAlerts).mockResolvedValueOnce({
      ...missingDiver,
      alerted: 0,
      released: 1,
      overdue: 1,
    });
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("checks in as ok when every pass is clean", async () => {
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("answers 503 and reports to Sentry when the pass throws", async () => {
    vi.mocked(sendDueCrewNotices).mockRejectedValueOnce(new Error("db down"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
