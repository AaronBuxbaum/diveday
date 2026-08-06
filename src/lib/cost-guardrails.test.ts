import { describe, expect, it } from "vitest";
import {
  ALERTING_LEVELS,
  CEILING_UNITS,
  COST_CEILINGS,
  COST_PROVIDERS,
  type CostCeiling,
  ceilingAlertKey,
  ceilingPercent,
  evaluateCeiling,
  evaluateCeilings,
  isAlertingLevel,
  periodBounds,
  periodKeyFor,
  type UsageSample,
} from "./cost-guardrails";

/**
 * The arithmetic here decides whether a cost problem is noticed or not, so the
 * boundaries are tested as boundaries — exactly at `warnAt`, exactly at the
 * ceiling, one unit either side — rather than with comfortable midpoints. The
 * other half of the suite is about the states that are *not* measurements:
 * every one of them must survive as itself and none may ever read as `ok`.
 */

const ceiling: CostCeiling = {
  id: "test_ceiling",
  provider: "vercel",
  metric: "billed_cost",
  unit: "usd",
  ceiling: 100,
  period: "calendar_month",
  warnAt: 0.5,
  observability: "polled",
  overflow: "bills_overage",
};

const at = new Date("2026-08-06T09:00:00.000Z");
const measured = (value: number): UsageSample => ({ status: "measured", value });

describe("evaluateCeiling — the boundaries", () => {
  it("is ok below the warning fraction, including exactly zero", () => {
    expect(evaluateCeiling(ceiling, measured(0), at).level).toBe("ok");
    expect(evaluateCeiling(ceiling, measured(49.99), at).level).toBe("ok");
  });

  it("warns exactly at the warning fraction, not one cent later", () => {
    // 50 is 0.5 of 100. `>=`, deliberately: warnAt is the level you wanted to
    // hear about, not the first value past it.
    expect(evaluateCeiling(ceiling, measured(50), at).level).toBe("warn");
    expect(evaluateCeiling(ceiling, measured(50.01), at).level).toBe("warn");
    expect(evaluateCeiling(ceiling, measured(99.99), at).level).toBe("warn");
  });

  it("is over exactly at the ceiling, not one cent later", () => {
    expect(evaluateCeiling(ceiling, measured(100), at).level).toBe("over");
    expect(evaluateCeiling(ceiling, measured(100.01), at).level).toBe("over");
    expect(evaluateCeiling(ceiling, measured(1_000_000), at).level).toBe("over");
  });

  it("reports the fraction and the percent it derives", () => {
    const evaluation = evaluateCeiling(ceiling, measured(63), at);
    expect(evaluation.fraction).toBeCloseTo(0.63, 10);
    expect(ceilingPercent(evaluation.fraction)).toBe(63);
    expect(evaluation.value).toBe(63);
    expect(evaluation.ceiling).toBe(100);
  });

  it("carries the ceiling's static facts through unchanged", () => {
    const evaluation = evaluateCeiling(ceiling, measured(1), at);
    expect(evaluation.ceilingId).toBe("test_ceiling");
    expect(evaluation.provider).toBe("vercel");
    expect(evaluation.metric).toBe("billed_cost");
    expect(evaluation.unit).toBe("usd");
    expect(evaluation.overflow).toBe("bills_overage");
    expect(evaluation.periodKey).toBe("2026-08");
  });

  it("handles a warnAt of 1, where the only levels are ok and over", () => {
    const strict = { ...ceiling, warnAt: 1 };
    expect(evaluateCeiling(strict, measured(99.99), at).level).toBe("ok");
    expect(evaluateCeiling(strict, measured(100), at).level).toBe("over");
  });
});

