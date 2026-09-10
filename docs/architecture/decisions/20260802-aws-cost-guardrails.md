# 20260802-aws-cost-guardrails — Alert-only AWS Budgets + Cost Anomaly Detection on the infra stack

- **Status:** Accepted, **amended 2026-08-12** (budget default $5 → $30 — see
  [Amendment](#amendment-2026-08-12--the-budget-default-moves-to-30)) and **amended 2026-09-10**
  (default $30 → $90, and the thresholds become dollars rather than percentages — see
  [Amendment](#amendment-2026-09-10--the-thresholds-become-dollars-and-the-default-moves-to-90))
- **Date:** 2026-08-02

## Context

DiveDay's only AWS footprint today is `infra/lib/infra-stack.ts`: an S3 bucket for visual-regression
baselines, the `reg-suit-bot` IAM user, the `cdk-deployer` user, and two read-only IAM users for the
AWS MCP server. Aaron is the sole operator and budgets roughly $5/month for this account. Nothing
currently notices if that account starts accumulating cost — a misconfigured lifecycle rule, a
runaway CI upload loop, or a stray resource left in a console session would go unnoticed until a
monthly bill arrived. The ask is detection, not enforcement: alert early and often, but never
auto-disable a resource, since a false-positive shutoff would be worse than an unexpected few
dollars.

## Decision

Add two AWS-native, no-server-required guardrails to the existing `DiveDay` stack, both alert-only:

1. **`AWS::Budgets::Budget`** — a `COST` budget, `MONTHLY`, limit driven by the `monthlyBudgetLimit`
   CDK context value (default `5`, USD), with five `EMAIL` notification thresholds against the
   `alertEmail` context value (default `alerts@dive.day` since 2026-08-06, when that mailbox was
   created and OPS-4's residue closed; a personal Gmail before then, which was the one alert path
   in the product still landing outside the operational inbox):
   - `ACTUAL` / `PERCENTAGE` ≥ 50% — early heads-up.
   - `ACTUAL` / `PERCENTAGE` ≥ 80% — approaching the cap.
   - `FORECASTED` / `PERCENTAGE` ≥ 100% — trending to exceed by month end, before it happens.
   - `ACTUAL` / `PERCENTAGE` ≥ 100% — at or over the target.
   - `ACTUAL` / `PERCENTAGE` ≥ 200% — the "this is outside normal bands" siren (~$10). Still just an
     email; nothing stops running at this threshold or any other.
2. **`AWS::CE::AnomalyMonitor`** (`DIMENSIONAL`, dimension `SERVICE`) + **`AWS::CE::AnomalySubscription`**
   (`DAILY` frequency, `EMAIL` subscriber, `thresholdExpression` on
   `ANOMALY_TOTAL_IMPACT_ABSOLUTE >= 1`) — AWS's ML-based cost anomaly detection, catching an
   unexpectedly fast rate of increase in any single service even while still comfortably under the
   monthly budget cap. This is the "increasing at an unexpectedly fast speed" signal the fixed
   thresholds above can't see on their own.

Both context values follow the existing `bucketName`/`userName` pattern (`infra/lib/infra-stack.ts`,
`this.node.tryGetContext(...)`) and are overridable via `--context` per
[the runbook](../../engineering/infrastructure-runbook.md).

## Alternatives considered

- **CloudWatch billing alarm on `EstimatedCharges`** — rejected: requires a one-time manual toggle
  ("Receive Billing Alerts") in account billing preferences that CDK cannot set, and it only covers
  the same fixed-threshold case `AWS::Budgets::Budget` already covers natively without that
  prerequisite.
- **SNS topic + `IMMEDIATE` anomaly frequency** — rejected for now: `IMMEDIATE` requires an SNS
  subscriber, which means a topic plus a resource policy granting `costalerts.amazonaws.com`
  publish access. On a ~$5/month, non-production-critical account, the latency win over a daily
  digest doesn't justify the extra resource and policy surface. Easy to add later if faster
  notification turns out to matter.
- **Auto-stop / auto-remediation actions (e.g. `AWS::Budgets::BudgetsAction`)** — rejected by
  explicit request: the goal is to never interrupt anything working correctly; a false positive
  shutting off infrastructure is a worse failure mode than a surprise few dollars.

## Consequences

Makes it easy to notice runaway spend or an unusual per-service cost spike days before a monthly
bill would reveal it, without any risk of the guardrail itself taking the app down. Commits us to
keeping `alertEmail` current as a real inbox (it's a plain CDK context default, not a secret, so it's
fine in the repo). Costs nothing extra to run — Budgets and Cost Anomaly Detection are both free.
Revisit if: the account grows past solo-operator scale and needs per-team or per-environment budgets,
or if daily-digest anomaly latency proves too slow and the SNS/`IMMEDIATE` path from the alternatives
above becomes worth the added resource.

## Amendment 2026-08-12 — the budget default moves to $30

`monthlyBudgetLimit` now defaults to `30`, not `5`. Nothing else in this decision changes: the
mechanisms, the five thresholds, and the alert-only posture are all as accepted.

**Why.** The original $5 was set when the account held an S3 bucket and four IAM users, all of which
are free. It has since acquired fixed monthly cost that exists whether or not anyone uses DiveDay:
the credentials secret and the app-secret seed at $0.40 each
([20260805-cdk-minted-credentials-and-manual-actions](20260805-cdk-minted-credentials-and-manual-actions.md)),
and two CloudWatch custom metrics past the always-free ten at $0.30 each
([20260806-cloudwatch-log-shipping](20260806-cloudwatch-log-shipping.md),
[20260806-cloudwatch-rum-and-vitals](20260806-cloudwatch-rum-and-vitals.md)). That is ~$1.40/month of
floor against a $5 cap — 28% — so the 50% notification was roughly two normal months of SES and SNS
away from firing on nothing at all, and the 80% one was reachable in a busy month.

A budget whose thresholds fire on cost that never changes teaches its reader to ignore it, which is
the failure this ADR's own Consequences section exists to prevent. Raising the cap restores the
thresholds' meaning: at $30 the fixed floor is under 5%, so a 50% notification once again means
something is growing that was not growing before.

**What this does not change.** It is still alert-only, and it is still a figure a human picked rather
than a figure AWS published — the same posture `src/lib/cost-guardrails.ts` documents for its own
ceilings. The number should move again when the fixed floor does; the runbook's "what this account
costs when idle" line is where that floor is tracked.

**What it does not license.** The one line here that can grow without bound is CloudWatch RUM, whose
1,000,000 events is a one-time trial rather than an always-free allowance, and whose sample rate
defaults to every session. A larger cap is more room for that to run, not a reason to stop watching
it — see the cost table in
[cloudwatch-observability-runbook.md](../../engineering/cloudwatch-observability-runbook.md).

## Amendment 2026-09-10 — the thresholds become dollars, and the default moves to $90

`monthlyBudgetLimit` now defaults to `90`, and the five notifications are `ABSOLUTE_VALUE` dollar
figures rather than `PERCENTAGE` fractions of the cap. The mechanisms and the alert-only posture are
unchanged; Cost Anomaly Detection is untouched.

**Why.** The account acquired a Business Support+ subscription at about $25/month, first billed on
2026-09-02. Read together with what the August bill actually said — rather than what this repository
had been estimating — the fixed monthly floor is now about $43.55:

| Line | $/month |
| --- | ---: |
| Business Support+ | 25.00 |
| S3, four buckets, visual-regression baselines the bulk of it | 12.00 |
| Route 53 health check (30s interval, string match, non-AWS endpoint) | 2.75 |
| CloudWatch metrics and alarms past the always-free ten | 2.50 |
| Secrets Manager, three secrets | 1.20 |
| Tax | 0.10 |
| **Floor** | **43.55** |

That floor is 145% of the $30 cap this ADR set in August. Every one of the five notifications would
have fired on the first day of every month, forever, on cost that never changes — the "guardrail
becomes noise" failure this decision was written to prevent, arriving for the third time and for the
same reason each time.

**Why dollars rather than simply a larger percentage cap.** Raising the cap alone does not fix it. A
percentage threshold is a statement about the cap, and the thing an operator wants to be told about
is the bill; the two are interchangeable only while the floor is small. At a $43.55 floor, 50% of any
cap low enough to be an early warning is *below* the cost of doing nothing, so no cap makes both the
50% notification meaningful and the 100% one reachable. Worse, a percentage re-prices every threshold
at once whenever fixed cost is added — which is precisely what happened here, with nothing in the
stack changing. An absolute figure is chosen against the floor, says what it means in the
notification email, and stays put when the cap moves.

| Notification | What it means |
| --- | --- |
| `ACTUAL` > $55 | About $11 above the floor: something is running that was not running before. The one the guardrail exists for |
| `ACTUAL` > $70 | Growth that did not stop |
| `FORECASTED` > $90 | Trending past the cap before the month ends |
| `ACTUAL` > $90 | At the cap |
| `ACTUAL` > $180 | Outside normal bands. Still just an email; nothing stops running |

**Why $90 for the cap.** Roughly twice the floor, which is the headroom the things about to start
costing money need: the media distribution, now that the account cleared CloudFront's verification
gate on 2026-09-03 and is serving photos for the first time; SES and SNS once shops send mail and
texts; CloudWatch RUM, which samples every session.

**What this does not change.** Still alert-only, and still a figure a human picked rather than one
AWS published. The two early figures are dollars against *this* floor: an account with a different
floor — a fork, or this one after the S3 line is understood — should edit them rather than scale
them. When fixed cost moves, move them with it, and update the table above.

**What it does not license.** The $12/month S3 line is the one number here to treat as a finding
rather than a baseline. This repository had been documenting the entire AWS floor as $1.60–$3.40 and
the reg-suit bucket as "<$1"; the bill says otherwise, and raising a cap explains nothing about where
it goes. That is tracked separately in issue #1651 — see
[cost-guardrails-runbook.md](../../engineering/cost-guardrails-runbook.md).
