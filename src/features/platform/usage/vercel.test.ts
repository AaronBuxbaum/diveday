import { describe, expect, it, vi } from "vitest";
import { fetchVercelSpend } from "./vercel";

/**
 * No test here touches the network: every case injects a fetcher, which is also
 * what proves the adapter is genuinely injectable rather than only claiming to
 * be. The cases that matter most are the ones where nothing came back — the
 * probe must say which kind of nothing, because `not_configured` and
 * `unavailable` mean different things to whoever reads the alert.
 */

const now = new Date("2026-08-06T09:00:00.000Z");
const env = { USAGE_VERCEL_TOKEN: "tok", USAGE_VERCEL_TEAM_ID: "team_x" };

function jsonl(...rows: unknown[]): Response {
  return new Response(rows.map((row) => JSON.stringify(row)).join("\n"), { status: 200 });
}

describe("fetchVercelSpend — credentials", () => {
  it("reports not_configured with no token, and never calls out", async () => {
    const fetcher = vi.fn();
    const result = await fetchVercelSpend({ env: {}, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats a token with no team id as not configured, not as half-working", async () => {
    const fetcher = vi.fn();
    const result = await fetchVercelSpend({
      env: { USAGE_VERCEL_TOKEN: "tok" },
      fetcher: fetcher as never,
      now,
    });
    expect(result.sample).toEqual({ status: "not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ignores whitespace-only values", async () => {
    const result = await fetchVercelSpend({
      env: { USAGE_VERCEL_TOKEN: "  ", USAGE_VERCEL_TEAM_ID: "team_x" },
      fetcher: vi.fn() as never,
      now,
    });
    expect(result.sample).toEqual({ status: "not_configured" });
  });
});

describe("fetchVercelSpend — the request", () => {
  it("bounds the query to the current UTC calendar month and sends the bearer token", async () => {
    const fetcher = vi.fn(async () => jsonl({ BilledCost: 1 }));
    await fetchVercelSpend({ env, fetcher: fetcher as never, now });

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.vercel.com/v1/billing/charges?");
    expect(url).toContain("teamId=team_x");
    expect(url).toContain("from=2026-08-01");
    // The last day of the month, never the first of the next one.
    expect(url).toContain("to=2026-08-31");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(init.signal).toBeDefined();
  });
});

describe("fetchVercelSpend — reading the answer", () => {
  it("sums BilledCost across newline-delimited rows", async () => {
    const fetcher = async () =>
      jsonl({ BilledCost: 12.5 }, { BilledCost: 7.25 }, { BilledCost: 0.25 });
    const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "measured", value: 20 });
    expect(result.rows).toBe(3);
  });

  it("falls back to EffectiveCost on a row that carries no billed figure", async () => {
    const fetcher = async () => jsonl({ EffectiveCost: 4 }, { BilledCost: 6 });
    const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "measured", value: 10 });
  });

  it("skips blank lines, unparseable lines, and rows with no cost at all", async () => {
    const body = ['{"BilledCost": 5}', "", "not json", '{"ServiceName": "Functions"}', "  "].join(
      "\n",
    );
    const fetcher = async () => new Response(body, { status: 200 });
    const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "measured", value: 5 });
    expect(result.rows).toBe(1);
  });

  it("reports unavailable rather than $0 when no row parsed", async () => {
    // The important one. An empty body, an error document served with a 200, or
    // a renamed field would otherwise read as "spent nothing this month".
    const fetcher = async () => new Response("", { status: 200 });
    const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "unavailable", reason: "no_charge_rows" });
  });
});

describe("fetchVercelSpend — failures", () => {
  it("maps status codes to reason codes an operator can act on", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "forbidden"],
      [429, "rate_limited"],
      [500, "http_500"],
    ];
    for (const [status, reason] of cases) {
      const fetcher = async () => new Response("nope", { status });
      const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
      expect(result.sample, `status ${status}`).toEqual({ status: "unavailable", reason });
    }
  });

  it("reports a thrown fetch as unavailable, never as a crash", async () => {
    const fetcher = async () => {
      throw new Error("ECONNRESET");
    };
    const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "unavailable", reason: "network_error" });
  });

  it("refuses a response with more rows than it will parse", async () => {
    // A truncated sum reads as lower usage than reality — the one direction a
    // cost monitor must never round.
    const body = Array.from({ length: 20_001 }, () => '{"BilledCost": 1}').join("\n");
    const fetcher = async () => new Response(body, { status: 200 });
    const result = await fetchVercelSpend({ env, fetcher: fetcher as never, now });
    expect(result.sample).toEqual({ status: "unavailable", reason: "response_too_large" });
  });
});

describe("fetchVercelSpend — the fleet-wide external HTTP switch", () => {
  it("does not block an injected fetcher, so unit tests still exercise the adapter", async () => {
    const fetcher = async () => jsonl({ BilledCost: 3 });
    const result = await fetchVercelSpend({
      env: { ...env, DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" },
      fetcher: fetcher as never,
      now,
    });
    expect(result.sample).toEqual({ status: "measured", value: 3 });
  });

  it("blocks the real fetch and says it could not measure, not that nothing is set", async () => {
    const result = await fetchVercelSpend({
      env: { ...env, DIVEDAY_DISABLE_EXTERNAL_HTTP: "1" },
      fetcher: fetch,
      now,
    });
    expect(result.sample).toEqual({ status: "unavailable", reason: "external_http_disabled" });
  });
});
