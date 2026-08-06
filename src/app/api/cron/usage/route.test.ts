import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSample } from "@/lib/cost-guardrails";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/usage/collect", () => ({ collectUsageSamples: vi.fn() }));
vi.mock("@/lib/usage/alert-ledger", () => ({
  claimUsageAlert: vi.fn(),
  releaseUsageAlert: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({ notify: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const { getDb } = await import("@/db/client");
const { collectUsageSamples } = await import("@/lib/usage/collect");
const { claimUsageAlert, releaseUsageAlert } = await import("@/lib/usage/alert-ledger");
const { notify } = await import("@/lib/notifications");
const Sentry = await import("@sentry/nextjs");
const { GET } = await import("./route");

const FAKE_DB = { fake: "db" };
const secret = "cron-test-secret";

function cronRequest(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new Request("http://localhost/api/cron/usage", { headers });
}

/** The single `console.log` summary line the pass emits, parsed. */
function summaryLine(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(calls[0]?.[0] as string);
}

function samples(overrides: Record<string, UsageSample> = {}) {
  return {
    vercel_spend: { status: "measured", value: 1 },
    neon_compute: { status: "measured", value: 1 },
    neon_storage: { status: "measured", value: 1 },
    neon_egress: { status: "measured", value: 1 },
    ...overrides,
  } as Record<string, UsageSample>;
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.mocked(getDb)
    .mockReset()
    .mockResolvedValue(FAKE_DB as never);
  vi.mocked(collectUsageSamples).mockReset().mockResolvedValue(samples());
  vi.mocked(claimUsageAlert).mockReset().mockResolvedValue(true);
  vi.mocked(releaseUsageAlert).mockReset().mockResolvedValue(undefined);
  vi.mocked(notify).mockReset().mockResolvedValue({ status: "sent", providerMessageId: "ses-1" });
  vi.mocked(Sentry.captureCheckIn).mockClear().mockReturnValue("check-in-id");
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.captureMessage).mockClear();
});

// The same fail-closed posture as /api/cron/retention and /api/cron/reminders.
// This route sends mail and reads two vendors' billing APIs; neither should be
// reachable by an unauthenticated probe.
describe("GET /api/cron/usage — auth gate", () => {
  it("is unavailable when no CRON_SECRET is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(503);
    expect(collectUsageSamples).not.toHaveBeenCalled();
  });

  it("rejects a request without the bearer token", async () => {
    const response = await GET(cronRequest());
    expect(response.status).toBe(401);
    expect(collectUsageSamples).not.toHaveBeenCalled();
  });

  it("rejects a request with the wrong bearer token", async () => {
    const response = await GET(cronRequest("Bearer wrong"));
    expect(response.status).toBe(401);
    expect(collectUsageSamples).not.toHaveBeenCalled();
  });

  it("never checks in for an unauthorized probe", async () => {
    // The check-in has to sit *behind* the gate, or a probe could tell the
    // dead-man's switch the poll happened when nothing was polled.
    await GET(cronRequest("Bearer wrong"));
    vi.stubEnv("CRON_SECRET", "");
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/usage — alerting", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("sends nothing while every ceiling is comfortably under", async () => {
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(notify).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "ok" }),
    );
  });

  it("mails the founder once when a ceiling is reached", async () => {
    // vercel_spend has a ceiling of 60 and warns at half of it.
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ vercel_spend: { status: "measured", value: 45 } }),
    );
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(response.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "usage_ceiling_alert",
        ceilingId: "vercel_spend",
        level: "warn",
        value: 45,
        ceiling: 60,
        percent: 75,
        overflow: "bills_overage",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ alertsSent: 1 });
  });

  it("claims before sending, and keys the claim on ceiling, period, and level", async () => {
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ vercel_spend: { status: "measured", value: 100 } }),
    );
    await GET(cronRequest(`Bearer ${secret}`));
    const [, key] = vi.mocked(claimUsageAlert).mock.calls[0] as unknown as [unknown, string];
    expect(key).toMatch(/^usage-ceiling\/vercel_spend\/\d{4}-\d{2}\/over$/);
  });

  it("stays quiet for the rest of the period once the claim is held", async () => {
    // The behaviour the whole ledger exists for: a ceiling that stays over does
    // not mail every morning for three weeks.
    vi.mocked(claimUsageAlert).mockResolvedValue(false);
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ vercel_spend: { status: "measured", value: 100 } }),
    );
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(notify).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ alertsSuppressed: 1 });
  });

  it("sends anyway when the claim itself could not be taken", async () => {
    // A cost alert seen twice costs a duplicate email; one never seen costs
    // money. The tie is broken toward sending.
    vi.mocked(claimUsageAlert).mockRejectedValue(new Error("claim table gone"));
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ vercel_spend: { status: "measured", value: 100 } }),
    );
    await GET(cronRequest(`Bearer ${secret}`));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("gives the claim back when the send did not land, so tomorrow retries", async () => {
    vi.mocked(notify).mockResolvedValue({ status: "not_configured" });
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ vercel_spend: { status: "measured", value: 100 } }),
    );
    const response = await GET(cronRequest(`Bearer ${secret}`));
    expect(releaseUsageAlert).toHaveBeenCalledTimes(1);
    // The run was not clean, and the scheduler's log should agree with Sentry.
    expect(response.status).toBe(500);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "error" }),
    );
    await expect(response.json()).resolves.toMatchObject({ alertsFailed: 1 });
  });

  it("escalates warn and over as separate news", async () => {
    // neon_compute warns at 40% of 300 and is over at 300.
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ neon_compute: { status: "measured", value: 400 } }),
    );
    await GET(cronRequest(`Bearer ${secret}`));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ ceilingId: "neon_compute", level: "over", overflow: "suspends" }),
    );
  });
});

