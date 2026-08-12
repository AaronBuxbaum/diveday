import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/demo-refresh", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/demo-refresh")>();
  return { ...actual, refreshCanonicalDemoSchedule: vi.fn() };
});
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { DEMO_SCHEDULE_MIN_RUNWAY_DAYS, refreshCanonicalDemoSchedule } = await import(
  "@/db/demo-refresh"
);
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/demo-refresh", { headers });
}

/** A pass over a demo whose board is still healthy — the normal night. */
function healthyBoard() {
  return { found: true, runwayDays: 58, refreshed: false };
}

/** The single `console.log` summary line the pass emits, parsed. */
function summaryLine(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0]?.[0] as string);
}

/** The failure line, which `log()` writes at error level over `console.error`. */
function failureLine(): Record<string, unknown> {
  const calls = vi.mocked(console.error).mock.calls;
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
  vi.mocked(refreshCanonicalDemoSchedule)
    .mockReset()
    .mockResolvedValue(healthyBoard() as never);
});

// Same fail-closed posture as every other scheduled route, and the strongest
// case for it: this pass can wipe and re-seed a whole shop, so an unconfigured
// or unauthenticated deployment must not reach the database at all.
describe("GET /api/cron/demo-refresh — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(refreshCanonicalDemoSchedule).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(refreshCanonicalDemoSchedule).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(refreshCanonicalDemoSchedule).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe", async () => {
    await GET(cronRequest("Bearer wrong"));
    vi.stubEnv("CRON_SECRET", "");
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/demo-refresh — reporting", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  // The normal night, and the one that must stay distinguishable from a pass
  // that has stopped running: nothing to do is not nothing to say.
  it("reports the runway it found on a night it changed nothing", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ refreshed: false });

    expect(summaryLine()).toEqual(
      expect.objectContaining({
        event: "cron_demo_refresh.pass_complete",
        level: "info",
        minRunwayDays: DEMO_SCHEDULE_MIN_RUNWAY_DAYS,
        runwayDays: 58,
        refreshed: false,
        demoShopFound: true,
      }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("reports the runway that triggered a restore", async () => {
    vi.mocked(refreshCanonicalDemoSchedule).mockResolvedValue({
      found: true,
      runwayDays: 0,
      refreshed: true,
    } as never);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(summaryLine()).toEqual(
      expect.objectContaining({ runwayDays: 0, refreshed: true, demoShopFound: true }),
    );
  });

  // A database seeded around an existing shop never gets a canonical demo
  // (`seedIfEmpty` only seeds an empty database). That is a legitimate state,
  // not an incident — the monitor stays green and the line says what was found.
  it("stays green on a database with no canonical demo shop", async () => {
    vi.mocked(refreshCanonicalDemoSchedule).mockResolvedValue({
      found: false,
      runwayDays: null,
      refreshed: false,
    } as never);
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(summaryLine()).toEqual(expect.objectContaining({ demoShopFound: false }));
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("closes out the check-in when the restore failed", async () => {
    vi.mocked(refreshCanonicalDemoSchedule).mockRejectedValue(new Error("no database"));
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(failureLine()).toEqual(
      expect.objectContaining({ event: "cron_demo_refresh.pass_failed", level: "error" }),
    );
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
    const entry = crons.find((cron) => cron.path === "/api/cron/demo-refresh");
    expect(entry?.schedule).toBe("45 3 * * *");
  });
});
