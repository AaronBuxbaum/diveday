# Infrastructure Costs, Growth Vectors, and Resilience Risks

A living inventory of where DiveDay spends money, where costs will escalate with growth,
where the current architecture is weak, expensive, or vulnerable to failure, and how live cost
telemetry is monitored and automated.

Decisions and context:
- System shape & stack: [overview.md](overview.md)
- Multi-cloud migration roadmap: [aws-migration-dossier.md](aws-migration-dossier.md)
- Operational spend guardrails: [cost-guardrails-runbook.md](../engineering/cost-guardrails-runbook.md)
- Real-time manifest event limits: [realtime-manifest-events-runbook.md](../engineering/realtime-manifest-events-runbook.md)
- Incident response & rollbacks: [incident-response-runbook.md](../engineering/incident-response-runbook.md)
- Backup & restore posture: [backup-and-restore-runbook.md](../engineering/backup-and-restore-runbook.md)

---

## Executive Summary & Monthly Spend Baseline

DiveDay operates on a hybrid architecture: **Vercel** for frontend compute, edge routing, and
crons; **Neon** for serverless PostgreSQL; **AWS** (via AWS CDK in [infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts)) for
transactional email, SMS, backups, logs, RUM, and secret management; **Sentry** for client/server
error tracking; **Meta Cloud API** for shop-connected WhatsApp; and **Stripe Connect** for payments.

### Current Monthly Run Rate

| Provider | Current Tier / Service | Estimated Monthly Baseline | Guardrail / Hard Limit | Billing Mode |
| --- | --- | --- | --- | --- |
| **Vercel** | Pro ($20/seat/mo) + Build compute + Serverless execution + Blob | ~$20.00 – $35.00 | $60.00/mo (`vercel_spend`) | Base fee + usage overage |
| **Neon** | Serverless Postgres (Free tier) | $0.00 | 300 CU-hrs (`neon_compute`), 50 GiB-mo (`neon_storage`) | Free tier **suspends** on exhaustion; Paid meters |
| **AWS** | 21 provisioned CDK subsystems (SES, SNS, S3, CloudWatch, Secrets Manager, CodeBuild, Location) | ~$1.50 – $5.00 | $30.00/mo (`AWS::Budgets::Budget`) + Cost Anomaly Detection | Pay-as-you-go |
| **Sentry** | Developer (Free tier) | $0.00 | 50,000 events/mo (`sentry_errors`) | Free tier **silently drops** over quota |
| **Meta / WhatsApp** | Cloud API (per-shop sender) | $0.00 (under 1,000 free service convs/mo) | 1,000 convs/mo (`whatsapp_conversations`) | Per-conversation overage |
| **Stripe** | Connect Standard | Proportional to GMV (2.9% + $0.30) | None (revenue-aligned) | Per-transaction |
| **GitHub** | Actions CI (Public/Standard runners) | $0.00 | Standard quota | Per-minute overage |
| **Open-Meteo** | Marine Weather API | $0.00 | 10,000 reqs/day free | Rate limited |
| **Total Baseline** | | **~$21.50 – $40.00 / month** | | |

---

## Detailed Provider-by-Provider Cost Anatomy

### 1. Vercel

DiveDay runs Next.js 16 (App Router with Partial Prerendering and streaming SSR) on Vercel Pro.

- **Base Subscription ($20/seat/month)**:
  - 1 Pro seat for deployment and team access.
- **Build Compute & Agent Concurrency**:
  - Next.js 16 builds with TypeScript strict checking, service worker compilation (`scripts/build-service-worker.mjs`), and pre-migration guards (`scripts/vercel-build.mjs`).
  - Additional concurrent build slots cost $40/month per slot. As agent PR velocity increases, build queuing can bottleneck deploys unless extra slots or build minute overages are purchased.
- **Serverless Function Execution (GB-hours)**:
  - Standard SSR and API routes execute quickly (10–100ms).
  - *The major multiplier:* The boat manifest SSE stream (`/shop/[slug]/trips/[id]/manifest/stream`) sets `maxDuration = 300` (5 minutes) and holds serverless execution open continuously while boat crew tablets are active.
