#!/usr/bin/env node
/** Source inventory by default; --live additionally reads existing usage probes. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseDotenv } from "./dotenv.mjs";

const ROOT = process.cwd();
const MANUAL_ENV_PATH = join(ROOT, ".env.manual");
const LOCAL_ENV_PATH = join(ROOT, ".env.local");

/** Code inventory is not an account plan, current price, or deployment observation. */
export const PROVIDER_INVENTORY = [
  { provider: "Vercel", source: "Next.js hosting and scheduled routes", plan: "unknown" },
  { provider: "Neon", source: "PostgreSQL; org-level consumption probes", plan: "unknown" },
  { provider: "AWS", source: "CDK resources, budgets and external health alarms", plan: "unknown" },
  { provider: "Sentry", source: "Error reporting and cron monitoring", plan: "unknown" },
  {
    provider: "Meta (WhatsApp)",
    source:
      "Per-shop sender; delivered-message pricing depends on category, market and billing account",
    plan: "unknown",
  },
  { provider: "Stripe", source: "Connect payments", plan: "unknown" },
];

export const ARCHITECTURAL_RISKS = [
  {
    id: "W-1",
    name: "Manifest stream resource use",
    impact: "Viewer duration is not billed GB-hours or a database connection count.",
    remedy:
      "Measure billed execution, process count and reconnect outcomes before proposing a hosting change.",
  },
  {
    id: "W-2",
    name: "Unverified database quota headroom",
    impact:
      "Org-wide usage budgets do not establish a production project's plan, allowance or remaining quota.",
    remedy:
      "Verify production project identity, plan, reset period, current-size storage and compute allowance in the provider account.",
  },
  {
    id: "W-4",
    name: "Build-time migration overlap",
    impact: "The prior application release can serve while a migration applies.",
    remedy: "Retain expand/contract checks and verify the actual deployment path.",
  },
];

export const SOURCE_TOPOLOGY = {
  manifestRoute: "src/app/api/trips/[id]/manifest-events/route.ts",
  manifestRetirementSeconds: 240,
  listenerScope: "one per warm process with viewers",
  listenerIdleSeconds: 120,
  databaseDumpSchedule: "weekly",
  externalMonitoring: "Route 53 health checks and SNS alarms defined in infra/lib/global-stack.ts",
  media: "S3 provider implemented",
  rateLimiting:
    "Upstash credentials required by production environment registry; runtime fallback is not deployment evidence",
};

/** Read combined manual and local environment variables. */
export function getEnvironment() {
  const env = { ...process.env };
  if (existsSync(MANUAL_ENV_PATH)) {
    Object.assign(env, parseDotenv(readFileSync(MANUAL_ENV_PATH, "utf8")));
  }
  if (existsSync(LOCAL_ENV_PATH)) {
    Object.assign(env, parseDotenv(readFileSync(LOCAL_ENV_PATH, "utf8")));
  }
  return env;
}

/** Credential presence is configuration only, never proof a probe or deployment works. */
export function auditProbeStatus(env = getEnvironment()) {
  return {
    vercel: Boolean(env.USAGE_VERCEL_TOKEN?.trim() && env.USAGE_VERCEL_TEAM_ID?.trim()),
    neon: Boolean(env.USAGE_NEON_API_KEY?.trim() && env.USAGE_NEON_ORG_ID?.trim()),
    awsBudget: "unknown",
  };
}

export function generateCostReport(env = getEnvironment(), { now = new Date() } = {}) {
  const configured = auditProbeStatus(env);
  return {
    timestamp: now.toISOString(),
    mode: "source_inventory",
    currentSpend: { status: "unknown", total: null, currency: null },
    deployment: { awsBudgets: "unknown", externalMonitoring: "unknown", rateLimiting: "unknown" },
    providers: PROVIDER_INVENTORY,
    sourceTopology: SOURCE_TOPOLOGY,
    historicalEvidence: [
      {
        source: "docs/engineering/cost-guardrails-runbook.md#where-the-money-actually-goes",
        period: "August and early September 2026 invoices, as recorded in the runbook",
        currency: "USD",
        recordedAwsMonthlyAmount: 43.55,
        laterSupportAdjustment: { effectiveDate: "2026-11-02", removedUsd: 25 },
        status: "historical_documentation_not_current_measurement",
        caveat:
          "Includes variable, unattributed S3 spend. Subtracting support does not create a new invoice or fixed floor.",
      },
    ],
    probeConfiguration: {
      vercelBillingApi: configured.vercel ? "configured_not_verified" : "not_configured",
      neonConsumptionApi: configured.neon ? "configured_not_verified" : "not_configured",
      awsBudgets: "source_defined_deployment_unknown",
      sentryStats: "console_only",
      metaWhatsApp: "console_only_billing_account_and_rates_unknown",
    },
    measurements: [],
    coverageLimits: [
      "No all-provider total or current price/plan verification is available.",
      "Neon org totals are owner-budget signals, not per-project quota protection; GiB-months are not current storage size.",
      "WhatsApp chargeable delivered messages need category, recipient market, rate version and responsible billing account; conversation counts are not spend.",
      "A report timestamp is generation time, not deployment verification or invoice date.",
    ],
    architecturalRisks: ARCHITECTURAL_RISKS,
    recommendations: ARCHITECTURAL_RISKS.map(({ id, remedy }) => ({
      action: remedy,
      vulnerabilityRef: id,
    })),
  };
}