describe("GET /api/cron/usage — what it cannot see", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
  });

  it("never reports a ceiling it could not measure as ok", async () => {
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({
        vercel_spend: { status: "not_configured" },
        neon_compute: { status: "unavailable", reason: "unauthorized" },
      }),
    );
    const response = await GET(cronRequest(`Bearer ${secret}`));
    const body = (await response.json()) as {
      evaluations: Array<{ ceilingId: string; level: string; reason?: string }>;
    };
    const level = (id: string) =>
      body.evaluations.find((evaluation) => evaluation.ceilingId === id);
    expect(level("vercel_spend")?.level).toBe("not_configured");
    expect(level("neon_compute")?.level).toBe("unavailable");
    expect(level("neon_compute")?.reason).toBe("unauthorized");
    // And the console-only ceilings are in the body too, admitting they exist.
    expect(level("sentry_errors")?.level).toBe("unobservable");
  });

  it("raises a Sentry warning for a probe that is blind while holding a credential", async () => {
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({ neon_egress: { status: "unavailable", reason: "metric_absent" } }),
    );
    await GET(cronRequest(`Bearer ${secret}`));
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({
          usage_ceiling: "neon_egress",
          usage_reason: "metric_absent",
        }),
      }),
    );
    // Blind is not alertable by email — it is an engineering problem, not a bill.
    expect(notify).not.toHaveBeenCalled();
  });

  it("counts the blind and the unmeasured separately in the summary line", async () => {
    vi.mocked(collectUsageSamples).mockResolvedValue(
      samples({
        vercel_spend: { status: "not_configured" },
        neon_compute: { status: "unavailable", reason: "network_error" },
      }),
    );
    await GET(cronRequest(`Bearer ${secret}`));
    expect(summaryLine()).toEqual(
      expect.objectContaining({
        event: "cron_usage.scan_complete",
        level: "info",
        blind: 1,
        vercel_spend_level: "not_configured",
        neon_compute_level: "unavailable",
        // not_configured plus the two console-only ceilings.
        unmeasured: 3,
      }),
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
