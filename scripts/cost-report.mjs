#!/usr/bin/env node
/**
 * Live Cost, Projections, and Infrastructure Risk Report.
 *
 * Evaluates current provider spend baselines, configured usage guardrails,
 * scaling cost multipliers, and architectural vulnerabilities for human operators
 * and AI agents.
 *
 * Usage:
 *   node scripts/cost-report.mjs
 *   node scripts/cost-report.mjs --json
 *   node scripts/cost-report.mjs --markdown
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseDotenv } from "./dotenv.mjs";

const ROOT = process.cwd();
const MANUAL_ENV_PATH = join(ROOT, ".env.manual");
const LOCAL_ENV_PATH = join(ROOT, ".env.local");

/** Fixed baselines and active infrastructure inventory. */
export const PROVIDER_INVENTORY = [
  {
    provider: "Vercel",
    tier: "Pro (1 seat)",
    monthlyBaseUsd: 20.0,
    variableElements:
      "Build concurrency ($40/slot), Serverless GB-hrs, Egress over 1TB, Blob storage",
    overflowBehavior: "bills_overage",
    guardrail: "vercel_spend ($60.00/mo)",
  },
  {
    provider: "Neon",
    tier: "Serverless Postgres (Free)",
    monthlyBaseUsd: 0.0,
    variableElements: "Compute unit hours, Storage over 0.5 GiB, Egress",
    overflowBehavior: "suspends",
    guardrail: "neon_compute (300 CU-hrs), neon_storage (50 GiB-mo)",
  },
  {
    provider: "AWS",
    tier: "CDK Stack (21 subsystems)",
    monthlyBaseUsd: 1.2, // Secrets Manager floor ($0.40 * 3) + CloudWatch
    variableElements: "SES ($0.10/k), SNS SMS ($0.0075/ea), CloudWatch Logs/RUM, S3, CodeBuild",
    overflowBehavior: "alert_only",
    guardrail: "AWS::Budgets::Budget ($30.00/mo) + Cost Anomaly Detection",
  },
  {
    provider: "Sentry",
    tier: "Developer (Free)",
    monthlyBaseUsd: 0.0,
    variableElements: "Error events over 50k/mo, Cron monitors",
    overflowBehavior: "drops",
    guardrail: "sentry_errors (50,000 events/mo)",
  },
  {
    provider: "Meta (WhatsApp)",
    tier: "Cloud API",
    monthlyBaseUsd: 0.0,
    variableElements: "Utility / marketing convs over 1,000 free service convs/mo",
    overflowBehavior: "bills_overage",
    guardrail: "whatsapp_conversations (1,000 convs/mo)",
  },
  {
    provider: "Stripe",
    tier: "Connect Standard",
    monthlyBaseUsd: 0.0,
    variableElements: "2.9% + $0.30 per transaction (proportional to revenue)",
    overflowBehavior: "bills_overage",
    guardrail: "none (revenue aligned)",
  },
];

export const ARCHITECTURAL_RISKS = [
  {
    id: "W-1",
    name: "Manifest SSE on Serverless",
    severity: "High",
    impact: "Boat tablet roll call disconnections and heavy serverless GB-hour compute usage",
    remedy:
      "Migrate long-lived SSE to dedicated container (ECS Fargate via AWS-5) or WebSocket gateway",
  },
  {
    id: "W-2",
    name: "Neon Free Tier Suspension",
    severity: "Critical",
    impact:
      "Endpoint suspended when CU limit reached; instant total outage for bookings & staff portals",
    remedy: "Upgrade Neon to paid Launch plan ($19/mo) prior to onboarding first live shop",
  },
  {
    id: "W-3",
    name: "Internal-Only Observability",
    severity: "High",
    impact: "If Vercel or Neon suffers an outage, in-app error reporting and alarms die with it",
    remedy: "Deploy AWS-1 CloudWatch Synthetics Heartbeat Canary in independent AWS region",
  },
  {
    id: "W-4",
    name: "Build-Time Database Migrations",
    severity: "Medium",
    impact:
      "Migrations apply during Vercel deploy while previous release is still actively serving",
    remedy:
      "Maintain strict expand/contract rules; isolate migrations to pre-deploy task in AWS cutover",
  },
  {
    id: "W-5",
    name: "Media & Scans in Third-Party Blob Storage",
    severity: "Medium",
    impact:
      "Recap photos, course media, and waiver scans in Vercel Blob cost 6.5x more than S3 and fragment residency",
    remedy:
      "Execute AWS-8 (S3 Image Storage Provider with signed CloudFront URLs to eliminate Vercel Blob)",
  },
  {
    id: "W-6",
    name: "In-Memory Rate Limiting",
    severity: "Medium",
    impact: "Token bucket resets on serverless cold starts; vulnerable to distributed scraping",
    remedy: "Configure Upstash Redis or deploy AWS WAF edge rate limiting (AWS-10)",
  },
];

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

/** Check which telemetry probes have configured tokens. */
export function auditProbeStatus(env = getEnvironment()) {
  return {
    vercel: Boolean(env.USAGE_VERCEL_TOKEN && env.USAGE_VERCEL_TEAM_ID),
    neon: Boolean(env.USAGE_NEON_API_KEY && env.USAGE_NEON_ORG_ID),
    awsBudget: true, // provisioned in CDK S7
    sentry: false, // console_only currently
    whatsapp: false, // console_only currently
  };
}

