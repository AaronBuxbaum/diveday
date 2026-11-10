# H-20260907-far-diveday-migrate-onto: How far should DiveDay migrate onto AWS, and in what order?

- **Status:** Chosen
- **Human owner:** Product owner / technical owner

## Current outcome — 2026-11-10

Move hosting from Vercel to AWS, serverless first, after the go/no-go spike
[#4219](https://github.com/AaronBuxbaum/diveday/issues/4219). Keep Neon for its restore/branching
safety net and revisit the database after hosting. Containers are the fallback if the spike
fails. Per-PR preview URLs remain an open owner question. There is no user-driven cutover
downtime constraint yet because there are no users. No booking-flow canary yet; revisit when
real shops exist. The hourly demo public-schedule browser canary already exists and needs no
pilot slug. Cron operational completion stays #3838/#3691. Old cost estimates are not verified
usage quotes. No cloud deployment, purchase or credential change is authorized by this record.

Source: [owner-account decision record on #4194](https://github.com/AaronBuxbaum/diveday/issues/4194#issuecomment-6760187588).
The sections below preserve the original question and rationale, not a second unresolved worklist.

## Original question

How far should DiveDay migrate onto AWS, and in what order? The stated intent is to leave Vercel and other vendors *once it makes sense* for simplification, scaling, and lock-in — which is a per-component call, not one switch. [aws-migration-dossier.md](../../architecture/aws-migration-dossier.md) catalogs every remaining non-AWS dependency as numbered `AWS-n` rows with benefit, money, work, and risk on each.

## Minimum outcome to record

A yes, a no, or a named trigger condition against each `AWS-n` row, recorded here with the date. Six questions the dossier says only the owner can answer — goal ranking (cost vs lock-in vs simplification), the real vendor bills behind our chosen guardrails, whether a production canary may create real bookings, whether per-PR preview URLs are still required, acceptable cutover downtime, and the monthly observability ceiling — should be answered in the same pass, since several `AWS-n` rows cannot be priced without them.

## Unblocks / follow-up

The dossier's recommended sequence puts five items that pay off **on Vercel** ahead of any hosting move: AWS-1 canaries (which close the external-uptime gap H-20260724-vercel-selected-web-hosting still names above), AWS-2 status page, AWS-9 EventBridge crons, AWS-8 S3 image storage, AWS-11 telemetry consolidation, and AWS-3a Sentry decoupling. AWS-5/6/14 (hosting, previews, rollback) are one decision, not three, and AWS-7 (Neon → Aurora) is trigger-driven and last. Any row that gets a yes and is hard to reverse needs its own ADR. **Shipped 2026-09-07 (owner: build now, N-55):** the first sequencing row is done, in a smaller shape than the dossier proposed and with its reasoning in [20260907-external-uptime-monitor](../../architecture/decisions/20260907-external-uptime-monitor.md). AWS-1's **heartbeat** is a Route 53 health check rather than a Synthetics canary — genuinely external, multi-region, no Lambda or asset to maintain, `HTTPS_STR_MATCH` on `"status":"ok"` so a 200 from a parked domain or a CDN shell reads as down, alarming to `alerts@dive.day` in about four minutes and declared as `UPTIME_TARGETS` in `infra/lib/observability.ts` at $2.75/month. AWS-2's **status page** is `/status` inside the app, checking live in the request that renders it, rather than a mirrored S3 page repeating what an alarm already said; the failure a mirror would survive is the one the monitor already covers by mailing a human. **Still open on this row:** AWS-1's two browser canaries (the public schedule renders, the booking flow), both of which need question 3 above answered and a pilot shop's slug; and every other `AWS-n`.

Part of the [human decision log](README.md#decision-register).
