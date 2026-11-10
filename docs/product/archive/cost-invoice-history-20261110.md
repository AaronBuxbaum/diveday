# Historical cost evidence and completed trimming work

Archived November 10, 2026. These are dated invoices, estimates and source changes, not a current
bill, current provider quota or verified deployment. Old daily-dump, quota and fixed-floor claims
are superseded by the [current runbook](../../engineering/cost-guardrails-runbook.md).

## Where the money actually goes

Read before proposing to "move a service to save money". **Read off the actual AWS bill for August
and the first nine days of September 2026**, not estimated from the stack — the estimate that used
to sit here was wrong by an order of magnitude on two lines, which is the reason this table now
cites an invoice.

| Line | $/month | What it buys |
| --- | ---: | --- |
| AWS Basic Support | 0 | Dropped from Business Support+ ($25) on 2026-11-02. Basic can still raise account-and-billing cases |
| Vercel Pro, one seat | 20 | Hosting, previews, crons, Analytics, Speed Insights |
| AWS S3, four buckets | 12 | Visual-regression baselines, database dumps, backups, media. **See the warning below — this is not yet attributed** |
| AWS Route 53 health check | 2.75 | The one check that runs outside the thing it checks (`infra/lib/global-stack.ts`); 30-second interval with string matching, against a non-AWS endpoint |
| AWS CloudWatch | 2.50 | Seven metrics and four alarms past the always-free ten (`infra/lib/observability.ts`) |
| AWS Secrets Manager | 1.20 | Three secrets at $0.40; `infra/lib/infra-stack.ts` §16 |
| Neon | 0 | Free tier; **suspends** past 300 CU-hours, which is the one ceiling that is an outage rather than an invoice |
| Sentry, Meta, Stripe | 0 | Free tiers and per-transaction |
| GitHub Actions | 0 | The repository is public, so runner minutes are free. They cost **wall-clock**: one run of the workflow is 24 to 26 jobs (four unit shards and the Playwright and visual shards), more than the twenty-concurrent-job cap on its own, and a run that starts while another is in flight queues behind it — a green main run on 2026-08-31 waited ten minutes for a runner before its first job started |

So the bill is about **$39 a month**, of which $20 is AWS. It was described here as $22–24 until
2026-09-10, and was about $64 while the $25 Business Support+ plan lasted (dropped 2026-11-02).