/** Compute cost and risk assessment summary object. */
export function generateCostReport(env = getEnvironment()) {
  const probeStatus = auditProbeStatus(env);
  const minBaseTotal = PROVIDER_INVENTORY.reduce((acc, p) => acc + p.monthlyBaseUsd, 0);

  return {
    timestamp: new Date().toISOString(),
    baselineMonthlySpend: {
      minimumFixedUsd: minBaseTotal,
      estimatedRangeUsd: "$21.50 – $40.00 / month",
    },
    providers: PROVIDER_INVENTORY,
    probeConfiguration: {
      vercelBillingApi: probeStatus.vercel ? "configured" : "not_configured (token unset)",
      neonConsumptionApi: probeStatus.neon ? "configured" : "not_configured (token unset)",
      awsBudgets: "deployed (AWS::Budgets::Budget $30/mo)",
      sentryStats: "console_only",
      metaWhatsApp: "console_only",
    },
    architecturalRisks: ARCHITECTURAL_RISKS,
    recommendations: [
      {
        priority: "P1",
        action:
          "Upgrade Neon to Launch plan ($19/mo) before production bookings to prevent endpoint suspension",
        vulnerabilityRef: "W-2",
      },
      {
        priority: "P2",
        action:
          "Provision AWS-1 CloudWatch Synthetics heartbeat canary for outside-in uptime alarms",
        vulnerabilityRef: "W-3",
      },
      {
        priority: "P3",
        action:
          "Migrate media & waiver scans from Vercel Blob to S3 (AWS-8) to eliminate Vercel Blob dependency",
        vulnerabilityRef: "W-5",
      },
    ],
  };
}

/** Render CLI formatted text. */
export function renderCliReport(report) {
  const lines = [];
  lines.push("================================================================================");
  lines.push("                     DIVEDAY INFRASTRUCTURE COST & RISK REPORT                  ");
  lines.push("================================================================================");
  lines.push(`Generated: ${report.timestamp}`);
  lines.push(`Baseline Monthly Run Rate: ${report.baselineMonthlySpend.estimatedRangeUsd}\n`);

  lines.push("--- PROVIDER INVENTORY & SPEND CEILINGS ---");
  for (const p of report.providers) {
    lines.push(
      `• ${p.provider.padEnd(16)} | Base: $${p.monthlyBaseUsd.toFixed(2).padStart(5)}/mo | Overflow: ${p.overflowBehavior.padEnd(13)} | Guardrail: ${p.guardrail}`,
    );
  }

  lines.push("\n--- ACTIVE TELEMETRY PROBES ---");
  lines.push(`• Vercel Billing API   : ${report.probeConfiguration.vercelBillingApi}`);
  lines.push(`• Neon Consumption API : ${report.probeConfiguration.neonConsumptionApi}`);
  lines.push(`• AWS Budgets & Anomaly: ${report.probeConfiguration.awsBudgets}`);
  lines.push(`• Sentry Stats         : ${report.probeConfiguration.sentryStats}`);
  lines.push(`• Meta WhatsApp        : ${report.probeConfiguration.metaWhatsApp}`);

  lines.push("\n--- TOP ARCHITECTURAL VULNERABILITIES & EXPENSIVE PATTERNS ---");
  for (const risk of report.architecturalRisks) {
    lines.push(`[${risk.id}] [${risk.severity.toUpperCase()}] ${risk.name}`);
    lines.push(`    Impact: ${risk.impact}`);
    lines.push(`    Remedy: ${risk.remedy}`);
  }

  lines.push("\n--- IMMEDIATE ACTION MATRIX ---");
  for (const rec of report.recommendations) {
    lines.push(`• ${rec.priority}: ${rec.action} [Ref: ${rec.vulnerabilityRef}]`);
  }
  lines.push("================================================================================");

  return lines.join("\n");
}

/** Render Markdown formatted text. */
export function renderMarkdownReport(report) {
  const lines = [];
  lines.push("# DiveDay Infrastructure Cost & Risk Assessment");
  lines.push(`*Generated at ${report.timestamp}*\n`);
  lines.push(`**Estimated Monthly Baseline:** ${report.baselineMonthlySpend.estimatedRangeUsd}\n`);

  lines.push("## Provider Spend Inventory & Guardrails");
  lines.push("| Provider | Tier | Monthly Base | Overflow Action | Configured Guardrail |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const p of report.providers) {
    lines.push(
      `| **${p.provider}** | ${p.tier} | $${p.monthlyBaseUsd.toFixed(2)} | \`${p.overflowBehavior}\` | ${p.guardrail} |`,
    );
  }

  lines.push("\n## Architectural Weaknesses & Cost Risks");
  lines.push("| ID | Severity | Vulnerability | Impact | Mitigation |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of report.architecturalRisks) {
    lines.push(`| **${r.id}** | ${r.severity} | ${r.name} | ${r.impact} | ${r.remedy} |`);
  }

  lines.push("\n## Priority Decisions");
  for (const rec of report.recommendations) {
    lines.push(`- **${rec.priority}**: ${rec.action} (*${rec.vulnerabilityRef}*)`);
  }

  return lines.join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const report = generateCostReport();

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.includes("--markdown")) {
    console.log(renderMarkdownReport(report));
  } else {
    console.log(renderCliReport(report));
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\/([^/]+)$/, "$1"))) {
  main();
}
