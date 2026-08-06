import { nowDate } from "@/lib/clock";

/**
 * Every external ceiling worth watching, and the arithmetic that turns a
 * measured sample into `ok` / `warn` / `over`.
 *
 * The AWS half of this problem is already solved and is not repeated here:
 * `infra/lib/infra-stack.ts` §7 puts an `AWS::Budgets::Budget` and Cost Anomaly
 * Detection on the AWS account, alert-only, never auto-disabling (docs ADR
 * 20260802-aws-cost-guardrails). That covers the *smallest* bill DiveDay pays.
 * The larger ones — Vercel and Neon — are on other vendors' consoles, where AWS
 * Budgets cannot see and where nothing tells us anything until an invoice
 * arrives. This module is the provider-neutral half of closing that gap; the
 * probes that actually measure live in `src/lib/usage/`, and the daily poll is
 * `src/app/api/cron/usage/`.
 *
 * **Posture, mirrored deliberately from the AWS ADR: alert-only.** Nothing here
 * disables, throttles, or rate-limits anything. A guardrail that took the site
 * down because a usage API returned a bad number would be a far worse failure
 * than an unexpected bill, and every ceiling below is generous rather than
 * tight for the same reason.
 *
 * **Codes, not sentences.** This is `src/lib`, so every field is a machine key
 * and the words a human reads are chosen elsewhere — the runbook
 * (docs/engineering/cost-guardrails-runbook.md) for the operator's copy, and
 * `src/lib/notifications/email.ts` for the founder alert's body. Nothing here
 * is user-facing in the diver/staff sense, so nothing here is translated.
 */

/** Every vendor with a ceiling in this registry. */
export const COST_PROVIDERS = ["vercel", "neon", "sentry", "meta_whatsapp"] as const;
export type CostProvider = (typeof COST_PROVIDERS)[number];

/**
 * The window a ceiling is measured over.
 *
 * `calendar_month` is a deliberate approximation. Vercel and Neon both bill on
 * an account-specific anniversary, not on the first of the month, so this will
 * not reproduce an invoice — and it is not trying to. Its two jobs are to give
 * a sample a denominator and to give the alert a period to be deduplicated
 * within, and a UTC calendar month does both without needing to know anybody's
 * billing anniversary. The runbook says this out loud so nobody reconciles a
 * warning against a statement and concludes the monitor is broken.
 */
export const CEILING_PERIODS = ["calendar_month"] as const;
export type CeilingPeriod = (typeof CEILING_PERIODS)[number];

/** The unit a ceiling and its samples are both stated in. */
export const CEILING_UNITS = [
  "usd",
  "compute_unit_hour",
  "gib",
  "gib_month",
  "event",
  "conversation",
] as const;
export type CeilingUnit = (typeof CEILING_UNITS)[number];

/**
 * Whether anything in DiveDay can actually see this number.
 *
 * `polled` — a probe in `src/lib/usage/` reads it from the provider's own
 * usage API on the daily cron.
 *
 * `console_only` — the ceiling is real and the spend is real, but the only
 * place the number exists is the vendor's dashboard. Recording it here with an
 * honest label is the point: a registry that silently omitted every ceiling we
 * cannot measure would read as full coverage, which is exactly the false all
 * clear this whole change exists to avoid. These entries never evaluate to
 * `ok`; they evaluate to `unobservable`.
 */
export type CeilingObservability = "polled" | "console_only";

/**
 * What the provider actually does at the ceiling — the question that decides
 * how much a given warning is worth waking up for.
 *
 * - `bills_overage` — service continues, the invoice grows. Money, not downtime.
 * - `suspends` — the resource stops serving until the period rolls or the plan
 *   changes. This is the one that takes DiveDay down.
 * - `drops` — the provider silently discards what is over the line. Nothing
 *   breaks and nothing tells you; you simply stop having the data.
 *
 * These are the conservative reading of each vendor's documented behaviour on
 * the *lowest* plan the account might be on, because a guardrail that assumes
 * the friendlier plan is a guardrail that is wrong exactly when it matters.
 * Confirm against the current plan when reviewing the registry.
 */
export type CeilingOverflow = "bills_overage" | "suspends" | "drops";

