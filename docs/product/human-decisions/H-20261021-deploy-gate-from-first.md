# H-20261021-deploy-gate-from-first: When does production stop deploying commits whose CI is red?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Every push to `main` deploys and migrates production at once, whether or not its CI goes green.**
Six of 23 main pushes on 2026-10-21..23 ended red. Gating the deploy on green CI means production
lags `main` by one CI run (about 20 minutes). The 2026-10-23 code sheet (item 2, call 1) asked
when that trade starts.

## Decision

**Decided 2026-10-23 (Aaron, in the project thread: "From first real booking").** The gate is
built, tested and off now, behind the switch `DEPLOY_REQUIRES_GREEN`, and turned on at the pilot
shop's first real booking.

## What ships

`scripts/deploy-gate.mjs` and `.github/workflows/deploy-gate.yml`: with the switch on, Vercel's
push-triggered production build cancels itself before it migrates, and the workflow deploys each
commit once its CI on `main` is green. It stops push-triggered builds, and with them a red
commit's migration; it is not an access control against anyone holding a Vercel token, so the gate
has a token of its own. The switch is one name set as a GitHub repository variable
and a Vercel Production variable; unset in both is today's behavior. How to turn it on:
[deploy-and-migrations-runbook.md, "The deploy gate"](../../engineering/deploy-and-migrations-runbook.md#the-deploy-gate)
and manual action `production-deploy-gate`. Set to Implemented when the gate is on.

## Unblocks / follow-up

A human task: set the switch at the pilot shop's first real booking.

Part of the [human decision log](README.md#decision-register).