> **The $12 of S3 is a finding, not a baseline.** This table used to carry the reg-suit bucket at
> "<1" and the entire AWS floor at "2–3". The August bill says S3 alone was $11.998, on an account
> with no production traffic, with daily spikes to $2 on 23, 24, 27 and 28 August. Nothing here
> attributes that to a bucket, and there are four candidates: the visual-regression bucket (~700
> PNGs per run, every run), the daily `pg_dump` objects, the backup bucket, and media. Requests, not
> storage, are the likely shape of it. Until someone runs Cost Explorer grouped by usage type, treat
> this line as unexplained rather than as the cost of doing business. Tracked as issue #1651.
>
> **The visual bucket has been tightened, and it will not move this line.** On 2026-09-10 the
> bucket's lifecycle expiry went from 180 days to 60 and the pruner from nightly to six-hourly
> (ADR 20260826-prune-visual-bucket's second amendment). Both are storage levers, and the arithmetic
> says storage is not where the money is: the bucket's steady state is roughly ten main baselines
> plus a day and a half of branch runs — about 145 snapshots × 854 PNGs × ~250 KB, or ~31 GB, which
> is ~$0.71/month of `TimedStorage-ByteHrs`. What matches the bill is requests, exactly as the daily
> profile above suggests: ~900 Tier-1 PUTs per publishing run at $0.005/1,000 is $0.0045 a run, and
> at this repository's rate of ~26 merges plus ~65 branch commits a day that is $0.41/day, or
> ~$12.3/month — which lands on both the measured $0.38/day and the August total. Neither a
> lifecycle rule nor a pruner touches a PUT. The only lever that reaches the $12 is whether every CI
> run needs to upload every capture, which is filed separately and is still the thing to do. What
> the 60-day expiry *does* buy is a lower ceiling on a silent pruner outage: at ~19 GB a day of
> accumulation, ~$27/month instead of ~$80.

> **Update 2026-11-01: the publisher now uploads half as many objects.** `.reg/expected` is a copy of
> the whole baseline, and the publish bundle uploaded it next to `actual/` on every run, although
> the report viewer reads an expected image only for a changed or deleted item and the next run's
> baseline reads `actual/` only. `scripts/visual-build-publish-bundle.mjs` now keeps `expected/`
> files for `failedItems` and `deletedItems` only: about 1,700 fewer Tier-1 PUTs (~$0.0085) per
> publishing run. Also done, on Aaron's yes: a pull request snapshot is never anyone's baseline (every PR is keyed to its fork point on `main`), so pull request runs skip uploading `passed` actual images. Their report lists only the captures it uploaded (`partialActual: true`) and its Passed tab shows names without images; runs on `main` upload every actual image once, under its content hash (`blobs/<sha256>.png`), and skip any that already exist (ADR 20260826-prune-visual-bucket, 2026-11-04 amendment).

What moving would and would not do:

- **Vercel → AWS (Lambda + CloudFront via OpenNext, or Amplify).** Saves the $20 and costs a
  deploy pipeline this repo does not have: previews, the twelve `vercel.json` crons, Analytics and
  Speed Insights all need replacing, `scripts/vercel-build.mjs` runs the production migration, and
  ADR 20260718-vercel-hosting chose Vercel for exactly those. Weeks of agent time to save the price
  of one lunch a month, before a single shop is paying. Not worth it pre-pilot; revisit when Vercel
  usage lines (function GB-hours, bandwidth) start to show on the invoice, which they do not today.
- **Neon → RDS / Aurora Serverless v2.** Costs *more* (Aurora's floor is ~$40/month at 0.5 ACU)
  and buys durability the free tier lacks. The right move is the one `pnpm cost:report` already
  names: Neon Launch at $19/month before the first pilot shop, because the free tier's ceiling
  suspends the endpoint rather than billing.
- **AWS Business Support+ → Basic.** **Done 2026-11-02.** It saved $25 a month, the largest single
  AWS line, and costs the response-time case path. The one thing on the checklist that *required* a
  support case, `cloudfront-account-verification` in
  [manual-actions.md](../../engineering/manual-actions.md), is an account-and-billing case, which Basic Support can
  raise for free. Re-buy the plan for the response times if a pilot is imminent.
- **AWS trimming.** Real but small, and now **done** (issue #3652). Every Lambda writes to a
  managed log group that expires after a month (the last implicit one was the GitHub OIDC provider's
  handler); RUM samples one session in ten (`sessionSampleRate` in the stack and the client's
  default, `NEXT_PUBLIC_RUM_SAMPLE_RATE` overrides); and the two MCP IAM users left the stack on
  2026-09-02, so there is nothing to delete in code. `cost-guardrails.test.ts` ("AWS trimming")
  pins all three. Dollar figures here are estimates, not Cost Explorer. The largest of them was
  the `MutationDuration` metric filter, which was dimensioned by action label and would have billed
  $0.30 per distinct label — about $9/month across thirty-odd server actions — and is now one
  aggregate metric, with the per-action ranking left to the Logs Insights widget (issue #1241).
  Still a human's: confirm in the IAM console that the two `diveday-mcp-readonly-*` users no longer
  exist in the account, and read the first bill after 2026-11-02 to confirm the $25 line is
  gone; the floor is $18.55 on that assumption.

The cost worth engineering against is therefore **CI wall-clock**, not dollars — see
`.github/workflows/ci.yml`'s `changes` gate (a docs-only change skips the build, the unit, Playwright
and visual shards and the compare) and `src/test/shard-sequencer.ts` (unit shards dealt by
recorded duration rather than by count).