- **Fast Data Transfer (Egress Bandwidth)**:
  - 1 TB included on Pro; $0.15/GB thereafter. Public dive schedules and rich media can increase egress.
- **Vercel Blob Storage (Retired)**:
  - Vercel Blob has been completely eliminated (AWS-8 delivered 2026-08-26). All media (course media, recap photos, dive site imagery, shop logos, imported waiver scans) is stored in AWS S3 (`diveday-media`) with scoped IAM credentials.
- **Vercel Analytics & Speed Insights**:
  - Included basic tier or $10–$20/mo add-ons if event volumes exceed allowances.

### 2. Neon (Serverless Postgres)

Postgres database accessed via Drizzle ORM (`drizzle-orm/node-postgres`).

- **Current Free Plan**:
  - 0.5 GiB active storage, 1 project, shared compute.
  - *Critical risk:* When compute hours run out, Neon **suspends the endpoint**, causing complete downtime for all public booking pages and staff portals.
- **Paid Plan Transition (Neon Launch / Scale)**:
  - **Launch Plan**: $19/month base + $0.106 per Compute Unit (CU) hour.
  - **Storage**: $0.35 per GiB-month (3.5x AWS Aurora/EBS storage cost).
  - **Egress**: $0.09 per GiB.
  - **Written Data**: $0.096 per GiB written.

### 3. AWS Infrastructure (`infra/lib/infra-stack.ts`)

AWS houses 21 distinct infrastructure subsystems managed via AWS CDK:

1. **Secrets Manager (§15, §16, §17)**:
   - `diveday/env` (credentials document), `diveday/app-secret-seed`, `diveday/database-url-unpooled`.
   - Cost: $0.40/secret/month = **$1.20/month fixed floor**.
2. **S3 Buckets (§1, §11)**:
   - `diveday-vrt`: Visual regression snapshot comparisons (30-day lifecycle expiration rule + S21 pruner Lambda).
   - `diveday-backups`: Scheduled per-shop logical backup bundles (`exports/`).
   - `diveday-database-dumps`: Full-cluster `pg_dump` dumps (`dumps/`, 35-day lifecycle expiration).
   - Cost: Standard S3 storage ($0.023/GB-month) + PUT/GET API requests (fractions of a cent).
3. **CloudWatch Logs & Metrics (§13)**:
   - `/diveday/app` log group (1-month retention). First 5 GB ingestion free, then $0.50/GB.
   - Metric filters for 7 operational signals + mutation durations + Core Web Vitals (p75). Custom metrics: $0.30/metric/month after first 10 free.
   - CloudWatch Dashboard (`DivedayAppDashboard`): $3.00/dashboard/month.
   - CloudWatch Alarms: $0.10/alarm/month.
4. **CloudWatch RUM (§13)**:
   - Real User Monitoring for Core Web Vitals and client telemetry.
   - Cost: $1.00 per 100k events after 1M free tier events.
5. **SES Transactional Email (§8)**:
   - Confirmation emails, 24h reminders, waiver prompts, magic links, staff alerts.
   - Cost: $0.10 per 1,000 emails + $0.09/GB data.
6. **SNS Direct SMS & Delivery Receipts (§9, §10)**:
   - Outbound SMS notifications + CloudWatch log subscription forwarder Lambda.
   - Cost: ~$0.0075–$0.0085 per SMS in the US/Canada + carrier surcharges.
7. **AWS Location Service (§12)**:
   - Geo-places place index for dive shop and site address autocomplete.
   - Cost: $0.04 per 1,000 requests (first 10k requests/month free).
8. **CodeBuild & EventBridge Scheduler (§19, §20, §21)**:
   - Daily `pg_dump` container job running on `general1.small` ($0.005/build minute).
   - EventBridge schedulers triggering backup freshness watchdogs and VRT pruner Lambdas.
9. **Cost Guardrails (§7)**:
   - `AWS::Budgets::Budget` ($30/mo) and `AWS::CE::AnomalyMonitor` (Service Dimensional Monitor). Free.

### 4. Sentry