export type CostCeiling = {
  /** Stable machine key. Appears in the alert key and the log line; do not rename casually. */
  readonly id: string;
  readonly provider: CostProvider;
  /** Machine key for the metric, matching the probe that measures it. */
  readonly metric: string;
  readonly unit: CeilingUnit;
  /** The guardrail value, in `unit`. Always a number a human chose — see below. */
  readonly ceiling: number;
  readonly period: CeilingPeriod;
  /** Fraction of `ceiling` at which to start warning. Strictly between 0 and 1. */
  readonly warnAt: number;
  readonly observability: CeilingObservability;
  readonly overflow: CeilingOverflow;
};

/**
 * The registry.
 *
 * **Every `ceiling` here is DiveDay's own chosen guardrail, not a quoted plan
 * allowance.** That distinction is the difference between a table that ages
 * gracefully and one that lies: provider free tiers and included allotments
 * change several times a year, and a number in this repo claiming to be "the
 * Neon free-tier compute allowance" would be wrong within months while still
 * looking authoritative. A number that is openly "the level at which Aaron
 * wants an email" is never wrong — it is a decision, and it is reviewed by
 * editing this array. It is the same posture as `monthlyBudgetLimit` defaulting
 * to 5 in the CDK stack: a figure someone picked, not a figure AWS published.
 *
 * Set these *above* normal running cost and below the point where a bill would
 * be a surprise. Alert-only, so there is no cost to being generous.
 */
export const COST_CEILINGS: readonly CostCeiling[] = [
  {
    // Hosting, functions, bandwidth, Analytics and Speed Insights — everything
    // on one Vercel invoice, read as one number. Deliberately the whole bill
    // rather than a per-resource breakdown: the failure this catches is "the
    // total moved", and a per-resource ceiling would need re-tuning every time
    // traffic shifted between resources without the total changing at all.
    id: "vercel_spend",
    provider: "vercel",
    metric: "billed_cost",
    unit: "usd",
    ceiling: 60,
    period: "calendar_month",
    warnAt: 0.5,
    observability: "polled",
    overflow: "bills_overage",
  },
  {
    // Neon compute. The one ceiling on this list whose overflow can take the
    // product down rather than cost money: on Neon's free plan an exhausted
    // compute allowance suspends the compute endpoint, which to DiveDay looks
    // like the database going away mid-day. Warn earlier than the others.
    id: "neon_compute",
    provider: "neon",
    metric: "compute_unit_hours",
    unit: "compute_unit_hour",
    ceiling: 300,
    period: "calendar_month",
    warnAt: 0.4,
    observability: "polled",
    overflow: "suspends",
  },
  {
    // Storage, as byte-months normalised to GiB-months — the unit Neon bills
    // in, kept rather than converted to "current size" because the two are not
    // the same number and mixing them is how a storage bill surprises somebody.
    id: "neon_storage",
    provider: "neon",
    metric: "storage_gib_month",
    unit: "gib_month",
    ceiling: 50,
    period: "calendar_month",
    warnAt: 0.6,
    observability: "polled",
    overflow: "bills_overage",
  },
  {
    // Egress. Low and slow-moving in normal operation, which is exactly why a
    // jump is worth an email: it usually means something is being fetched in a
    // loop, not that the shop got busy.
    id: "neon_egress",
    provider: "neon",
    metric: "egress_gib",
    unit: "gib",
    ceiling: 100,
    period: "calendar_month",
    warnAt: 0.6,
    observability: "polled",
    overflow: "bills_overage",
  },
  {
    // Sentry's error quota. `drops`, not `bills_overage`: past the quota Sentry
    // discards events rather than charging for them, so the failure mode is
    // that error monitoring quietly stops on the busiest day of the month and
    // nothing in DiveDay notices — the Cron Monitor dead-man's switch included,
    // since a dropped check-in and a missed run look identical from here.
    //
    // `console_only` for now. Sentry does publish an organization stats API, so
    // this could become `polled`; it needs an auth token minted and stored,
    // which is a manual step nobody has taken (see the runbook).
    id: "sentry_errors",
    provider: "sentry",
    metric: "error_events",
    unit: "event",
    ceiling: 50_000,
    period: "calendar_month",
    warnAt: 0.6,
    observability: "console_only",
    overflow: "drops",
  },
  {
    // WhatsApp conversations through Meta's Cloud API. Per-shop in effect —
    // each shop connects its own sender — but the Meta app, and therefore the
    // aggregate bill, is DiveDay's (ADR 20260802-whatsapp-cloud-api-per-shop).
    // `console_only`: Meta's usage figures live in Business Manager, and the
    // Cloud API's own endpoints report per-message delivery, not a running
    // billable total.
    id: "whatsapp_conversations",
    provider: "meta_whatsapp",
    metric: "conversations",
    unit: "conversation",
    ceiling: 1_000,
    period: "calendar_month",
    warnAt: 0.6,
    observability: "console_only",
    overflow: "bills_overage",
  },
];

