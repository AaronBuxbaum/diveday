# FU-20260811-remove-rum-endpoint-workaround — Drop the explicit RUM `endpoint` once aws-rum-web fixes region substitution upstream

- **Status:** Waiting
- **Waiting on:** an `aws-rum-web` release that fixes the region/endpoint merge order reported as
  `aws-observability/aws-rum-web#881`. To check: read that package's CHANGELOG for "endpoint" or
  "region", or re-read `defaultConfig()` in the installed
  `node_modules/@aws-rum/web-slim/dist/*/orchestration/Orchestration.js`. Cheapest moment to look is
  whenever the dependency is bumped for another reason.
- **Raised:** 2026-08-11 — fixing a live 403 on every page load (`src/app/rum-client.tsx`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/rum-client.tsx`, `package.json`

## What I noticed

Every page load was POSTing to `https://dataplane.rum.us-west-2.amazonaws.com/appmonitors/<id>` and
getting back a 403 with `{"message":"Credential should be scoped to a valid region."}`, even though
the shop's app monitor and identity pool are both in `us-west-2` — wait, in the general case any
region other than `us-west-2`. Traced it into the installed `aws-rum-web@3.2.0` /
`@aws-rum/web-slim@3.2.0` packages: `web-slim`'s `defaultConfig()` hardcodes
`endpoint: DEFAULT_ENDPOINT` (`https://dataplane.rum.us-west-2.amazonaws.com`).
`aws-rum-web`'s `Orchestration` constructor spreads that default config into the object it passes
down as `partialConfig` to `web-slim`'s constructor *before* the caller's own config is applied, so
by the time `web-slim` checks `partialConfig.endpoint ? partialConfig.endpoint : DEFAULT_ENDPOINT.replace(DEFAULT_REGION, region)`,
`partialConfig.endpoint` is already truthy (the hardcoded us-west-2 URL) and the region substitution
branch never runs — for every deployment, regardless of the region actually passed to `new AwsRum(...)`.
Matches a public report at `aws-observability/aws-rum-web#881`.

Fixed by passing `endpoint: https://dataplane.rum.${config.region}.amazonaws.com` explicitly in
`src/app/rum-client.tsx`'s `AwsRum` config, which short-circuits the broken default before the bad
merge happens.

## Why it isn't already done

It is done — this is the fix, landed in the same change. The workaround itself is what should be
removed later: it's dead weight once upstream ships a release where the region argument is honored
without an explicit `endpoint`, and leaving it after that point is one more thing a future reader
has to understand is no longer necessary.

## Proposed change

Periodically (or when bumping `aws-rum-web` for another reason), check the `aws-rum-web` /
`@aws-rum/web-slim` changelog for a fix to the region-substitution order in `Orchestration`'s
constructor (the bug is that the fat orchestrator's `defaultConfig()` pre-populates `endpoint`
before the slim orchestrator's truthiness check runs). Once a release fixes it:
1. Bump `aws-rum-web` in `package.json`.
2. Remove the `endpoint: ...` line and its comment from `src/app/rum-client.tsx`.
3. Confirm real RUM traffic reaches the CloudWatch console (not just a 200 — the data plane will
   200 an event it silently drops if the endpoint and signed region genuinely don't match).

## Prompt

```text
Check whether the installed aws-rum-web / @aws-rum/web-slim version still has the region-endpoint
bug described in aws-observability/aws-rum-web#881 (defaultConfig() in
@aws-rum/web-slim/dist/*/orchestration/Orchestration.js hardcodes endpoint to
https://dataplane.rum.us-west-2.amazonaws.com, and aws-rum-web's Orchestration constructor merges
that default in before the slim constructor's `partialConfig.endpoint` truthiness check runs, so
the DEFAULT_ENDPOINT.replace(DEFAULT_REGION, region) branch never fires). If a newer aws-rum-web
release fixes this (check its CHANGELOG for "endpoint" or "region"), bump the dependency, remove
the explicit `endpoint: https://dataplane.rum.${config.region}.amazonaws.com` line and its comment
in src/app/rum-client.tsx, run `pnpm check`, and verify in a deployed environment that
dataplane.rum.<real-region>.amazonaws.com receives 200s instead of the region-mismatch 403. Delete
docs/product/follow-ups/waiting/FU-20260811-remove-rum-endpoint-workaround.md as part of the change.
```
