# 20260802-aws-cost-guardrails — Alert-only AWS Budgets + Cost Anomaly Detection on the infra stack

- **Status:** Accepted
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
   `alertEmail` context value (default `aaronbuxbaum@gmail.com`):
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
