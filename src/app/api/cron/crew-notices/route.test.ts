import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/crew-notices", () => ({ sendDueCrewNotices: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { sendDueCrewNotices } = await import("@/db/crew-notices");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";

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
  vi.mocked(Sentry.captureException).mockClear();
});

describe("GET /api/cron/crew-notices", () => {
  it("fails closed until the cron secret is configured and presented", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(cronRequest(`Bearer ${secret}`))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", secret);
    expect((await GET(cronRequest())).status).toBe(401);
    expect(sendDueCrewNotices).not.toHaveBeenCalled();
  });

  it("runs the pass and reports what it did", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settled: 2, sent: 1, failed: 0, quiet: 1 });
  });

  it("answers 503 and reports to Sentry when the pass throws", async () => {
    vi.mocked(sendDueCrewNotices).mockRejectedValueOnce(new Error("db down"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
