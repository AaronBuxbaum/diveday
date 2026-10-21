import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/retention", () => ({ drainExpiredDietaryNotes: vi.fn() }));
vi.mock("@/lib/sentry-dsn", () => ({ SENTRY_DSN: "https://key@sentry.invalid/1" }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureMessage: vi.fn(),
}));
vi.mock("@/lib/observability", () => ({ flushLogs: vi.fn() }));

const { getDb } = await import("@/db/client");
const { drainExpiredDietaryNotes } = await import("@/db/retention");
const { flushLogs } = await import("@/lib/observability");
const Sentry = await import("@sentry/nextjs");
const { GET, maxDuration } = await import("./route");
const secret = "dietary-cron-test-secret";
const request = (token?: string) =>
  new Request("http://localhost/api/cron/dietary-retention", {
    headers: token === undefined ? {} : { authorization: token },
  });

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue({} as never);
  vi.mocked(drainExpiredDietaryNotes)
    .mockReset()
    .mockResolvedValue({ cleared: 5, capped: false, failed: false });
  vi.mocked(Sentry.captureCheckIn).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
  vi.mocked(flushLogs).mockClear();
});

function eventLines(method: "log" | "warn" | "error") {
  return vi.mocked(console[method]).mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("daily dietary retention auth", () => {
  it.each([undefined, "Bearer wrong"])(
    "rejects unauthorized request %s before any check-in",
    async (token) => {
      expect((await GET(request(token))).status).toBe(401);
      expect(getDb).not.toHaveBeenCalled();
      expect(drainExpiredDietaryNotes).not.toHaveBeenCalled();
      expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    },
  );
  it("fails closed when the secret is unconfigured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(`Bearer ${secret}`))).status).toBe(503);
    expect(getDb).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("daily dietary retention outcomes", () => {
  it.each([0, 5])(
    "reports a clean pass with %i cleared notes and a UTC daily monitor",
    async (cleared) => {
      vi.mocked(drainExpiredDietaryNotes).mockResolvedValue({
        cleared,
        capped: false,
        failed: false,
      });
      const response = await GET(request(`Bearer ${secret}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ cleared, capped: false, failed: false });
      expect(maxDuration).toBe(60);
      expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(
        1,
        { monitorSlug: "diveday-dietary-retention", status: "in_progress" },
        {
          schedule: { type: "crontab", value: "9 3 * * *" },
          checkinMargin: 240,
          maxRuntime: 5,
          timezone: "Etc/UTC",
        },
      );
      expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "ok" }),
      );
      expect(eventLines("log")).toEqual([
        expect.objectContaining({
          event: "cron_dietary_retention.clear_complete",
          cleared,
          capped: false,
          failed: false,
        }),
      ]);
      expect(flushLogs).toHaveBeenCalledOnce();
    },
  );

  it("keeps partial counts, answers 500, alarms and flags the monitor on statement failure", async () => {
    vi.mocked(drainExpiredDietaryNotes).mockResolvedValue({
      cleared: 2,
      capped: false,
      failed: true,
    });
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ cleared: 2, capped: false, failed: true });
    expect(eventLines("error")).toEqual([
      expect.objectContaining({ event: "cron_dietary_retention.clear_failed", cleared: 2 }),
    ]);
    expect(Sentry.captureMessage).toHaveBeenCalledWith("dietary retention failed", {
      level: "error",
    });
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(flushLogs).toHaveBeenCalledOnce();
  });

  it("returns the explicit cap outcome, alarms and marks the monitor incomplete", async () => {
    vi.mocked(drainExpiredDietaryNotes).mockResolvedValue({
      cleared: 4,
      capped: true,
      failed: false,
    });
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleared: 4, capped: true, failed: false });
    expect(eventLines("warn")).toEqual([
      expect.objectContaining({ event: "cron_dietary_retention.clear_capped", cleared: 4 }),
    ]);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(flushLogs).toHaveBeenCalledOnce();
  });

  it("alarms bootstrap failures without sending private error text anywhere", async () => {
    const privateText = "Private dietary note, person@example.test, bearer-secret";
    vi.mocked(getDb).mockRejectedValue(new Error(privateText));
    const response = await GET(request(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "dietary_retention_unavailable" });
    expect(eventLines("error")).toEqual([
      expect.objectContaining({ event: "cron_dietary_retention.clear_failed", scan: "bootstrap" }),
    ]);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    expect(
      JSON.stringify([
        eventLines("log"),
        eventLines("error"),
        vi.mocked(Sentry.captureMessage).mock.calls,
      ]),
    ).not.toContain(privateText);
    expect(flushLogs).toHaveBeenCalledOnce();
  });

  it("awaits log shipping before returning", async () => {
    let finish: (() => void) | undefined;
    vi.mocked(flushLogs).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let returned = false;
    const pending = GET(request(`Bearer ${secret}`)).then((response) => {
      returned = true;
      return response;
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(returned).toBe(false);
    finish?.();
    expect((await pending).status).toBe(200);
  });
});