async function loadCollector() {
  const { require: tsRequire } = await import("tsx/cjs/api");
  const { collectUsageSamples } = tsRequire("../src/features/usage/index.ts", import.meta.url);
  return collectUsageSamples;
}

const MEASUREMENT_SOURCES = {
  vercel_spend: {
    source: "Vercel Billing charges API via existing FOCUS collector",
    unit: "usd",
    currency: "USD",
    currencyVerification: "collector_assumption_not_verified",
    scope: "configured team",
    plan: "unknown",
  },
  neon_compute: {
    source: "Neon consumption_history/v2/projects",
    unit: "compute_unit_hour",
    currency: null,
    scope: "configured organization, all returned projects",
    plan: "unknown",
  },
  neon_storage: {
    source: "Neon consumption_history/v2/projects",
    unit: "gib_month",
    currency: null,
    scope: "configured organization, all returned projects",
    plan: "unknown",
  },
  neon_egress: {
    source: "Neon consumption_history/v2/projects",
    unit: "gib",
    currency: null,
    scope: "configured organization, all returned projects",
    plan: "unknown",
  },
};

/** Opt-in reuse of the cron's collectors; missing or failed readings never become zero. */
export async function generateLiveCostReport(
  env = getEnvironment(),
  { now = new Date(), collect, fetcher } = {},
) {
  const report = generateCostReport(env, { now });
  const collector = collect ?? (await loadCollector());
  let samples;
  try {
    samples = await collector({ env, now, fetcher });
  } catch {
    samples = {};
  }
  const period = {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    endExclusive: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    kind: "requested_utc_calendar_month_not_invoice_period",
  };
  report.mode = "live_probes";
  report.measurements = Object.entries(MEASUREMENT_SOURCES).map(([metric, provenance]) => {
    const sample = samples[metric] ?? { status: "unavailable", reason: "missing_sample" };
    const valid =
      sample.status !== "measured" || (Number.isFinite(sample.value) && sample.value >= 0);
    const reading = valid ? sample : { status: "unavailable", reason: "invalid_sample" };
    return {
      metric,
      ...reading,
      ...provenance,
      period,
      requestedAt: now.toISOString(),
      lastVerifiedAt: null,
    };
  });
  return report;
}

/** Both formats carry the same uncertainty and provenance; neither invents a price total. */
export function renderMarkdownReport(report) {
  const lines = [
    "# DiveDay Infrastructure Cost & Risk Assessment",
    `Generated: ${report.timestamp}; mode: ${report.mode}`,
    "Current all-provider spend: unknown. Deployment status: unknown.",
    "## Source inventory (not verified account plans or deployment)",
    "| Provider | Source inventory | Plan |",
    "| --- | --- | --- |",
    ...report.providers.map((p) => `| ${p.provider} | ${p.source} | ${p.plan} |`),
    "## Probe configuration (not successful measurement)",
    ...Object.entries(report.probeConfiguration).map(([key, value]) => `- ${key}: ${value}`),
    "## Measurements",
    ...(report.measurements.length
      ? report.measurements.map(
          (m) =>
            `- ${m.metric}: ${m.status}${m.status === "measured" ? ` ${m.value} ${m.unit}` : ` (${m.reason ?? m.status})`}; source: ${m.source}; scope: ${m.scope}; plan: ${m.plan}; requested window: ${m.period.start} to ${m.period.endExclusive} exclusive; requested at: ${m.requestedAt}; currency verification: ${m.currencyVerification ?? "not a money metric"}; last verified: unknown.`,
        )
      : ["No live probes requested."]),
    "## Historical evidence (not a current bill or fixed floor)",
    ...report.historicalEvidence.map(
      (h) =>
        `- ${h.period}: ${h.currency} ${h.recordedAwsMonthlyAmount}; documented support removal ${h.laterSupportAdjustment.effectiveDate}: ${h.currency} ${h.laterSupportAdjustment.removedUsd}. Source: ${h.source}. ${h.caveat}`,
    ),
    "## Source topology",
    ...Object.entries(report.sourceTopology).map(([key, value]) => `- ${key}: ${value}`),
    "## Coverage limits",
    ...report.coverageLimits.map((limit) => `- ${limit}`),
    "## Checks before decisions",
    ...report.recommendations.map((r) => `- ${r.vulnerabilityRef}: ${r.action}`),
  ];
  return lines.join("\n");
}

export function renderCliReport(report) {
  return `DIVEDAY INFRASTRUCTURE COST & RISK REPORT\n${renderMarkdownReport(report)}`;
}

async function main() {
  const args = process.argv.slice(2);
  const report = args.includes("--live") ? await generateLiveCostReport() : generateCostReport();
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else if (args.includes("--markdown")) console.log(renderMarkdownReport(report));
  else console.log(renderCliReport(report));
}

if (process.argv[1]) {
  const directEntryUrl = pathToFileURL(resolve(process.argv[1])).href;
  let canonicalEntryUrl;
  try {
    canonicalEntryUrl = pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    // A positional argument supplied to an importer may not name a file.
  }

  if (import.meta.url === directEntryUrl || import.meta.url === canonicalEntryUrl) {
    await main();
  }
}