describe("evaluateCeiling — everything that is not a measurement", () => {
  it("keeps not_configured as itself, with no value and no fraction", () => {
    const evaluation = evaluateCeiling(ceiling, { status: "not_configured" }, at);
    expect(evaluation.level).toBe("not_configured");
    expect(evaluation.value).toBeNull();
    expect(evaluation.fraction).toBeNull();
  });

  it("keeps unavailable as itself and carries its reason code", () => {
    const evaluation = evaluateCeiling(ceiling, { status: "unavailable", reason: "forbidden" }, at);
    expect(evaluation.level).toBe("unavailable");
    expect(evaluation.reason).toBe("forbidden");
    expect(evaluation.fraction).toBeNull();
  });

  it("keeps unobservable as itself", () => {
    expect(evaluateCeiling(ceiling, { status: "unobservable" }, at).level).toBe("unobservable");
  });

  it("never lets a non-measurement become ok", () => {
    const samples: UsageSample[] = [
      { status: "not_configured" },
      { status: "unavailable", reason: "network_error" },
      { status: "unobservable" },
    ];
    for (const sample of samples) {
      expect(evaluateCeiling(ceiling, sample, at).level).not.toBe("ok");
    }
  });

  it("downgrades a nonsense reading to unavailable rather than to a very small one", () => {
    // The subtle false all clear: a provider answering NaN or -1 has told us it
    // does not know, and 0% of the ceiling is not that answer.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, -1_000]) {
      const evaluation = evaluateCeiling(ceiling, measured(value), at);
      expect(evaluation.level, `value ${value}`).toBe("unavailable");
      expect(evaluation.reason).toBe("invalid_sample");
      expect(evaluation.fraction).toBeNull();
    }
  });

  it("refuses to divide by a broken ceiling", () => {
    const broken = evaluateCeiling({ ...ceiling, ceiling: 0 }, measured(5), at);
    expect(broken.level).toBe("unavailable");
    expect(broken.reason).toBe("invalid_ceiling");
    // The reading itself is still reported — it is the denominator that is bad.
    expect(broken.value).toBe(5);
  });
});

describe("evaluateCeilings", () => {
  it("evaluates every registry entry, sampled or not", () => {
    const evaluations = evaluateCeilings({}, at);
    expect(evaluations).toHaveLength(COST_CEILINGS.length);
    // Nothing sampled means nothing observed — never a clean bill of health.
    expect(evaluations.every((evaluation) => evaluation.level === "unobservable")).toBe(true);
  });

  it("matches samples to ceilings by id and leaves the rest unobservable", () => {
    const evaluations = evaluateCeilings({ vercel_spend: measured(1) }, at);
    const vercel = evaluations.find((evaluation) => evaluation.ceilingId === "vercel_spend");
    expect(vercel?.level).toBe("ok");
    expect(vercel?.value).toBe(1);
    const whatsapp = evaluations.find(
      (evaluation) => evaluation.ceilingId === "whatsapp_conversations",
    );
    expect(whatsapp?.level).toBe("unobservable");
  });
});

