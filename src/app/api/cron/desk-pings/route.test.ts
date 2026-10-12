import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/desk-pings", () => ({ sendTrailingDeskPings: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { sendTrailingDeskPings } = await import("@/db/desk-pings");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/desk-pings", { headers });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue({ fake: "db" } as never);
  vi.mocked(sendTrailingDeskPings).mockReset().mockResolvedValue({ shops: 1, sent: 2, failed: 0 });
  vi.mocked(Sentry.captureException).mockClear();
});

describe("GET /api/cron/desk-pings", () => {
  it("fails closed until the cron secret is configured and presented", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest(`Bearer ${secret}`))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest())).status).toBe(401);
    expect(sendTrailingDeskPings).not.toHaveBeenCalled();
  });

  it("runs the pass and reports what it did", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ shops: 1, sent: 2, failed: 0 });
  });

  it("answers 503 and reports to Sentry when the pass throws", async () => {
    vi.mocked(sendTrailingDeskPings).mockRejectedValueOnce(new Error("db down"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
