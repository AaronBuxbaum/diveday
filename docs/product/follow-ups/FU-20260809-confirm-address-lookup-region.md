# FU-20260809-confirm-address-lookup-region — Confirm the deployed address lookup actually returns suggestions now

- **Status:** Open
- **Raised:** 2026-08-09 — branch `claude/mobile-ui-ux-fixes-o4971v`, while fixing the reported
  "Address lookup isn't available right now" on Settings
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/address-lookup-aws.ts`, `infra/lib/infra-stack.ts`,
  `docs/architecture/decisions/20260804-aws-location-address-lookup.md`

## What I noticed

The address type-ahead on `/shop/<slug>/settings` was reported as not working. There was a real,
provable bug and it is fixed on this branch: Amazon Location's `Autocomplete` returns only a place
id, a place type and a one-line label unless the request asks for `AdditionalFeatures: ["Core"]`,
and the adapter never asked. Without it the lookup *succeeds* — real places, right order, no error —
and then writes five empty strings into the shop's address, because picking a suggestion replaces
every column. That is indistinguishable from "the lookup doesn't work" from the box.

What I could not check is the other half of the report. The staffer said they saw the sentence
"Address lookup isn't available right now", which is the `failed` branch — the adapter caught an
exception. That branch cannot be reached by the missing-`Core` bug: those requests returned 200.
So either the message was seen before some other transient (a throttle, an expired key), or the
deployment is in a region where `geo-places` is not served and *every* request 4xxs.

I have no AWS credentials in this environment and cannot call the API to tell those apart.

## Why it isn't already done

It needs someone who can read the deployment's environment and CloudWatch. The adapter already logs
the discriminating facts on every failure — `log("address_lookup.failed", "warn", { error, status })`
carries the AWS exception name and HTTP status, deliberately without the query — so the answer is a
log query, not a code change.

## Proposed change

1. In CloudWatch Logs Insights, filter the app log group for `$.event = "address_lookup.failed"`
   over the last 30 days. Nothing there ⇒ the missing-`Core` fix was the whole bug; close this.
2. If lines are present, read `error`:
   - `AccessDeniedException` / status 403 ⇒ the `diveday-places-lookup` IAM user's policy did not
     apply, or the key in Vercel is from a different user. §12 of `infra/lib/infra-stack.ts` grants
     exactly `geo-places:Autocomplete`; compare the deployed `PLACES_AWS_ACCESS_KEY_ID` against the
     Secrets Manager value.
   - `UnrecognizedClientException`, or any error at status 4xx across every request ⇒ almost
     certainly the region. `PLACES_AWS_REGION` is set from `this.region` — the CDK stack's own
     region — and Amazon Location Places is not offered everywhere. Set `PLACES_AWS_REGION`
     explicitly to a supported region rather than inheriting the stack's, and record the constraint
     in the ADR next to the existing GrabMaps note.
   - `ThrottlingException` ⇒ nothing to fix; the app already reports throttling as its own
     "resting" state, separate from failure.

Not proposing a UI change: the three states already read differently, and adding a fourth sentence
before knowing which one fires would be guessing at the copy.

## Prompt

```text
Confirm whether DiveDay's shop-address type-ahead works on the deployed environment, and fix the
config if it does not.

Read first: src/lib/address-lookup-aws.ts (the adapter and its failure logging), section 12 of
infra/lib/infra-stack.ts (the IAM user and the PLACES_AWS_* values), and
docs/architecture/decisions/20260804-aws-location-address-lookup.md.

Context that makes this non-obvious: a request that is missing `AdditionalFeatures: ["Core"]`
returns HTTP 200 with real place names and no structured address, so the feature looks healthy in
logs while filling the shop's five address boxes with empty strings. That bug is already fixed. The
open question is a *different* failure: staff reported the "isn't available right now" sentence,
which only renders when the AWS call threw. The likeliest cause is that PLACES_AWS_REGION inherits
the CDK stack's region and Amazon Location Places is not served there.

Do this: query the app's CloudWatch log group for `$.event = "address_lookup.failed"` over 30 days
and read the `error` and `status` fields (the query text itself is deliberately never logged). If
there are no such lines, the feature is healthy — say so and stop. If there are, follow the branch
table in docs/product/follow-ups/FU-20260809-confirm-address-lookup-region.md: an access-denied
means the wrong key is deployed, a repeated 4xx client error means the region does not serve
geo-places, and throttling means nothing is wrong.

Done means: either a stated confirmation that the lookup returns suggestions on the deployed
environment, or a config change (an explicit PLACES_AWS_REGION in the infra stack, or a corrected
key) plus a line in the ADR's consequences recording the region constraint.

Run `pnpm check` and `pnpm test infra -u` if infra/ changed. Delete
docs/product/follow-ups/FU-20260809-confirm-address-lookup-region.md as part of the change.
```
