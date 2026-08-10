import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/trips", () => ({ rollAllSeriesForward: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { rollAllSeriesForward } = await import("@/db/trips");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/trip-series", { headers });
}

function cleanSweep() {
  return { seriesConsidered: 4, seriesExtended: 2, tripsCreated: 9, failures: 0 };
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
  vi.mocked(rollAllSeriesForward)
    .mockReset()
    .mockResolvedValue(cleanSweep() as never);
});

// Same fail-closed posture as every other scheduled route: this one *writes*
// trips, so an unconfigured or unauthenticated deployment must write nothing.
describe("GET /api/cron/trip-series — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(rollAllSeriesForward).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(rollAllSeriesForward).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(rollAllSeriesForward).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe", async () => {
    await GET(cronRequest("Bearer wrong"));
    vi.stubEnv("CRON_SECRET", "");
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/trip-series — reporting", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("reports how many runs it considered, extended, and how many dates it added", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tripsCreated: 9 });

    expect(summaryLine()).toEqual(
      expect.objectContaining({
        event: "cron_trip_series.roll_complete",
        level: "info",
        seriesConsidered: 4,
        seriesExtended: 2,
        tripsCreated: 9,
        seriesFailed: 0,
      }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  // A pass with nothing to add is the *normal* case — the horizon only needs
  // widening on the days a cadence crosses its far edge. It must still be
  // distinguishable from a pass that stopped running.
  it("still emits a summary line on a night with nothing to add", async () => {
    vi.mocked(rollAllSeriesForward).mockResolvedValue({
      seriesConsidered: 4,
      seriesExtended: 0,
      tripsCreated: 0,
      failures: 0,
    } as never);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(summaryLine()).toEqual(
      expect.objectContaining({ event: "cron_trip_series.roll_complete", tripsCreated: 0 }),
    );
  });

  it("answers 500 and flags the monitor when a run could not be rolled", async () => {
    vi.mocked(rollAllSeriesForward).mockResolvedValue({
      seriesConsidered: 3,
      seriesExtended: 1,
      tripsCreated: 4,
      failures: 2,
    } as never);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(summaryLine()).toEqual(expect.objectContaining({ seriesFailed: 2 }));
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tags: { series_failures: "2" } }),
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

describe("the deployed schedule", () => {
  it("matches the Sentry monitor's own crontab", async () => {
    // The monitor's `schedule` is what decides when a check-in counts as
    // *missing*, so a schedule changed in vercel.json and not here would turn
    // the dead-man's switch into a nightly false alarm (or, worse, silence it).
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const crons: Array<{ path: string; schedule: string }> = JSON.parse(
      readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    ).crons;
    const entry = crons.find((cron) => cron.path === "/api/cron/trip-series");
    expect(entry?.schedule).toBe("15 3 * * *");
  });
});
