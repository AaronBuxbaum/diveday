import { describe, expect, it, vi } from "vitest";
import { fetchNeonUsage } from "./neon";

/**
 * One request answers three ceilings, so the interesting cases are the partial
 * ones: a metric that is missing must cost exactly its own ceiling a reading
 * and leave the other two intact, and a request that failed outright must
 * blind all three rather than half-reporting.
 */

const now = new Date("2026-08-06T09:00:00.000Z");
const env = { USAGE_NEON_API_KEY: "key", USAGE_NEON_ORG_ID: "org-1" };

const SECONDS_PER_HOUR = 3_600;
const BYTES_PER_GIB = 1_024 ** 3;

function consumption(metrics: Record<string, number>, projects = 1): Response {
  return Response.json({
    projects: Array.from({ length: projects }, (_, index) => ({
      project_id: `p${index}`,
      periods: [{ consumption: [{ timeframe_start: "x", timeframe_end: "y", metrics }] }],
    })),
  });
}

describe("fetchNeonUsage — credentials", () => {
  it("reports not_configured on every ceiling with no key, and never calls out", async () => {
    const fetcher = vi.fn();
    const result = await fetchNeonUsage({ env: {}, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "not_configured" });
    expect(result.storage).toEqual({ status: "not_configured" });
    expect(result.egress).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats a key with no org id as not configured", async () => {
    const result = await fetchNeonUsage({
      env: { USAGE_NEON_API_KEY: "key" },
      fetcher: vi.fn() as never,
      now,
    });
    expect(result.compute).toEqual({ status: "not_configured" });
  });
});

describe("fetchNeonUsage — the request", () => {
  it("asks the v2 endpoint for the month, by metric name, with the bearer key", async () => {
    const fetcher = vi.fn(async () => consumption({ compute_unit_seconds: 1 }));
    await fetchNeonUsage({ env, fetcher: fetcher as never, now });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    // The v2 path, specifically: /consumption_history/account was removed in
    // June 2026 along with the legacy metric names.
    expect(url).toContain("https://console.neon.tech/api/v2/consumption_history/v2/projects?");
    expect(url).toContain("granularity=monthly");
    expect(url).toContain("org_id=org-1");
    expect(url).toContain("from=2026-08-01T00%3A00%3A00.000Z");
    expect(url).toContain("to=2026-09-01T00%3A00%3A00.000Z");
    expect(url).toContain("compute_unit_seconds");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer key");
  });
});

describe("fetchNeonUsage — reading the answer", () => {
  it("converts seconds to compute-unit hours and bytes to GiB", async () => {
    const fetcher = async () =>
      consumption({
        compute_unit_seconds: 7_200,
        root_branch_bytes_month: BYTES_PER_GIB * 2,
        child_branch_bytes_month: BYTES_PER_GIB,
        public_network_transfer_bytes: BYTES_PER_GIB * 4,
      });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "measured", value: 2 });
    // Root and child branches are one storage figure.
    expect(result.storage).toEqual({ status: "measured", value: 3 });
    expect(result.egress).toEqual({ status: "measured", value: 4 });
  });

  it("sums across projects", async () => {
    const fetcher = async () => consumption({ compute_unit_seconds: SECONDS_PER_HOUR }, 3);
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "measured", value: 3 });
    expect(result.projects).toBe(3);
  });

  it("blinds only the ceiling whose metric is missing", async () => {
    // A renamed or unscoped metric must not turn into a zero, and must not take
    // the metrics that *did* arrive down with it.
    const fetcher = async () => consumption({ compute_unit_seconds: SECONDS_PER_HOUR });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "measured", value: 1 });
    expect(result.storage).toEqual({ status: "unavailable", reason: "metric_absent" });
    expect(result.egress).toEqual({ status: "unavailable", reason: "metric_absent" });
  });

  it("reports a genuine zero as zero when the metric is present", async () => {
    const fetcher = async () => consumption({ compute_unit_seconds: 0 });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "measured", value: 0 });
  });

  it("blinds every ceiling when the payload is not the documented shape", async () => {
    const fetcher = async () => Response.json({ data: [] });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    for (const sample of [result.compute, result.storage, result.egress]) {
      expect(sample).toEqual({ status: "unavailable", reason: "unrecognised_shape" });
    }
  });

  it("blinds every ceiling on an account with no projects, rather than reading zero", async () => {
    const fetcher = async () => Response.json({ projects: [] });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "unavailable", reason: "metric_absent" });
  });
});

describe("fetchNeonUsage — failures", () => {
  it("maps status codes to reason codes on all three ceilings", async () => {
    const fetcher = async () => new Response("nope", { status: 401 });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    for (const sample of [result.compute, result.storage, result.egress]) {
      expect(sample).toEqual({ status: "unavailable", reason: "unauthorized" });
    }
  });

  it("reports a thrown fetch as unavailable, never as a crash", async () => {
    const fetcher = async () => {
      throw new Error("ETIMEDOUT");
    };
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "unavailable", reason: "network_error" });
  });

  it("reports an unreadable body as unavailable", async () => {
    const fetcher = async () => new Response("<html>gateway</html>", { status: 200 });
    const result = await fetchNeonUsage({ env, fetcher: fetcher as never, now });
    expect(result.compute).toEqual({ status: "unavailable", reason: "body_read_error" });
  });
});

describe("fetchNeonUsage — the fleet-wide external HTTP switch", () => {
  it("blocks the real fetch and says it could not measure", async () => {
    const result = await fetchNeonUsage({
      env: { ...env, DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" },
      fetcher: fetch,
      now,
    });
    expect(result.compute).toEqual({ status: "unavailable", reason: "external_http_disabled" });
  });

  it("does not block an injected fetcher", async () => {
    const fetcher = async () => consumption({ compute_unit_seconds: SECONDS_PER_HOUR });
    const result = await fetchNeonUsage({
      env: { ...env, DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" },
      fetcher: fetcher as never,
      now,
    });
    expect(result.compute).toEqual({ status: "measured", value: 1 });
  });
});
