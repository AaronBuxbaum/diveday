# FU-20260814-ses-from-email-stale-override — Redeploy and prove email recovered, then make a retired key visible

- **Status:** Open
- **Raised:** 2026-08-14 — production log triage alongside the dive-site 23505 and the check-in `pg` warning
- **Kind:** risk
- **Effort:** S
- **Touches:** `config/env-registry.mjs`, `src/lib/notifications/ses.ts`, `src/lib/configured.ts`, `scripts/check-env.mjs`

## Progress

- **2026-08-14 — the owner removed `SES_FROM_EMAIL` from Vercel Production.** That is the cause
  addressed. Two things it does *not* do on its own: a Vercel environment change binds at deployment
  creation, so the deployment serving traffic right now still carries the old value until something
  redeploys; and nothing has yet confirmed that `notification.ses_send_failed` has actually stopped.
- **The `RESEND_*` variables are deliberately being left in place** (owner's call, same date). They
  are inert — SES has been the sole provider since ADR 20260803-ses-sole-email-provider and no code
  reads them — so this is a tidiness item, not a risk. Noted here so the next reader does not
  re-raise it as a finding.
- **Not started:** the part that stops this recurring — nothing in the repo can see a retired key
  still set on a deployment.

## What I noticed

Every production email is being refused by SES, right now:

```
notification.ses_send_failed  httpStatus 403  AccessDeniedException
User `arn:aws:iam::417160702652:user/diveday-ses-sender' is not authorized to perform
`ses:SendEmail' on resource `arn:aws:ses:us-east-1:417160702652:identity/<redacted>@dive.day'
```

The domain in that identity ARN is the giveaway. The stack verifies and grants **`ses.dive.day`**
(`sesEmailDomain`, `infra/lib/infra-stack.ts` §SES), and the sender compiled into the app is
`DiveDay <noreply@ses.dive.day>` (`DEFAULT_SENDER`). Nothing in the repository can produce a From
address on the apex `dive.day` — except the override:

```ts
const sender = configuredValue(env.SES_FROM_EMAIL, DEFAULT_SENDER);  // src/lib/notifications/index.ts
```

`SES_FROM_EMAIL` **is set in Vercel Production** (`vercel env ls production` shows it, added 9 days
ago, Sensitive) and is **not in `config/env-registry.mjs`** — it was retired to a compiled-in value
by issue #517, precisely because round-tripping it through the deploy had already corrupted it once.
Retiring it removed it from everything the repo generates; it did not remove the copy already living
in the project. So a stale apex-domain address is overriding the compiled-in one on every send, and
the IAM user has no grant on that identity.

The failing log line above was a demo-entry founder alert (`POST /`), but this is not scoped to that
path: it is `notificationProviderFromEnvironment`, so booking confirmations, waiver links, trip-prep
"ready" links, password resets, and email verification are all going out against the same refused
identity.

I did not confirm the variable's *value* — reading it needs `vercel env pull`, which was denied in
this session. The domain in the SES error and the absence of any other apex-domain code path are
what the diagnosis rests on.

## Why it isn't already done

Two reasons, both outside what a repository change can reach:

1. The fix is deleting a production environment variable on Vercel. That is an outward-facing,
   hard-to-reverse action on live configuration and is the owner's call, not a session's.
2. Nothing in the repo can currently *see* the problem. `pnpm check:env` compares
   `.env.example`/`.env.manual` against the registry on the local machine; it has no view of what a
   deployment is actually carrying, so a variable the registry has retired can sit in Vercel
   indefinitely and silently outrank the compiled-in value.

## Proposed change

**First, and on its own** — finish stopping the outage. The `vercel env rm` is done; what remains is
to **redeploy** (an env change binds at deployment creation and does not reach the deployment already
serving), then prove it: a send to the SES mailbox simulator, and `notification.ses_send_failed`
absent from the logs afterwards. Until that proof exists, treat production email as still broken. Do
**not** "fix" it by setting the variable to `noreply@ses.dive.day` — that re-creates exactly the round
trip #517 removed.

`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_EMAIL_DOMAIN` and `RESEND_WEBHOOK_SECRET` are also
still set in Production and also absent from the registry, but the owner has chosen to leave them
(see Progress). Nothing reads them, so they cost nothing but noise; clear them whenever the retired-key
report below makes them easy to spot.

**Then** — make the class visible. The gap is that a retired key is invisible to every check. The
shape I would take: give `config/env-registry.mjs` an explicit `retired` list (key + why + the
release that retired it), and have `scripts/check-env.mjs` report any retired key it finds in a
local `.env.*`, plus a `pnpm env:audit`-style command that reads `vercel env ls` and reports retired
or unregistered keys still set on a deployment. A report, not a gate — it needs network and
credentials, so it cannot be part of `pnpm check`.

I am *not* proposing that the app ignore `SES_FROM_EMAIL`. The override is deliberate and documented
(a fork, a staging deploy, a self-host needs its own sender); the bug is that a value nobody meant to
keep outlived its registry entry.

## Prompt

```text
Production email is failing: every SES send answers 403 AccessDeniedException naming
`identity/<address>@dive.day`, while the stack grants only `ses.dive.day`. The cause is a stale
`SES_FROM_EMAIL` still set in Vercel Production, overriding the compiled-in
`DEFAULT_SENDER` ("DiveDay <noreply@ses.dive.day>").

Read first: src/lib/notifications/ses.ts (DEFAULT_SENDER and why it is compiled in),
src/lib/notifications/index.ts (notificationProviderFromEnvironment), src/lib/configured.ts,
config/env-registry.mjs, scripts/check-env.mjs, and the SES section of infra/lib/infra-stack.ts.

The constraint that makes this non-obvious: SES_FROM_EMAIL was deliberately REMOVED from
config/env-registry.mjs by issue #517 and now survives only as a fork/self-host override. So it is
correct that the registry does not list it, and correct that the app still reads it — which is
exactly why nothing detects a copy left behind in a deployment. Do not re-add it to the registry,
and do not set it to the right address; the value belongs in the code.

The owner already removed SES_FROM_EMAIL from Vercel Production on 2026-08-14, and has chosen to
leave the RESEND_* leftovers alone for now. So done is:
1. Production redeployed (an env change binds at deployment creation, so the removal has not reached
   the running deployment), with a test send proving `notification.ses_send_failed` has stopped.
   Until that proof exists, production email is still broken.
2. The repo can report this class: a `retired` list in config/env-registry.mjs carrying why and
   when, surfaced by scripts/check-env.mjs for local files, plus a command that reads
   `vercel env ls` and reports retired or unregistered keys still set on a deployment. A report,
   never a gate — it needs credentials. This is the part that stops a fourth variable doing the
   same thing in six months.

Run `pnpm check` and `pnpm test scripts` (or the focused env-script tests). Delete
docs/product/follow-ups/FU-20260814-ses-from-email-stale-override.md as part of the change.
```
