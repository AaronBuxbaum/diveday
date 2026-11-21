import { describe, expect, it } from "vitest";
import type { NeonProjectUsage } from "./neon";
import { evaluateNeonProjectQuotas } from "./neon-quota";

const now = new Date("2026-11-10T12:00:00Z");
const account = {
  projectId: "production",
  plan: "verified-test-plan",
  source: "test account snapshot",
  verifiedAt: now.toISOString(),
  periodStart: "2026-11-01T00:00:00Z",
  periodEnd: "2026-12-01T00:00:00Z",
  computeLimitHours: 100,
};
function usage(projectId: string | null, value: number): NeonProjectUsage {
  return {
    projectId,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    observedAt: now.toISOString(),
    compute: { status: "measured", value },
    storage: { status: "measured", value: 0.001 },
    egress: { status: "not_configured" },
  };
}

describe("project quota evidence", () => {
  it("warns for a 95/100 project independently of another project's budget or unknown plan", () => {
    const result = evaluateNeonProjectQuotas(
      [usage("production", 95), usage("preview", 2)],
      [account],
      now,
    );
    expect(result[0]).toMatchObject({
      projectId: "production",
      compute: { level: "warn", remainingHours: 5, fraction: 0.95 },
    });
    expect(result[1]).toMatchObject({
      projectId: "preview",
      status: "unknown",
      reason: "plan_quota_unknown",
    });
    expect(result[0]).toMatchObject({ storage: { status: "unknown" } });
  });

  it("does not infer current storage size from GiB-months", () => {
    const result = evaluateNeonProjectQuotas(
      [usage("production", 1)],
      [
        {
          ...account,
          storage: {
            usedBytes: 950,
            limitBytes: 1_000,
            observedAt: now.toISOString(),
            source: "current storage observation",
          },
        },
      ],
      now,
    );
    expect(result[0]).toMatchObject({ storage: { fraction: 0.95, level: "warn" } });
  });

  it("warns before one day of average runway is left even below the fraction threshold", () => {
    const early = new Date("2026-11-01T01:00:00Z");
    const result = evaluateNeonProjectQuotas(
      [{ ...usage("production", 20), observedAt: early.toISOString() }],
      [{ ...account, verifiedAt: early.toISOString() }],
      early,
    );
    expect(result[0]).toMatchObject({ compute: { level: "warn" } });
  });

  it("does not turn missing, stale, future, ambiguous or wrong-period evidence into assurance", () => {
    for (const [evidence, reason] of [
      [[], "plan_quota_unknown"],
      [[{ ...account, verifiedAt: "2026-11-01T00:00:00Z" }], "account_evidence_stale_or_future"],
      [[{ ...account, verifiedAt: "2026-12-01T00:00:00Z" }], "account_evidence_stale_or_future"],
      [[{ ...account, periodStart: "2026-11-02T00:00:00Z" }], "usage_quota_period_mismatch"],
      [[account, account], "ambiguous_account_evidence"],
      [[{ ...account, computeLimitHours: 0 }], "invalid_account_evidence"],
    ]) {
      expect(evaluateNeonProjectQuotas([usage("production", 1)], evidence, now)[0]).toMatchObject({
        status: "unknown",
        reason,
      });
    }
    expect(
      evaluateNeonProjectQuotas(
        [usage("production", 1), usage("production", 1)],
        [account],
        now,
      )[0],
    ).toMatchObject({ reason: "ambiguous_project_usage" });
    expect(evaluateNeonProjectQuotas([usage(null, 1)], [], now)[0]).toMatchObject({
      reason: "project_identity_absent",
    });
  });

  it("handles exhausted and zero consumption without invented runway", () => {
    expect(evaluateNeonProjectQuotas([usage("production", 100)], [account], now)[0]).toMatchObject({
      compute: { level: "over", remainingHours: 0 },
    });
    expect(evaluateNeonProjectQuotas([usage("production", 0)], [account], now)[0]).toMatchObject({
      compute: { level: "below_warning", estimatedDaysRemaining: null },
    });
    expect(evaluateNeonProjectQuotas([usage("production", NaN)], [account], now)[0]).toMatchObject({
      status: "unknown",
    });
  });
  it("rejects stale, future or wrong-period consumption even with fresh account evidence", () => {
    for (const observation of [
      { ...usage("production", 1), periodStart: "2026-10-01T00:00:00Z" },
      { ...usage("production", 1), periodStart: null },
      { ...usage("production", 1), observedAt: "2026-11-01T00:00:00Z" },
      { ...usage("production", 1), observedAt: "2026-12-01T00:00:00Z" },
    ])
      expect(evaluateNeonProjectQuotas([observation], [account], now)[0].status).toBe("unknown");
  });
});
