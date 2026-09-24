# 20260924-one-region-in-us-east-1 — Move the whole estate to us-east-1, mail included

- **Status:** Accepted
- **Date:** 2026-09-24
- **Supersedes:** [20260910-one-region-in-us-east-2](20260910-one-region-in-us-east-2.md) — the region; its stack split stands

## Context

SES production access has now been asked for twice.
Case 178576512200471 (us-east-1, August 3–15) was refused three times with no reason and closed as final.
Case 178905641100543 (us-east-2, September 10) got the standard "tell us more" follow-up, was answered within half an hour, and was closed with no decision at all; two comments on the closed case drew no reply.
AWS Support's automated answer on case 178839371400539 (September 3) says the way forward is a **new** request that describes what changed since the refusal.

The owner has decided to file that request in us-east-1.
The sandbox is per region, so the request can only be granted in the region the identity, configuration set, event webhook and alarms are actually in — and the case text claims all of them.
Moving mail alone would leave the estate split across two regions again, and us-east-1 is where everything else already is or has to be: the Neon database (`aws-us-east-1`, H-04), Vercel's default function region (`iad1`), the Route 53 health-check metrics, and any ACM certificate a CloudFront alias would need.
DiveDay is pre-pilot with no active users (H-49), and SMS registration has not been started in any region, so nothing in the estate needs keeping and nothing slow has to be redone.

## Decision

- `PRIMARY_REGION`, `SES_REGION` and `ROUTE53_METRICS_REGION` are all `us-east-1`. `DEPLOY_REGIONS` has one entry.
- The move is a teardown: deactivate the us-east-2 receipt rule set and delete `diveday-email` there by hand (the migration script tears down the main stack only), then `pnpm infra:migrate-region --from us-east-2`, which empties and deletes the buckets, deletes `diveday-infra`, purges the secrets, bootstraps, and deploys all three stacks. The ordered steps are in [region-migration.md](../../engineering/region-migration.md).
- The production-access case is filed in us-east-1 only after every "Before you file" check in [ses-email-runbook.md](../../engineering/ses-email-runbook.md) passes there, and opens with the case history and what changed since August.
- The three constants stay separate and every manual action reads its region from them rather than spelling it, so a future forced move of mail alone is one line again.

## Alternatives considered

- **File a new case in us-east-2** — no reason to expect a different outcome from the region that just went silent.
- **Move mail alone and leave the rest in us-east-2** — the first shape of this change; it rebuilds the two-region border ADR 20260910 removed, one region away from the database.
- **Hand-verify the domain in us-east-1 and leave every stack where it is** — the reviewer would find no configuration set, webhook or alarms in the region under review.
- **An external email provider** — declined by the owner; SES stays the sole provider ([20260803-ses-sole-email-provider](20260803-ses-sole-email-provider.md)).

## Consequences

- The move deletes every bucket's contents: visual-regression baselines, backup bundles, database dumps, media and inbound mail. The first CI visual run after it has no baseline to compare against. The CloudFront distribution is replaced, so `MEDIA_PUBLIC_URL_BASE` changes and seeded media URLs 404 until a `pnpm db:reset`. CloudFront account verification is per account and is not redone.
- Sending is sandbox-only until the new case is granted, and replies bounce between the MX change and the rule-set activation.
- If us-east-1 refuses again, the likely cause is the account rather than the text or the region (new account, flagged earlier this month for CloudFront verification). The next step is then a Developer Support case asking why, not another region.