export function ceilingById(id: string): CostCeiling | undefined {
  return COST_CEILINGS.find((ceiling) => ceiling.id === id);
}

/**
 * One reading of one metric.
 *
 * The four states are not interchangeable and the difference between them is
 * the whole safety property of this feature:
 *
 * - `measured` — a number came back from the provider.
 * - `not_configured` — no credential is set for this probe. The normal state
 *   for a fork, a local run, or a deployment that has not minted a token yet.
 * - `unavailable` — a credential *is* set and the read still failed: a network
 *   error, a 401, a shape the parser did not recognise. **We are blind.**
 * - `unobservable` — no probe exists; the number is only on a vendor console.
 *
 * None of the last three may ever be flattened into `ok`. A monitor that
 * reports fine because it could not measure is worse than no monitor at all:
 * it converts "nobody is watching" into "somebody is watching and it's fine",
 * which is precisely the state in which a bill grows unnoticed.
 */
export type UsageSample =
  | { readonly status: "measured"; readonly value: number }
  | { readonly status: "not_configured" }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "unobservable" };

/**
 * What a ceiling is doing right now. `ok` / `warn` / `over` are measurements;
 * the other three are admissions that no measurement happened, and they survive
 * intact all the way to the log line, the response body, and the alert.
 */
export const CEILING_LEVELS = [
  "ok",
  "warn",
  "over",
  "not_configured",
  "unavailable",
  "unobservable",
] as const;
export type CeilingLevel = (typeof CEILING_LEVELS)[number];

export type CeilingEvaluation = {
  readonly ceilingId: string;
  readonly provider: CostProvider;
  readonly metric: string;
  readonly unit: CeilingUnit;
  readonly period: CeilingPeriod;
  readonly periodKey: string;
  /** What the provider does at this ceiling. Carried so the alert needs no second lookup. */
  readonly overflow: CeilingOverflow;
  readonly level: CeilingLevel;
  /** The measured value, or null when nothing was measured. */
  readonly value: number | null;
  readonly ceiling: number;
  /** `value / ceiling`, or null when nothing was measured. */
  readonly fraction: number | null;
  /** A machine code explaining a non-measurement. Never a sentence. */
  readonly reason?: string;
};

/**
 * The period a sample taken at `instant` belongs to, as a sortable key.
 *
 * UTC, always. Every DiveDay server and CI box runs UTC and no provider bills
 * in a shop's local zone, so there is no zone here to get wrong — but it is
 * named explicitly rather than left to the host, for the same reason every
 * rendered date in this repo names its zone.
 */
export function periodKeyFor(period: CeilingPeriod, instant: Date = nowDate()): string {
  switch (period) {
    case "calendar_month": {
      const year = instant.getUTCFullYear();
      const month = `${instant.getUTCMonth() + 1}`.padStart(2, "0");
      return `${year}-${month}`;
    }
  }
}

/**
 * The half-open interval `[start, end)` a period covers, for a probe that has
 * to hand a provider a `from`/`to` pair.
 *
 * Half-open on purpose: the alternative is an inclusive end that either
 * double-counts the boundary hour or silently drops it, depending on which way
 * the provider rounds.
 */
export function periodBounds(
  period: CeilingPeriod,
  instant: Date = nowDate(),
): { start: Date; end: Date } {
  switch (period) {
    case "calendar_month": {
      const year = instant.getUTCFullYear();
      const month = instant.getUTCMonth();
      return {
        start: new Date(Date.UTC(year, month, 1)),
        // Month 12 rolls the year over on its own — Date.UTC is defined for
        // out-of-range months, so there is no December special case to forget.
        end: new Date(Date.UTC(year, month + 1, 1)),
      };
    }
  }
}