- **Current Developer Free Plan**:
  - 50,000 error events/month, 1 cron monitor check-in (`diveday-usage-guardrails`).
  - *Behavior at ceiling:* **Drops events silently**.
- **Paid Tier**:
  - Team plan starts at $26/month; Business plan starts at $80/month.

### 5. Meta WhatsApp Cloud API

- Per-shop Embedded Signup, but aggregate bill under DiveDay's Meta App ID.
- First 1,000 service conversations/month per Business Account are free.
- Marketing and utility messages billed per Meta country rate card (e.g. $0.015 to $0.05 per conversation).

---

## Where Costs Will Increase in the Future

### 1. Scaling Vectors (Shop & Diver Volume)

```
                       ┌─────────────────────────┐
                       │   Shop / Diver Growth   │
                       └────────────┬────────────┘
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
   │  Notifications  │     │   Media / PII   │     │ Database Query  │
   │  (SES/SNS/Meta) │     │ (Blob/S3 Cards) │     │  & CU Compute   │
   └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
            │                       │                       │
     Linear growth          Permanent storage       Steep concurrency
     per booking            accumulation            surges at check-in
```

1. **Notification Fan-out**:
   - Each booking generates 3 to 6 communications: instant booking receipt, waiver signing prompt, 24-hour departure briefing/reminder, weather update alerts, manifest check-in status, and post-trip recap/review links.
   - At 10 shops (5,000 bookings/month) -> 20,000 emails ($2.00 SES) + 5,000 SMS ($40.00 SNS) + 2,500 WhatsApp conversations ($50.00 Meta).
   - SMS is the most expensive communication channel by an order of magnitude; defaulting to email and WhatsApp keeps messaging costs bounded.

2. **Media & Scan Document Storage Accumulation**:
   - Shops and divers upload course brochure assets, dive-site maps, post-trip recap photos, and imported historical waiver scans.
   - While certification card uploads were completely retired in ADR 20260811-retire-the-digital-card (verifying by credential number instead of photos), recap photos and course media still accumulate.
   - In Vercel Blob ($0.15/GB-mo), storage is 6.5x AWS S3 standard storage ($0.023/GB-mo). Moving to S3 (AWS-8) bounds ongoing media storage overhead.

3. **Peak-Season Concurrency Surges**:
   - Dive tourism in Florida and the Caribbean experiences severe seasonal spikes (November–April).
   - Peak weekend mornings (07:00–09:00 local time) see concentrated diver check-ins, medical waiver submissions, and boat roll calls across all active shops simultaneously.
   - Neon serverless compute will scale up Compute Units (CUs) during these burst windows.

### 2. The Manifest SSE Multiplier (Boat Tablets)

- The live roll-call manifest stream (`/shop/[slug]/trips/[id]/manifest/stream`) uses Serverless Server-Sent Events (SSE).
- Each tablet on a dive boat holds an HTTP connection open for the duration of boarding and pre-dive roll call (up to 3–5 hours per trip).
- **Arithmetic:**
  - 30 shops x 2 boats x 2 crew tablets = 120 concurrent connections.
  - 120 streams x 4 hours/day = 480 serverless function-hours daily = 14,400 function-hours/month.
  - On Vercel Serverless, running 14,400 GB-hours/month exceeds basic tiers and drives substantial monthly compute overages.
  - On Neon, 120 concurrent `LISTEN/NOTIFY` channels push up against direct connection limits.

### 3. Step-Function Plan Cliffs (The "Jump" Points)

| Transition Point | Trigger Condition | Financial Impact |
| --- | --- | --- |
| **Neon Free -> Launch/Scale** | Exceeding 0.5 GB storage or ~300 CU-hours | Jump from $0 to **+$19–$69/month + usage** |
| **Sentry Free -> Team** | Exceeding 50k error events/month | Jump from $0 to **+$26/month** |
| **Vercel Pro Concurrency** | >1 active build or long-running agent workflows | Jump from $20 to **+$40/month per slot** |
| **AWS Budgets Threshold** | AWS spend exceeding $30/month limit | Triggers email siren; no automated shutdown |
| **AWS Synthetics Canaries (AWS-1)** | Implementing external uptime and booking canaries | Adds **+$15–$25/month** |