describe("periodKeyFor and periodBounds", () => {
  it("names the UTC calendar month, zero-padded", () => {
    expect(periodKeyFor("calendar_month", new Date("2026-08-06T09:00:00.000Z"))).toBe("2026-08");
    expect(periodKeyFor("calendar_month", new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
    expect(periodKeyFor("calendar_month", new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12");
  });

  it("reads the month in UTC, not the host zone", () => {
    // 2026-09-01T00:30Z is still August in every zone west of Greenwich. A
    // host-zone read here would key two different periods on two machines.
    expect(periodKeyFor("calendar_month", new Date("2026-09-01T00:30:00.000Z"))).toBe("2026-09");
    expect(periodKeyFor("calendar_month", new Date("2026-08-31T23:30:00.000Z"))).toBe("2026-08");
  });

  it("bounds the month half-open, rolling the year over at December", () => {
    const august = periodBounds("calendar_month", new Date("2026-08-06T09:00:00.000Z"));
    expect(august.start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(august.end.toISOString()).toBe("2026-09-01T00:00:00.000Z");

    const december = periodBounds("calendar_month", new Date("2026-12-15T12:00:00.000Z"));
    expect(december.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(december.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("bounds February in a leap year without a special case", () => {
    const february = periodBounds("calendar_month", new Date("2028-02-29T23:00:00.000Z"));
    expect(february.start.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(february.end.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });

  it("contains the instant it was derived from", () => {
    for (const iso of [
      "2026-01-01T00:00:00.000Z",
      "2026-02-28T23:59:59.999Z",
      "2026-06-15T13:59:59.999Z",
      "2026-12-31T23:59:59.999Z",
    ]) {
      const instant = new Date(iso);
      const { start, end } = periodBounds("calendar_month", instant);
      expect(start.getTime()).toBeLessThanOrEqual(instant.getTime());
      expect(end.getTime()).toBeGreaterThan(instant.getTime());
    }
  });
});

describe("alert identity", () => {
  it("alerts only on warn and over", () => {
    expect(isAlertingLevel("warn")).toBe(true);
    expect(isAlertingLevel("over")).toBe(true);
    for (const level of ["ok", "not_configured", "unavailable", "unobservable"] as const) {
      expect(isAlertingLevel(level)).toBe(false);
    }
    expect([...ALERTING_LEVELS]).toEqual(["warn", "over"]);
  });

  it("keys an alert by ceiling, period, and level", () => {
    const evaluation = evaluateCeiling(ceiling, measured(60), at);
    expect(ceilingAlertKey(evaluation, "warn")).toBe("usage-ceiling/test_ceiling/2026-08/warn");
  });

  it("gives warn and over different keys, so escalating is its own news", () => {
    const evaluation = evaluateCeiling(ceiling, measured(60), at);
    expect(ceilingAlertKey(evaluation, "warn")).not.toBe(ceilingAlertKey(evaluation, "over"));
  });

  it("gives the same ceiling a fresh key each period", () => {
    const august = evaluateCeiling(ceiling, measured(60), new Date("2026-08-06T00:00:00.000Z"));
    const september = evaluateCeiling(ceiling, measured(60), new Date("2026-09-06T00:00:00.000Z"));
    expect(ceilingAlertKey(august, "warn")).not.toBe(ceilingAlertKey(september, "warn"));
  });
});

describe("ceilingPercent", () => {
  it("rounds to a whole percent", () => {
    expect(ceilingPercent(0.6349)).toBe(63);
    expect(ceilingPercent(0.635)).toBe(64);
    expect(ceilingPercent(1.5)).toBe(150);
  });

  it("passes null through rather than inventing a zero", () => {
    expect(ceilingPercent(null)).toBeNull();
  });
});

describe("the registry itself", () => {
  it("uses unique, stable, machine-shaped ids", () => {
    const ids = COST_CEILINGS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it("states a positive ceiling and a warning strictly inside it", () => {
    for (const entry of COST_CEILINGS) {
      expect(entry.ceiling, entry.id).toBeGreaterThan(0);
      expect(Number.isFinite(entry.ceiling), entry.id).toBe(true);
      // A warnAt of 0 would warn on an empty month; above 1 could never fire
      // before `over` does, which would make the warning dead code.
      expect(entry.warnAt, entry.id).toBeGreaterThan(0);
      expect(entry.warnAt, entry.id).toBeLessThanOrEqual(1);
    }
  });

  it("holds no prose — codes only, this being src/lib", () => {
    for (const entry of COST_CEILINGS) {
      expect(COST_PROVIDERS, entry.id).toContain(entry.provider);
      expect(CEILING_UNITS, entry.id).toContain(entry.unit);
      expect(entry.metric, entry.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });

  it("names at least one ceiling nothing can measure, rather than omitting it", () => {
    // The honest half of the registry. An entry we cannot poll still belongs
    // here — leaving it out would make the table read as full coverage.
    const consoleOnly = COST_CEILINGS.filter((entry) => entry.observability === "console_only");
    expect(consoleOnly.length).toBeGreaterThan(0);
  });

  it("marks the one ceiling whose overflow is downtime rather than money", () => {
    const suspends = COST_CEILINGS.filter((entry) => entry.overflow === "suspends");
    expect(suspends.map((entry) => entry.id)).toContain("neon_compute");
    // And it warns earlier than a ceiling that merely costs money.
    const spend = COST_CEILINGS.find((entry) => entry.id === "vercel_spend");
    const neon = COST_CEILINGS.find((entry) => entry.id === "neon_compute");
    expect(neon?.warnAt).toBeLessThan(spend?.warnAt ?? 1);
  });
});
