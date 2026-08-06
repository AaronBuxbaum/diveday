import { describe, expect, it } from "vitest";
import { COST_CEILINGS, evaluateCeilings } from "@/lib/cost-guardrails";
import { collectUsageSamples } from "./collect";

/**
 * The seam between "what the probes measured" and "what the registry expects to
 * have been measured". Two things can go wrong here and neither shows up
 * anywhere else: a `polled` ceiling nobody wired a probe to (which would then
 * read `unobservable` forever, looking like a deliberate gap), and one provider
 * failing in a way that costs us the other provider's reading too.
 */

const now = new Date("2026-08-06T09:00:00.000Z");

describe("collectUsageSamples", () => {
  it("produces a sample for every ceiling the registry says is polled", async () => {
    const samples = await collectUsageSamples({ env: {}, now });
    const polled = COST_CEILINGS.filter((ceiling) => ceiling.observability === "polled");
    for (const ceiling of polled) {
      expect(samples[ceiling.id], `${ceiling.id} has no probe`).toBeDefined();
    }
  });

  it("produces nothing for a console-only ceiling, which then reads unobservable", async () => {
    const samples = await collectUsageSamples({ env: {}, now });
    const consoleOnly = COST_CEILINGS.filter((ceiling) => ceiling.observability === "console_only");
    expect(consoleOnly.length).toBeGreaterThan(0);
    for (const ceiling of consoleOnly) {
      expect(samples[ceiling.id]).toBeUndefined();
    }
    const evaluations = evaluateCeilings(samples, now);
    for (const ceiling of consoleOnly) {
      const evaluation = evaluations.find((entry) => entry.ceilingId === ceiling.id);
      expect(evaluation?.level).toBe("unobservable");
    }
  });

  it("reports not_configured, never ok, when no credentials exist at all", async () => {
    const samples = await collectUsageSamples({ env: {}, now });
    for (const [id, sample] of Object.entries(samples)) {
      expect(sample.status, id).toBe("not_configured");
    }
    // And that survives evaluation: an unconfigured monitor is not a clean bill.
    const levels = new Set(evaluateCeilings(samples, now).map((entry) => entry.level));
    expect(levels.has("ok")).toBe(false);
  });

  it("keeps one provider's outage from costing the other its reading", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("neon.tech")) throw new Error("neon is down");
      return new Response('{"BilledCost": 12}', { status: 200 });
    }) as typeof fetch;

    const samples = await collectUsageSamples({
      env: {
        USAGE_VERCEL_TOKEN: "tok",
        USAGE_VERCEL_TEAM_ID: "team_x",
        USAGE_NEON_API_KEY: "key",
        USAGE_NEON_ORG_ID: "org-1",
      },
      fetcher,
      now,
    });

    expect(samples.vercel_spend).toEqual({ status: "measured", value: 12 });
    expect(samples.neon_compute).toEqual({ status: "unavailable", reason: "network_error" });
  });
});