---

## Infrastructure Weak Points, Expensive Traps & Resilience Risks

### Vulnerability Matrix

```
  High Impact │
              │   [W-2] Neon Free Suspension       [W-1] Manifest SSE Serverless
              │   (Total Platform Outage)          (Connection Drop / Compute Spike)
              │
              │   [W-3] Inside-Only Observability   [W-5] PII in 3rd-Party Storage
              │   (Silent Blindness)               (Compliance & Data Residency)
              │
   Low Impact │   [W-6] In-Memory Rate Limiting     [W-4] Build-Time Migration Race
              │
              └───────────────────────────────────────────────────────────────────
                  Low Probability / Low Cost        High Probability / High Cost
```

### Deep Dive into Vulnerabilities

#### W-1: Long-Lived Manifest SSE on Serverless Functions
- **The Issue:** Serverless functions are built for ephemeral request-response lifecycles, not persistent streaming. Vercel enforces a 300-second maximum duration (`maxDuration = 300`). Boat tablets must re-establish SSE connections every 5 minutes.
- **Cost Impact:** Constant GB-hour consumption during trip operations.
- **Reliability Impact:** If an SSE reconnect fails while a boat is pulling away from the dock (intermittent cellular coverage), the crew tablet roster desynchronizes.
- **Remedy:** Migrate realtime roll-call streaming to a dedicated long-lived container (ECS Fargate via [AWS-5](aws-migration-dossier.md#aws-5--compute-and-hosting)) or managed WebSocket gateway (AWS API Gateway / AppSync).

#### W-2: Neon Free Tier Compute Suspension (Single Point of Outage)
- **The Issue:** On Neon's free tier, compute hour exhaustion does not bill overage—it **suspends the endpoint**.
- **Reliability Impact:** Immediate catastrophic failure of every public booking flow, payment capture, waiver signing, and staff dashboard across all shops simultaneously.
- **Remedy:** Must upgrade to a paid Neon plan (or Aurora Serverless v2 via [AWS-7](aws-migration-dossier.md#aws-7--postgres-neon--aurora-serverless-v2)) prior to onboarding revenue-generating shops.

#### W-3: Internal-Only Observability (The "Watching From Inside" Blindspot)
- **The Issue:** All error logging, performance telemetry, and health reporting originate from inside the Vercel/Neon deployment. If Vercel has a DNS/edge outage or Neon goes down, the alarm system itself dies.
- **Reliability Impact:** An outage can persist for hours without triggering founder alerts.
- **Remedy:** Stand up [AWS-1](aws-migration-dossier.md#aws-1--cloudwatch-synthetics-canaries) (CloudWatch Synthetics Heartbeat Canary) in a separate AWS region polling `GET /api/health` every 5 minutes.

#### W-4: Build-Time Database Migrations on Production
- **The Issue:** `scripts/vercel-build.mjs` executes `drizzle-kit migrate` during the Vercel build step on merge to `main`. Migrations apply to production *while the previous release is still actively serving*.
- **Reliability Impact:** Any non-additive migration (e.g. column drop or type change) breaks live traffic until the new build finishes deploying.
- **Remedy:** Enforce strict expand/contract migration discipline (guarded by `scripts/check-migrations.mjs`). For full AWS hosting ([AWS-14](aws-migration-dossier.md#aws-14--deploy-pipeline-migrations-and-rollback)), move migrations to a dedicated pre-deploy ECS task.

#### W-5: Media Storage in AWS S3 (Resolved)
- **Resolution:** Vercel Blob has been completely removed and replaced by AWS S3 (`diveday-media` bucket + `diveday-media-uploader` IAM User).
- **Cost & Privacy Impact:** Reduces storage costs from $0.15/GB (Vercel Blob) to $0.023/GB (AWS S3) and consolidates media assets within DiveDay's AWS system of record. (Delivered 2026-08-26 via AWS-8).

#### W-6: In-Memory Rate Limiting
- **The Issue:** Upstash Redis is currently unconfigured (`RateLimitStore` falls back to an in-memory token bucket in `src/lib/rate-limit.ts`).
- **Security Impact:** In-memory state is local to each serverless instance and resets on cold starts, diluting abuse prevention against distributed scrapers or card-testing attacks.
- **Remedy:** Provide Upstash Redis credentials or deploy AWS WAF rate-limiting rules at the edge ([AWS-10](aws-migration-dossier.md#aws-10--cdn-waf-and-where-rate-limiting-lives)).

---

## Live Cost Telemetry & Automation Integration

To prevent unexpected billing spikes and maintain actionable data for engineering agents and
human operators, DiveDay implements automated cost monitoring across both AWS and external
providers.

### How Live Cost Data is Captured

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      Daily Usage Cron (09:00 UTC)                      │
 │                     src/app/api/cron/usage/route.ts                    │
 └───────┬────────────────────────────────┬───────────────────────────────┘
         │                                │
         ▼                                ▼
┌──────────────────┐            ┌──────────────────┐
│  Vercel Billing  │            │ Neon Consumption │
│  GET /v1/billing │            │  GET /api/v2/    │
│  (FOCUS v1.3)    │            │   consumption    │
└────────┬─────────┘            └────────┬─────────┘
         │                               │
         └───────────────┬───────────────┘
                         ▼
         ┌───────────────────────────────┐
         │   src/lib/cost-guardrails.ts  │
         │   evaluateCeilings()          │
         └───────────────┬───────────────┘
                         ▼
         ┌───────────────────────────────┐
         │ Alerts: Ops Email + Sentry    │
         │ Log: cron_usage.scan_complete │
         └───────────────────────────────┘
```

1. **AWS Account Level ([infra/lib/infra-stack.ts](../../infra/lib/infra-stack.ts) §7)**:
   - `AWS::Budgets::Budget` (`MonthlyCostGuardrail`) evaluates actual and forecasted AWS charges against the $30 limit, emailing `alerts@dive.day` at 50%, 80%, 100% forecasted, 100% actual, and 200% actual.
   - `AWS::CE::AnomalyMonitor` monitors service-by-service spending spikes daily with a $1.00 impact threshold.
2. **Multi-Vendor In-App Monitor (`/api/cron/usage`)**:
   - `fetchVercelSpend` (`src/lib/usage/vercel.ts`): Queries Vercel's Billing API using FOCUS v1.3 format.
   - `fetchNeonUsage` (`src/lib/usage/neon.ts`): Queries Neon consumption history for compute units, storage byte-months, and egress bytes.
   - Deduplicated alerts sent to `OPS_ALERT_EMAIL` via SES when any ceiling crosses its `warnAt` or `1.0` ratio.

### Running Live Cost & Risk Reports

A dedicated CLI utility is provided for operators and agents to inspect live usage, current
spend, active ceilings, and architectural risks:

```bash
# Run on-demand cost and vulnerability assessment
pnpm cost:report

# Output as raw JSON for programmatic evaluation
pnpm cost:report --json

# Generate markdown table report
pnpm cost:report --markdown
```

---

## Actionable Decision Matrix

| Priority | Action Item | Effort | Cost Impact | Reliability & Risk Impact | Target Trigger |
| --- | --- | --- | --- | --- | --- |
| **P1** | **Upgrade Neon to Launch Plan** | 10 mins | +$19/month | **Eliminates database suspension threat (W-2)** | First paying dive shop onboarded |
| **P2** | **AWS-1 Heartbeat Canary** | 1 day | +$10/month | **Eliminates blind-spot during total outages (W-3)** | Immediate |
| **P3** | **AWS-8 Migrate Blob Storage to S3** | 2–4 days | -$5 to -$20/mo (at scale) | **Consolidates diver PII into AWS system of record (W-5)** | Pilot shop launch |
| **P4** | **AWS-3a Sentry Decoupling & Error Logging** | 2 days | $0 | Prevents silent error drops past Sentry free tier | Before reaching 50k events/mo |
| **P5** | **AWS-5 / ECS Fargate Manifest Container** | 2–3 weeks | Replaces Vercel Pro overages | **Eliminates serverless streaming timeout & reconnect churn (W-1)** | >15 concurrent boat operations |