/**
 * Turn one sample into one verdict.
 *
 * Boundaries, stated rather than implied because they are the part a reader
 * will want to check:
 * - `fraction >= 1` is `over`. Exactly at the ceiling counts as over — the
 *   ceiling is the thing you did not want to reach, not the first value past it.
 * - `fraction >= warnAt` is `warn`, on the same reasoning.
 * - Everything below `warnAt` is `ok`, including exactly zero.
 *
 * A `measured` sample whose value is not a finite, non-negative number is
 * downgraded to `unavailable`, never treated as a very small reading. A
 * provider that answers `null`, `NaN`, or `-1` has told us it does not know;
 * rendering that as 0% of the ceiling would be the false all clear again, just
 * arriving through the parser instead of through a missing credential.
 */
export function evaluateCeiling(
  ceiling: CostCeiling,
  sample: UsageSample,
  instant: Date = nowDate(),
): CeilingEvaluation {
  const base = {
    ceilingId: ceiling.id,
    provider: ceiling.provider,
    metric: ceiling.metric,
    unit: ceiling.unit,
    period: ceiling.period,
    periodKey: periodKeyFor(ceiling.period, instant),
    overflow: ceiling.overflow,
    ceiling: ceiling.ceiling,
  } as const;

  if (sample.status === "not_configured") {
    return { ...base, level: "not_configured", value: null, fraction: null };
  }
  if (sample.status === "unobservable") {
    return { ...base, level: "unobservable", value: null, fraction: null };
  }
  if (sample.status === "unavailable") {
    return { ...base, level: "unavailable", value: null, fraction: null, reason: sample.reason };
  }
  if (!Number.isFinite(sample.value) || sample.value < 0) {
    return {
      ...base,
      level: "unavailable",
      value: null,
      fraction: null,
      reason: "invalid_sample",
    };
  }
  // A ceiling of zero or less has no fraction to compute and would divide to
  // Infinity. That is a bug in the registry rather than a reading, so it is
  // reported as a failure to measure and not as an instant "over".
  if (!Number.isFinite(ceiling.ceiling) || ceiling.ceiling <= 0) {
    return {
      ...base,
      level: "unavailable",
      value: sample.value,
      fraction: null,
      reason: "invalid_ceiling",
    };
  }

  const fraction = sample.value / ceiling.ceiling;
  const level: CeilingLevel = fraction >= 1 ? "over" : fraction >= ceiling.warnAt ? "warn" : "ok";
  return { ...base, level, value: sample.value, fraction };
}

/** Every ceiling in the registry, evaluated against whatever was sampled for it. */
export function evaluateCeilings(
  samples: Readonly<Record<string, UsageSample>>,
  instant: Date = nowDate(),
  ceilings: readonly CostCeiling[] = COST_CEILINGS,
): CeilingEvaluation[] {
  return ceilings.map((ceiling) =>
    evaluateCeiling(
      ceiling,
      // A ceiling nobody sampled is not `ok`. `console_only` entries land here
      // by design; a `polled` one landing here means a probe was never wired
      // up, which is a bug worth seeing rather than hiding.
      samples[ceiling.id] ?? { status: "unobservable" },
      instant,
    ),
  );
}

/** The levels that put an email in the founder's inbox. */
export const ALERTING_LEVELS = ["warn", "over"] as const;
export type AlertingLevel = (typeof ALERTING_LEVELS)[number];

export function isAlertingLevel(level: CeilingLevel): level is AlertingLevel {
  return level === "warn" || level === "over";
}

/**
 * The identity of one alert: this ceiling, this period, this level.
 *
 * Level is part of the key on purpose. A ceiling that warns on the 8th and is
 * genuinely over on the 20th is two different pieces of news, and collapsing
 * them would mean the more urgent one never sends because the milder one
 * already did.
 */
export function ceilingAlertKey(evaluation: CeilingEvaluation, level: AlertingLevel): string {
  return `usage-ceiling/${evaluation.ceilingId}/${evaluation.periodKey}/${level}`;
}

/**
 * Percentage of the ceiling, rounded to a whole number, for the places that
 * show a figure to a human. Null in, null out — never 0.
 */
export function ceilingPercent(fraction: number | null): number | null {
  return fraction === null ? null : Math.round(fraction * 100);
}
