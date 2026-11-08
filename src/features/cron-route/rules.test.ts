import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/log-shipping", () => ({ flushLogs: vi.fn() }));
vi.mock("@/features/sentry-server", () => ({
  reportScrubbedError: vi.fn(),
  sentry: { captureCheckIn: vi.fn(), captureException: vi.fn() },
}));
vi.mock("../../lib/log", () => ({ log: vi.fn() }));

const { flushLogs } = await import("@/features/log-shipping");
const { reportScrubbedError, sentry } = await import("@/features/sentry-server");
const { log } = await import("../../lib/log");
const { cronRoute } = await import("./rules");

const SECRET = "cron-route-secret";

function request(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/sweeps", { headers });
}

function route(run = vi.fn().mockResolvedValue({ swept: 2 })) {
  return { run, GET: cronRoute({ id: "daily-sweeps", crontab: "9 * * * *", run }) };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.mocked(sentry.captureCheckIn).mockReset().mockResolvedValue("check-in-id");
  vi.mocked(sentry.captureException).mockReset();
  vi.mocked(reportScrubbedError).mockReset();
  vi.mocked(flushLogs).mockReset();
  vi.mocked(log).mockReset();
});

function expectNothingHappened(run: ReturnType<typeof vi.fn>) {
  expect(run).not.toHaveBeenCalled();
  expect(sentry.captureCheckIn).not.toHaveBeenCalled();
  expect(sentry.captureException).not.toHaveBeenCalled();
  expect(reportScrubbedError).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  expect(flushLogs).not.toHaveBeenCalled();
}

describe("cronRoute authorization (adversarial: the gate comes before any work)", () => {
  it("answers 503 not_configured with no secret, whatever is presented, and does nothing else", async () => {
    vi.stubEnv("CRON_SECRET", "");
    for (const presented of [undefined, "Bearer ", "Bearer undefined", `Bearer ${SECRET}`]) {
      const { GET, run } = route();
      const response = await GET(request(presented));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
      expectNothingHappened(run);
    }
  });

  it("answers a bodiless 401 to a missing, wrong, near-miss or schemeless token and does nothing else", async () => {
    for (const presented of [
      undefined,
      "",
      "Bearer wrong",
      `Bearer ${SECRET}x`,
      `Bearer ${SECRET.slice(0, -1)}`,
      SECRET,
      `bearer ${SECRET}`,
    ]) {
      const { GET, run } = route();
      const response = await GET(request(presented));
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
      expectNothingHappened(run);
    }
  });
});

describe("cronRoute pass", () => {
  it("checks in around the run, returns its summary and flushes logs", async () => {
    const { GET, run } = route();
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ swept: 2 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "diveday-daily-sweeps", status: "in_progress" },
      {
        schedule: { type: "crontab", value: "9 * * * *" },
        checkinMargin: 20,
        maxRuntime: 10,
        timezone: "Etc/UTC",
      },
    );
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      checkInId: "check-in-id",
      monitorSlug: "diveday-daily-sweeps",
      status: "ok",
    });
    expect(log).toHaveBeenCalledWith("cron_daily_sweeps.scan_complete", "info", { swept: 2 });
    expect(flushLogs).toHaveBeenCalledTimes(1);
  });

  it("opens the check-in before the run starts", async () => {
    const order: string[] = [];
    vi.mocked(sentry.captureCheckIn).mockImplementation(async (checkIn) => {
      order.push(`check-in:${checkIn.status}`);
      return "check-in-id";
    });
    const { GET } = route(
      vi.fn().mockImplementation(async () => {
        order.push("run");
        return {};
      }),
    );
    await GET(request(`Bearer ${SECRET}`));
    expect(order).toEqual(["check-in:in_progress", "run", "check-in:ok"]);
  });

  it("reports a thrown pass as 503 scan_unavailable, closes the monitor as error and still flushes", async () => {
    const failure = new Error("provider unavailable for Ada Lovelace");
    const { GET } = route(vi.fn().mockRejectedValue(failure));
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "scan_unavailable" });
    // Sentry gets a stand-in with the pass's name, never the error's text
    // (`reportScrubbedError`); nothing reaches the SDK's raw capture.
    expect(reportScrubbedError).toHaveBeenCalledWith(failure, {
      name: "CronPassFailed",
      message: "cron pass daily-sweeps failed",
      tags: { cron_scan: "daily-sweeps" },
    });
    expect(sentry.captureException).not.toHaveBeenCalled();
    // The log line names the scan, never the error's text (it can quote a diver).
    expect(log).toHaveBeenCalledWith("cron_daily_sweeps.scan_failed", "error", {
      scan: "daily-sweeps",
    });
    expect(sentry.captureCheckIn).toHaveBeenLastCalledWith({
      checkInId: "check-in-id",
      monitorSlug: "diveday-daily-sweeps",
      status: "error",
    });
    expect(flushLogs).toHaveBeenCalledTimes(1);
  });
});

describe("cronRoute monitor slug", () => {
  it("reads SENTRY_<ID>_CRON_MONITOR_SLUG, with the id upper-cased and kebab turned to snake", async () => {
    vi.stubEnv("SENTRY_DAILY_SWEEPS_CRON_MONITOR_SLUG", "staging-sweeps");
    const { GET } = route();
    await GET(request(`Bearer ${SECRET}`));
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "staging-sweeps", status: "in_progress" },
      expect.anything(),
    );
  });

  it("reads the variable named by slugEnv instead when a route's predates the pattern", async () => {
    vi.stubEnv("SENTRY_RECAP_CRON_MONITOR_SLUG", "staging-recaps");
    const GET = cronRoute({
      id: "recaps",
      crontab: "2 * * * *",
      slugEnv: "SENTRY_RECAP_CRON_MONITOR_SLUG",
      run: async () => ({}),
    });
    await GET(request(`Bearer ${SECRET}`));
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: "staging-recaps", status: "in_progress" },
      expect.anything(),
    );
  });

  it("passes a route's own margin and runtime to the monitor", async () => {
    const GET = cronRoute({
      id: "slow",
      crontab: "0 4 * * 1",
      checkinMargin: 60,
      maxRuntime: 30,
      run: async () => ({}),
    });
    await GET(request(`Bearer ${SECRET}`));
    expect(sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ checkinMargin: 60, maxRuntime: 30 }),
    );
  });
});
