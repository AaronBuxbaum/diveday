# AWS migration dossier

An inventory of everything DiveDay buys from a vendor that is not AWS, what the AWS replacement
would be, and what each swap costs and buys. **Nothing here is decided.** Every row is written so
the owner can answer it with a yes, a no, or a trigger condition; the answers land in
[human-decisions.md](../product/human-decisions.md#decision-register) (H-45), and anything that
gets a yes and is hard to reverse then gets its own ADR.

Dated 2026-08-12. Re-read the numbers before acting on them — vendor pricing moves, and the
spend figures this repo holds are *guardrails we chose*, not bills we paid (see
[cost-guardrails-runbook.md](../engineering/cost-guardrails-runbook.md)).

## How to read a row

Each row is `AWS-n`, and carries: what it replaces, what it buys, what it costs in money and in
work, what it risks, and a recommendation with the condition that should change it. Rows are
grouped by whether they stand alone or depend on the hosting decision — that grouping is the most
useful thing in this document, because **most of the value here is available without migrating
anything**.

---

## Where we already are

More of DiveDay runs on AWS than on any other vendor. Everything below is live in
[`infra/lib/infra-stack.ts`](../../infra/lib/infra-stack.ts):

| Capability | AWS service | Section |
| --- | --- | --- |
| Transactional email | SES + SNS delivery events | §8 |
| Courtesy SMS + delivery receipts | SNS + CloudWatch → forwarder → SNS | §9, §10 |
| Address lookup | Location Service geo-places | §12 |
| App logs, metric filters, alarms, dashboard, saved queries | CloudWatch Logs | §13 |
| Real-user monitoring | CloudWatch RUM | §13 |
| Visual-regression baselines | S3 | §1 |
| Scheduled backup destination | S3 (versioned, retained) | §11 |
| Every credential the app reads | Secrets Manager (one filled-in `.env.example`) | §16 |
| Cost guardrails | Budgets + Cost Anomaly Detection | §7 |
| CI deploy federation | IAM OIDC for GitHub Actions | §18 |

So this is not a greenfield migration. It is finishing one that is most of the way done.

## What is still off AWS

| Vendor | What we buy | How coupled the code is |
| --- | --- | --- |
| **Vercel** | Compute, CDN, image optimizer, five cron schedules, Blob object storage, Analytics, Speed Insights, DNS, per-PR preview deploys, instant rollback, build-time migrations | Deep but *seam-shaped*. Named couplings: `vercel.json` crons, `scripts/vercel-build.mjs`, `src/lib/storage/` + `blob-host.ts` + `next.config.ts` `remotePatterns`, `src/lib/analytics.ts`, `src/app/observability-client.tsx`, `src/lib/request-ip.ts` (trusted-proxy policy), `src/lib/cron-schedule.ts` (asserts lockstep with `vercel.json`), `VERCEL_GIT_COMMIT_SHA` in `/api/health`, `maxDuration` budgets on the streaming and cron routes |
| **Neon** | Production Postgres, PITR, branch-from-timestamp restore, LISTEN/NOTIFY for the manifest stream | Only through `DATABASE_URL`/`DATABASE_URL_UNPOOLED` and the documented connection ceiling ([realtime-manifest-events-runbook.md](../engineering/realtime-manifest-events-runbook.md)). The driver is stock `drizzle-orm/node-postgres` |
| **Sentry** | Thrown exceptions (server + client), source-map symbolication, release attribution, issue grouping, one cron monitor | `next.config.ts` `withSentryConfig`, `src/instrumentation*.ts`, `src/app/global-error.tsx`, one explicit check-in in `/api/cron/reminders` |
| **Upstash** | Distributed rate-limit store — **currently unset**, so the in-memory store is what runs | One `RateLimitStore` implementation behind an interface |
| Stripe, Meta (WhatsApp), Open-Meteo, GitHub | Payments, a shop's own WhatsApp sender, marine forecast, CI and code | Not replaceable by AWS. Out of scope — see [What stays](#what-stays) |

---

## Tier A — observability, and none of it needs a migration

These pay off on Vercel today and shrink whatever cutover eventually happens. This is where the
canaries-and-logging ask lands.

### AWS-1 — CloudWatch Synthetics canaries

**Replaces:** nothing. It closes the one gap H-04 still names: *nothing watches DiveDay from
outside.* Every alerting path today runs inside the deployment it is watching, so the outage that
takes the app down takes the alarm with it. The incident runbook has specified an external monitor
since 2026-08-06 and one has never been stood up.

**What it is:** three canaries, not one.

1. **Heartbeat** — `GET /api/health` every 5 minutes. The route already answers `{status, commit}`
   with a 503 on database failure and is deliberately unauthenticated for exactly this caller.
2. **Public schedule renders** — load `/s/<slug>` in headless Chromium every 15–30 minutes and
   assert a departure card is on the page. Catches the class the heartbeat cannot: the app is up,
   the database answers `select 1`, and the page is blank — which is a *live* failure mode here,
   since a diver Client Component missing its `DiverIntlProvider` degrades to a blank client-only
   **200** (`src/i18n/provider-coverage.test.ts` guards the code path; nothing guards production).
3. **Booking flow** — a multi-step browser canary walking a departure to the point of checkout.
   The most valuable and the most expensive; see the risk note.

Run them from a region that is not the app's, so a regional failure is visible rather than shared.
Alarms feed the SNS topic that already terminates at `alerts@dive.day`. Failures capture
screenshots and a HAR automatically, which is the part no log line gives you.

**Money:** $0.0012 per run after 100 free runs/month, plus the Lambda, S3, Logs and metric charges
each run also incurs. Heartbeat at 5 min is ~8,640 runs ≈ $10/month; the two browser canaries at
30 min add ~$3.50 between them. Budget **$15–25/month all-in** for the three.

**Work:** one new CDK section, an artifacts bucket, and alarm wiring — about a day for the
heartbeat. The browser canaries are Playwright-shaped scripts that need maintaining like the `e2e/`
suite, and they are the ongoing cost, not the dollars.

**Risks, both real:**
- *A booking canary that runs in production creates real bookings.* It would land on a real shop's
  manifest, fire real notifications, and count in real reports. This needs a synthetic tenant —
  a canary-only shop — decided before the canary is written, not after.
- *Alert fatigue.* Alarm the browser canaries on two consecutive failures, the heartbeat on one.
- *A us-east-1 failure takes CloudWatch with it.* Canaries in another region narrow this but do not
  eliminate it. Truly independent watching means a non-AWS monitor, which is a different (and
  cheap) answer to the same question — worth an explicit owner call.

**Recommendation: yes, phased.** Heartbeat first — it is a day's work, it costs $10/month, and it
closes a gap that has been open and named for six days. Browser canaries once the synthetic-tenant
question is answered.

### AWS-2 — Status page

**Replaces:** the other half of H-04's open item.

**What it is:** a static page in S3 behind CloudFront in a *different region* from the app, whose
content is written by a Lambda subscribed to the canary alarms' state changes via EventBridge.

**Money:** cents. **Work:** half a day once AWS-1 exists.

**Risk:** a status page maintained by hand lies during exactly the incident it exists for. Drive it
from alarm state or do not build it.

**Recommendation: yes, immediately after AWS-1.** It is nearly free once the canaries emit state.

### AWS-3 — Error monitoring: what it would take to leave Sentry

This is worth being precise about, because the honest answer is *not yet, and here is the part to
do now anyway*.

**What Sentry does that CloudWatch Logs does not:**

| Sentry capability | CloudWatch equivalent | Verdict |
| --- | --- | --- |
| Groups occurrences into issues with counts and first/last seen | `stats count() by fingerprint` in Logs Insights — but only if we compute a fingerprint at capture time | Buildable |
| Symbolicates minified client stacks against uploaded source maps | **None.** We would upload maps to S3 and resolve frames ourselves at capture time | Expensive, and it is the real blocker |
| Attributes an error to a release | We already log `commit`; wiring it into every capture is small | Buildable |
| Alerts once per *new* issue, not once per occurrence | Metric filters alarm on *rates*. "A brand-new error appeared once" is not expressible without a per-fingerprint metric, which is unbounded cardinality | Not practical |
| Captures client-side uncaught exceptions and rejections | Needs a new `/api/errors` route and a small client handler | Buildable, and cheap |
| Cron check-in ("did the tick run at all") | A missing-data alarm on a per-pass success metric answers the same question | Buildable, and cheap |

**Money:** Sentry is on the free tier — the `sentry_errors` ceiling in `src/lib/cost-guardrails.ts`
is 50,000 events/month. Leaving saves **$0**. This is a lock-in and data-residency decision, not a
cost one.

**Recommendation: keep Sentry, and remove the two dependencies that would block a later exit.**
Concretely, **AWS-3a**:

1. Add `POST /api/errors` — client errors go through `log()` and the existing CloudWatch pipeline,
   with `redactCapabilityUrl` applied at the same seam that already protects Analytics and RUM.
   The app then has its own record of every client error, independent of any vendor.
2. Add a missing-data alarm per scheduled pass ("no successful `cron_*` completion in 25 hours").
   That makes the Sentry Cron Monitor redundant and removes the one Sentry feature the app calls
   into explicitly.

After AWS-3a, Sentry is a pure add-on: delete `withSentryConfig` and the app loses symbolication
and issue grouping, and nothing else. **Revisit leaving when** the bill stops being zero, or when
someone actually wants to build symbolication.

**Work for AWS-3a:** two days. **This is the highest-leverage item in Tier A after the heartbeat
canary** — it is the difference between "we could leave Sentry" and "leaving Sentry is a project."

### AWS-4 — Distributed tracing (X-Ray or OTel → CloudWatch)

**Replaces:** nothing. New capability: "why was this request slow", across route → Drizzle →
Stripe, which today is answerable only by correlating log lines by hand.

**Money:** roughly $5 per million traces at the default sampling; small here. **Work:** medium, and
it is *hosting-shaped* — on Lambda or ECS it is close to free to switch on, on Vercel it is a
bolt-on exporter we would rebuild after a move.

**Recommendation: defer until AWS-5 is answered.** Doing it twice is the only way to get this wrong.

---

## Tier B — the migration proper

Nothing in this tier should start before AWS-5 is decided, with two deliberate exceptions
(AWS-8 and AWS-9) that are flagged as independent.

### AWS-5 — Compute and hosting

The decision everything else hangs off. Four options:

| Option | Fit | The catch |
| --- | --- | --- |
| **OpenNext + CDK** (Lambda + CloudFront + S3) | Closest to Vercel's semantics; Next 16 is supported since the stable Build Adapters API in 16.2, built in collaboration with the OpenNext team | **Streaming is described by OpenNext's own docs as extremely experimental and not recommended in production.** This app streams two ways: the manifest SSE route (`maxDuration = 300`, a boat tablet's live roll call) and `cacheComponents` PPR on essentially every route. Also inherits the ISR revalidation pipeline (SSR Lambda → SQS → worker → S3 → CloudFront invalidation), whose most common production failure is silently stale content |
| **ECS Fargate + ALB + CloudFront** running `next start` | Boring. No adapter between us and the framework. SSE works natively, PPR works as Next intends, `instant = true` behaves as designed | A cost floor instead of usage-based pricing (~$25–40/month for a small always-on pair), and per-PR previews must be built rather than bought |
| **AWS Amplify Hosting** | The closest like-for-like swap — managed Next.js with per-PR preview branches built in | Least control, and its Next.js support has historically trailed the framework |
| **App Runner** | Simpler than ECS | Weaker CDN integration and less request-level control |

**Recommendation if we move: ECS Fargate + CloudFront.** The manifest stream is a safety-adjacent
surface a boat depends on, and "streaming is experimental, not recommended in production" is
disqualifying for it. Paying a small always-on floor to keep the framework's own runtime semantics
is the right trade at this scale.

**Work: 2–4 weeks**, and that estimate only holds if AWS-6 and AWS-14 are answered inside it.

**The honest counter-argument, stated once:** at DiveDay's current scale this move probably
*increases* both cost and operational surface. Vercel's build/preview/rollback loop is a product;
the ECS equivalent is three or four services we operate. "Simplification" and "avoiding vendor
lock-in" pull in opposite directions here. The cheapest defence against lock-in is the one this
codebase already practices — every vendor sits behind a seam — and that defence is *already paid
for*. Migrate when a specific pain (cost, a capability ceiling, a compliance requirement) names
itself, not on principle.

### AWS-6 — Per-PR preview deployments

The single biggest quality-of-life loss in a move, and the one most often discovered late. Vercel
previews are named a *required* visual-validation input in
[20260718-vercel-hosting](decisions/20260718-vercel-hosting.md).

Worth noting that the claim has partly aged out: visual baselines are rendered by CI's Linux
runners and compared per-PR by reg-suit — a preview URL is not what produces them. So the real
question is narrower: *do we still need a clickable per-PR URL?*

Options: Amplify (buys it back), a per-PR ECS service plus a Neon/Aurora branch (expensive and
slow), or accept that CI's e2e and visual fleet is the evidence and previews go away.

**Recommendation:** decide this *before* AWS-5, not after. It may be what selects Amplify.

### AWS-7 — Postgres: Neon → Aurora Serverless v2

**Buys:** one fewer vendor, a VPC-private database, IAM auth, native PITR, and cheaper storage
($0.10/GB-month vs Neon's $0.35). It also removes the manifest stream's documented Neon connection
ceiling.

**Costs:** Neon's compute is cheaper per hour ($0.106/CU-hour vs ~$0.12/ACU-hour), and Aurora's
scale-to-zero resumes in roughly fifteen seconds — fine for dev, unacceptable for a diver hitting a
booking page. That means a real minimum-ACU floor (0.5 ACU ≈ $43/month) against Neon's genuinely
usage-based bill. And **Neon's branch-from-timestamp restore is better than snapshot + PITR** for
the drill this repo actually documents in
[backup-and-restore-runbook.md](../engineering/backup-and-restore-runbook.md).

**Recommendation: last, and only if triggered.** Triggers worth naming now: the Neon bill exceeding
the Aurora floor, the manifest connection ceiling actually being hit in production, or a
requirement that the database not be reachable from the public internet. Absent one of those, Neon
is currently both cheaper and better at the thing we most need it to be good at.

### AWS-8 — Object storage: Vercel Blob → S3 + CloudFront *(Delivered)*

**Status: Delivered 2026-08-27**, a day after the writing half. Vercel Blob has been completely removed and replaced by AWS S3 (`MediaStorageBucket` + `diveday-media-uploader` IAM User with SigV4 signed requests in `src/lib/storage/s3.ts`), and reads now go through a CloudFront distribution in front of it.

**What the reading half had to work around, because it shapes the design.** For a day this heading said "S3 + CloudFront" and "Delivered" while only S3 existed: the bucket was `BLOCK_ALL` with no policy and no distribution, `MEDIA_PUBLIC_URL_BASE` pointed at the bucket's own REST endpoint, and that URL is what the app stores in every `*_image_url` column and renders to browsers — so every photo uploaded since the cutover answered **403 to every viewer** (issue #1013). The obvious fix was not available: this one flat bucket also holds `import-waivers/` and `import-receipts/`, imported medical and financial scans read only server-side by the export bundler, and keys are namespaced by content type rather than by shop. A public-read bucket policy would have published them.

So the distribution serves an **allowlist**: an Origin Access Control, a bucket policy granting `s3:GetObject` to that distribution alone, and cache behaviours for exactly `courses/*`, `recap/*`, `dive-sites/*` and `shop-logos/*` (`PUBLIC_MEDIA_PREFIXES`, infra §11b). The default behaviour points at an origin on a reserved TLD that can never resolve, so anything unmatched — `import-*` included — reaches no origin at all rather than being forwarded to the bucket; a new public prefix is opt-in. The viewer gets a gateway error rather than a tidy 403, which is the trade for keeping this configuration rather than a CloudFront Function nobody legitimate would ever exercise. `infra/lib/media-distribution.test.ts` asserts all of that against the synthesized template. `MEDIA_PUBLIC_URL_BASE` is the distribution domain, which `isManagedStorageUrl` already accepts.

**The distribution is behind `cloudfrontVerified` in `cdk.json`, off until AWS verifies the account.** CloudFront refuses `CreateDistribution` on an account with no distribution history until a Support case lifts the gate (manual action `cloudfront-account-verification`), and a template that carries the distribution regardless fails every deploy at that resource and rolls back everything else with it. With the value `false` the stack ships the bucket and the uploader alone and `MEDIA_PUBLIC_URL_BASE` is the bucket's REST endpoint — the same 403 as before, now deliberate. Flipping the value to `true` once `aws cloudfront list-distributions` stops answering `AccessDenied` is the whole re-enable; the bucket is never opened to compensate.

**Still true of the bucket:** no versioning, so a deleted or overwritten object is gone — the same posture Vercel Blob had, recorded in `docs/engineering/backup-and-restore-runbook.md` §3.

The seam is provider-neutral: `ImageStorageProvider` in `src/lib/storage/`, `isManagedStorageUrl` in `blob-host.ts`, and S3 `remotePatterns` in `next.config.ts`. S3 bucket `diveday-media` and the scoped IAM uploader credential exist in the stack.

**Buys:** Moves all media assets (course media, recap memories, dive site briefing imagery, shop logos, imported waiver scans) into DiveDay's AWS system of record. Cuts storage cost by 6.5x ($0.023/GB in S3 vs $0.15/GB in Blob) and eliminates Vercel Blob as a vendor dependency. Diver certification card uploads were retired in ADR 20260811-retire-the-digital-card.

**Completed:** S3 provider implementation (`s3ImageStorageProvider` + `deleteS3Image`), environment registry configuration (`MEDIA_*`), CSP & `next/image` allowlists, CDK stack bucket provisioning, and the CloudFront read path with its prefix allowlist.

### AWS-9 — Scheduled jobs: Vercel Cron → EventBridge Scheduler *(independent of AWS-5)*

Five schedules in `vercel.json` today, each hitting an HTTPS route guarded by `CRON_SECRET`.

**Buys:** EventBridge Scheduler calls an HTTPS endpoint directly with a Secrets Manager connection,
so **the route handlers do not change at all**. It adds built-in retries and a dead-letter queue,
and every invocation becomes a CloudWatch metric — which is most of AWS-3a's cron half for free.
It also removes a constraint the code currently documents: `src/lib/cron-schedule.ts` explains that
the daily cadence is a *hosting-plan* limit, not a product choice. Sub-daily retry drains become
possible.

**Money:** pennies. **Work:** about a day in CDK.

**Risk:** two schedulers firing the same idempotent route is survivable but wasteful — it is one or
the other, and `vercel.json`'s `crons` array must be emptied in the same change.
`src/lib/cron-schedule.test.ts` currently asserts lockstep with `vercel.json`; it moves to assert
against the CDK registry.

**Recommendation: yes, independent of hosting.** Cheap, reversible, and it lifts a real constraint.

### AWS-10 — CDN, WAF, and where rate limiting lives

If AWS-5 happens, CloudFront + AWS WAF puts IP and rate rules at the edge, which is a strictly
better home for abuse control than the in-process token bucket — and it makes the (currently
unconfigured) Upstash store unnecessary, retiring a vendor nobody has had to pay yet.

`src/lib/request-ip.ts`'s trusted-proxy policy must change in the same commit:
`x-vercel-forwarded-for` gives way to CloudFront's viewer address with a trusted-hop count. Getting
this wrong turns per-IP rate limiting into per-*CDN* rate limiting, which is an outage.

**Recommendation: bundle with AWS-5. Do not do standalone.**

### AWS-11 — Vercel Analytics + Speed Insights → CloudWatch RUM and `/api/vitals`

Mostly deletion. Both replacements are already deployed and running.

**Buys:** two of the four telemetry clients in `src/app/observability-client.tsx` disappear, the
shared first-load JS budget improves, and there is one fewer place a capability URL can leak
(`docs/engineering/capability-telemetry-runbook.md` currently has to redact into three SDKs).
Speed Insights is already redundant with the Core Web Vitals pipeline; Analytics page views are
already redundant with RUM.

**The one real gap:** `src/lib/analytics.ts`'s typed custom events (`staff_recovery`,
`blockers_surfaced`, `checkout_abandoned`, …) call `track` from `@vercel/analytics/server`. They
need a new sink — `log()` plus metric filters, using machinery `infra/lib/observability.ts` already
has. Keep the typed event vocabulary exactly as it is; change only the sink.

**Work: 2–3 days.** **Recommendation: yes** — and doing it *before* any hosting move is what keeps
the cutover from losing telemetry history.

### AWS-12 — DNS: Vercel DNS → Route 53 + ACM

Trivial in isolation, and it is the switch that makes a cutover real. Do it inside AWS-5's window,
never ahead of it.

### AWS-13 — Usage probes: vendor APIs → Cost Explorer

`USAGE_VERCEL_*` and `USAGE_NEON_*` probes retire as those vendors do. A Cost Explorer probe reading
AWS spend directly would also shrink the `console_only` ceilings the cost-guardrails runbook is
honest about nobody watching. **Do it as each vendor leaves**, not before.

### AWS-14 — Deploy pipeline, migrations, and rollback

The item most often underestimated. Today: push to `main` → Vercel builds → `scripts/vercel-build.mjs`
runs the destructive-migration guard and `pnpm db:migrate` → deploy, with **Instant Rollback** in the
dashboard as the documented first recovery move in
[incident-response-runbook.md](../engineering/incident-response-runbook.md).

On AWS that becomes: GitHub Actions → ECR → a one-shot ECS task for migrations → ECS blue/green via
CodeDeploy with an automatic rollback alarm. Every property survives, but each is *re-earned* rather
than inherited — including the expand/contract discipline, which only works as a recovery mechanism
if the old task definition can still run against the new schema.

**Recommendation:** treat AWS-5, AWS-6 and AWS-14 as **one decision**, never three. A hosting move
that lands without a rehearsed rollback is a downgrade in safety regardless of what it saves.

---

## What stays

Not everything off-AWS is a migration candidate, and saying so is part of the catalog:

- **Stripe** — Connect is the product. No AWS equivalent.
- **Meta / WhatsApp Cloud API** — a shop's own sender. No AWS path exists (which is exactly why the
  SMS channel moved to SNS in 2026-08 and WhatsApp did not).
- **Open-Meteo** — marine forecast. Free, seam-isolated, replaceable in an afternoon if it dies.
- **GitHub** — code and CI, already federated into AWS by OIDC.
- **Sentry** — see AWS-3. Keep it; remove the couplings.

---

## If the answer is "eventually yes", this is the order

Each of the first five pays off **on Vercel**, and each one shrinks the eventual cutover. That is
the property worth optimising for, because it means no step is wasted if the hosting move never
happens.

| # | Item | Effort | Why here |
| --- | --- | --- | --- |
| 1 | AWS-1 heartbeat canary, then AWS-2 status page | ~1.5 days | Closes a currently-open, currently-named gap. Nothing watches from outside |
| 2 | AWS-9 EventBridge crons | ~1 day | Cheap, reversible, lifts a documented hosting-plan constraint |
| 3 | AWS-8 S3 image storage | 2–4 days | Moves diver PII into the account that is already the system of record |
| 4 | AWS-11 telemetry consolidation | 2–3 days | Mostly deletion; preserves telemetry across any later cutover |
| 5 | AWS-3a Sentry decoupling (keep Sentry) | ~2 days | Turns "leaving Sentry" from a project into a deletion |
| 6 | AWS-5 + AWS-6 + AWS-14 as one decision | 2–4 weeks | The actual migration. Do not split it |
| 7 | AWS-10 WAF, AWS-12 DNS | inside #6 | Not separable from the hosting move |
| 8 | AWS-7 Aurora, AWS-4 tracing, AWS-13 Cost Explorer | — | Trigger-driven, after the dust settles |

## What only the owner can answer

1. **Which goal ranks first — cost, lock-in, or simplification?** They conflict. At this scale AWS
   hosting is likely more expensive and definitely more operational surface, so "simplification"
   argues *against* the move while "lock-in" argues for it.
2. **What does the real bill say?** This repo holds chosen guardrails ($60/month Vercel, $300/month
   Neon compute), not actual spend. The probes exist; the numbers should be read off the vendors
   before step 6 is priced.
3. **May a production canary create real bookings?** If not, a synthetic canary-only shop has to be
   designed before AWS-1's browser canaries are written.
4. **Is a clickable per-PR preview URL still required?** (AWS-6.) It may be the whole reason to
   choose Amplify.
5. **What cutover downtime is acceptable?** DNS plus a database move is measured in minutes at best;
   a zero-downtime cutover roughly doubles AWS-5's cost.
6. **What is the monthly ceiling for observability?** Canary frequency and the RUM sample rate are
   both dials, and both should be set by a number rather than by taste.

## Sources for the external figures

- [OpenNext on AWS — 2026 guide](https://www.buildwithmatija.com/blog/opennext-aws-honest-2026-guide) and [OpenNext streaming docs](https://opennext.js.org/aws/v2/inner_workings/streaming)
- [Next.js across platforms — the Build Adapters API](https://nextjs.org/blog/nextjs-across-platforms)
- [CloudWatch Synthetics pricing](https://cubeapm.com/blog/aws-cloudwatch-pricing-and-review/)
- [Aurora Serverless v2 scale-to-zero](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-aurora-serverless-v2-scaling-zero-capacity) and [ACU pricing / floor costs](https://www.usage.ai/blogs/aws/rds/aurora-serverless-v2/)
- [Neon 2026 pricing](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/)
