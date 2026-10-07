import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/founder-metrics", () => ({
  claimFounderDigest: vi.fn(),
  departureRollCallEvents: vi.fn(),
  listShopActivation: vi.fn(),
  markStallsAlerted: vi.fn(),
  releaseFounderDigest: vi.fn(),
  syncShopMilestones: vi.fn(),
}));
vi.mock("@/db/funnel", () => ({
  countDemoEntriesBySource: vi.fn(),
  countSetupRequestsBySource: vi.fn(),
  countUnnotifiedSetupRequests: vi.fn(),
}));
vi.mock("@/lib/clock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clock")>();
  return { ...actual, nowDate: vi.fn() };
});
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const metrics = await import("@/db/founder-metrics");
const funnel = await import("@/db/funnel");
const { nowDate } = await import("@/lib/clock");
const { notify } = await import("@/lib/notifications");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const secret = "cron-test-secret";
const MONDAY = new Date("2026-10-12T11:00:00.000Z");
const TUESDAY = new Date("2026-10-13T11:00:00.000Z");
const DAY = 86_400_000;

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/founder-metrics", { headers });
}

const authorized = () => GET(cronRequest(`Bearer ${secret}`));

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.stubEnv("FOUNDER_DIGEST_EMAIL", "founder@example.com");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue({ fake: "db" } as never);
  vi.mocked(nowDate).mockReturnValue(MONDAY);
  vi.mocked(metrics.syncShopMilestones).mockReset().mockResolvedValue(undefined);
  vi.mocked(metrics.departureRollCallEvents)
    .mockReset()
    .mockResolvedValue([
      {
        shopId: "s1",
        bookingId: "b1",
        localDay: "2026-10-10",
        status: "boarded",
        occurredAt: new Date("2026-10-10T12:00:00Z"),
        createdAt: new Date("2026-10-10T12:00:00Z"),
        seq: 1,
      },
    ]);
  vi.mocked(metrics.claimFounderDigest).mockReset().mockResolvedValue(true);
  vi.mocked(metrics.releaseFounderDigest).mockReset().mockResolvedValue(undefined);
  vi.mocked(metrics.markStallsAlerted).mockReset().mockResolvedValue(undefined);
  vi.mocked(metrics.listShopActivation)
    .mockReset()
    .mockResolvedValue([
      {
        shopId: "s1",
        shopName: "Reef Line Divers",
        shopSlug: "reef-line",
        reached: { shop_created: new Date(MONDAY.getTime() - 9 * DAY) },
        alerted: new Set(),
      },
      {
        shopId: "s2",
        shopName: "Told Already",
        shopSlug: "told",
        reached: { shop_created: new Date(MONDAY.getTime() - 20 * DAY) },
        alerted: new Set(["shop_created"]),
      },
    ]);
  vi.mocked(funnel.countDemoEntriesBySource)
    .mockReset()
    .mockResolvedValue([
      { source: "pricing", count: 1 },
      { source: "home-hero", count: 4 },
    ]);
  vi.mocked(funnel.countSetupRequestsBySource)
    .mockReset()
    .mockResolvedValue([{ source: "pricing", count: 2 }]);
  vi.mocked(funnel.countUnnotifiedSetupRequests).mockReset().mockResolvedValue(0);
  vi.mocked(notify).mockReset().mockResolvedValue({ status: "sent", providerMessageId: "m1" });
  vi.mocked(Sentry.captureCheckIn).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the cron gate", () => {
  it("answers 503 and reads nothing when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await authorized()).status).toBe(503);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("answers 401 to a wrong token before any check-in", async () => {
    expect((await GET(cronRequest("Bearer nope"))).status).toBe(401);
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
    expect(metrics.syncShopMilestones).not.toHaveBeenCalled();
  });
});

describe("every night", () => {
  it("records milestones and reads the week so far, and sends nothing off a Monday", async () => {
    vi.mocked(nowDate).mockReturnValue(TUESDAY);
    const response = await authorized();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      weekStart: "2026-10-12",
      diveDays: 1,
      digest: "not_today",
    });
    expect(metrics.syncShopMilestones).toHaveBeenCalledTimes(1);
    expect(metrics.departureRollCallEvents).toHaveBeenCalledWith(expect.anything(), {
      from: "2026-10-12",
      to: "2026-10-13",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(metrics.claimFounderDigest).not.toHaveBeenCalled();
  });
});

describe("Monday's digest", () => {
  it("sends last week's numbers and reports each new stall once", async () => {
    const response = await authorized();
    expect(response.status).toBe(200);
    expect((await response.json()).digest).toBe("sent");

    expect(metrics.claimFounderDigest).toHaveBeenCalledWith(
      expect.anything(),
      "2026-10-05",
      MONDAY,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0]?.[0]).toEqual({
      kind: "founder_digest",
      to: "founder@example.com",
      weekStart: "2026-10-05",
      weekEnd: "2026-10-11",
      diveDays: 1,
      diveDayShops: 1,
      demoEntries: [
        { source: "home-hero", count: 4 },
        { source: "pricing", count: 1 },
      ],
      setupRequests: [{ source: "pricing", count: 2 }],
      unnotifiedSetupRequests: 0,
      // "Told Already" stalled on the same step it was reported for: not again.
      stalls: [
        {
          shopName: "Reef Line Divers",
          shopSlug: "reef-line",
          lastReached: "shop_created",
          since: "2026-10-03",
          waitingFor: "first_departure",
        },
      ],
    });
    expect(metrics.markStallsAlerted).toHaveBeenCalledWith(
      expect.anything(),
      [{ shopId: "s1", milestone: "shop_created" }],
      MONDAY,
    );
  });

  it("does not send a week another run already sent", async () => {
    vi.mocked(metrics.claimFounderDigest).mockResolvedValue(false);
    expect((await (await authorized()).json()).digest).toBe("already_sent");
    expect(notify).not.toHaveBeenCalled();
  });

  it("sends nothing and claims nothing when nobody is configured to read it", async () => {
    vi.stubEnv("FOUNDER_DIGEST_EMAIL", "");
    expect((await (await authorized()).json()).digest).toBe("no_recipient");
    expect(metrics.claimFounderDigest).not.toHaveBeenCalled();
  });

  it("gives the week back and marks no stall when the mail did not leave", async () => {
    vi.mocked(notify).mockResolvedValue({ status: "not_configured" });
    const response = await authorized();
    expect(response.status).toBe(500);
    expect(metrics.releaseFounderDigest).toHaveBeenCalledWith(expect.anything(), "2026-10-05");
    expect(metrics.markStallsAlerted).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });

  it("gives the week back when a read throws, and reports the run as failed", async () => {
    vi.mocked(funnel.countDemoEntriesBySource).mockRejectedValue(new Error("db down"));
    const response = await authorized();
    expect(response.status).toBe(503);
    expect(metrics.releaseFounderDigest).toHaveBeenCalledWith(expect.anything(), "2026-10-05");
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe("the deployed schedule", () => {
  it("runs nightly at the time the Sentry monitor expects", () => {
    const crons: Array<{ path: string; schedule: string }> = JSON.parse(
      readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"),
    ).crons;
    expect(crons.find((cron) => cron.path === "/api/cron/founder-metrics")?.schedule).toBe(
      "0 11 * * *",
    );
  });
});
