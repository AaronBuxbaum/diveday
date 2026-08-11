# FU-20260809-confirm-address-lookup-region — Read the reason the deployed address lookup is failing, and fix that deployment

- **Status:** Open
- **Raised:** 2026-08-09 — branch `claude/mobile-ui-ux-fixes-o4971v`, while fixing the reported
  "Address lookup isn't available right now" on Settings
- **Updated:** 2026-08-11 — branch `claude/shop-address-autocomplete-error-n47nnx`, after a second
  report of the same failure. The failure now names its own cause; nobody has read the name yet.
- **Kind:** question
- **Effort:** S
- **Touches:** `src/lib/address-lookup.ts`, `src/lib/address-lookup-aws.ts`,
  `infra/lib/infra-stack.ts`, `docs/architecture/decisions/20260804-aws-location-address-lookup.md`

## What I noticed

The address type-ahead on `/shop/<slug>/settings` fails on the deployed site, reproducibly, on
every keystroke. The second report (2026-08-11) carried the server action's actual response body:

```
1:{"status":"failed"}
```

That is the adapter's catch branch — the Amazon Location `Autocomplete` call threw. It is not the
missing-`AdditionalFeatures` bug fixed on 2026-08-09 (those requests returned HTTP 200), it is not
`not_configured` (the search box only renders when all three `PLACES_AWS_*` values are set and
non-empty in the deployment, so they are set), and it is not the app's own rate limit (that has its
own `rate_limited` status). Three causes remain, and all three are in the deployment rather than in
the code:

1. the credential in Vercel is rejected or lacks `geo-places:Autocomplete`,
2. `PLACES_AWS_REGION` names a region that does not serve the Places API,
3. something else answered with an error.

Two changes on this branch narrow it. `PLACES_AWS_REGION` is now set from a named constant in §12 of
the stack instead of inheriting `this.region`, so cause 2 cannot be reintroduced by a stack that
moves — but that only fixes what a **future** deploy hands Vercel, and nobody has confirmed what the
value in Vercel is today. And the failure now classifies itself: the action returns
`{ "status": "failed", "reason": "denied" | "unreachable" | "rejected" | "unknown" }`, and the log
line carries the same reason alongside the AWS exception name, transport code and HTTP status.

## Why it isn't already done

It needs someone who can read the deployed environment. This session had no AWS access — outbound
AWS calls are blocked by policy here — so the reason code has been shipped but never observed
against the real deployment.

## Proposed change

1. Open `/shop/<slug>/settings`, type four characters into the address search box, and read the
   `reason` in the response body in the network panel. (Or query the app's CloudWatch log group for
   `$.event = "address_lookup.failed"`, which carries `reason`, `error`, `code` and `status` — the
   query text itself is deliberately never logged.)
2. Act on the reason:
   - `denied` ⇒ the credential. Compare the deployed `PLACES_AWS_ACCESS_KEY_ID` against the Secrets
     Manager value; §12 grants exactly `geo-places:Autocomplete` to `diveday-places-lookup`, so a
     key from a different user, a key minted before §12 was deployed, or a stack that has not been
     deployed since §12 was added all land here.
   - `unreachable` ⇒ the region. Set `PLACES_AWS_REGION` in Vercel to the value §12 now generates
     (`us-east-1`); the deployed value predates that constant and may be anything.
   - `rejected` ⇒ the request itself; read the AWS exception name in the log line.
   - `unknown` ⇒ read the log line before guessing.
3. Confirm the box lists real places and that picking one fills all five boxes.

Not proposing further UI work: the three states a staffer can act on already read differently, and
the reason is deliberately not shown on screen — a dive shop cannot act on `AccessDeniedException`.

## Prompt

```text
DiveDay's shop-address type-ahead fails on the deployed site: the server action at
/shop/<slug>/settings answers every keystroke with {"status":"failed"}. The cause is in the
deployment, not the code, and the code now names which one. Find it and fix the deployment.

Read first: src/lib/address-lookup.ts (classifyLookupError and the reason vocabulary),
src/lib/address-lookup-aws.ts (the adapter's catch branch), section 12 of infra/lib/infra-stack.ts
(the diveday-places-lookup IAM user and the PLACES_AWS_* values it generates), and
docs/architecture/decisions/20260804-aws-location-address-lookup.md.

Do this: reproduce the failure on the deployed site and read the `reason` field the action now
returns, or query the app's CloudWatch log group for `$.event = "address_lookup.failed"` and read
`reason`, `error`, `code` and `status`. Then follow the branch table in
docs/product/follow-ups/FU-20260809-confirm-address-lookup-region.md — `denied` means the wrong or
under-permitted key is deployed, `unreachable` means PLACES_AWS_REGION names a region that does not
serve Amazon Location Places, `rejected` means the request itself was refused. Fix the deployment
value; do not change application code to route around a bad credential.

Context that makes this non-obvious: the search box only renders when all three PLACES_AWS_* values
are present, so "the box is there" already proves the variables are set — what is unproven is
whether they are correct. Note also that a lookup can fail with real places listed and no error at
all if AdditionalFeatures: ["Core"] is ever dropped from the request; that is a different bug, fixed
on 2026-08-09, and its tests are in src/lib/address-lookup-aws.test.ts.

Done means: the type-ahead lists real places on the deployed site and picking one fills all five
address boxes, stated as an observation rather than an inference. If the fix was a config value,
say which one it was and where it now lives. Run `pnpm check`, and `pnpm test infra -u` if infra/
changed. Delete docs/product/follow-ups/FU-20260809-confirm-address-lookup-region.md as part of the
change.
```
