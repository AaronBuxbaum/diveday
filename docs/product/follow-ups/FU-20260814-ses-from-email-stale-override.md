# FU-20260814-ses-from-email-stale-override — Remove the retired `SES_FROM_EMAIL` from Vercel Production, which is refusing every email

- **Status:** Open
- **Raised:** 2026-08-14 — production log triage alongside the dive-site 23505 and the check-in `pg` warning
- **Kind:** risk
- **Effort:** S
- **Touches:** `config/env-registry.mjs`, `src/lib/notifications/ses.ts`, `src/lib/configured.ts`, `scripts/check-env.mjs`

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

**First, and on its own** — stop the outage:

```
vercel env rm SES_FROM_EMAIL production --project diveday --scope aaron-buxbaums-projects
```

then redeploy (an env change does not reach the running deployment). Confirm with a send to the SES
mailbox simulator and check `notification.ses_send_failed` stops appearing. Do **not** "fix" it by
setting it to `noreply@ses.dive.day` — that re-creates exactly the round trip #517 removed.

While in there: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_EMAIL_DOMAIN` and
`RESEND_WEBHOOK_SECRET` are also still set in Production and are also absent from the registry —
SES has been the sole email provider since ADR 20260803-ses-sole-email-provider. They are inert
rather than harmful, but they are the same class of leftover and worth clearing in the same pass.

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

Done is:
1. `SES_FROM_EMAIL` removed from Vercel Production and the app redeployed, with a test send proving
   `notification.ses_send_failed` has stopped. (Ask the owner before touching production config.)
2. The repo can report this class: a `retired` list in config/env-registry.mjs carrying why and
   when, surfaced by scripts/check-env.mjs for local files, plus a command that reads
   `vercel env ls` and reports retired or unregistered keys still set on a deployment. A report,
   never a gate — it needs credentials.
3. The stale RESEND_* variables in Production are cleared too (SES is the sole provider, ADR
   20260803-ses-sole-email-provider).

Run `pnpm check` and `pnpm test scripts` (or the focused env-script tests). Delete
docs/product/follow-ups/FU-20260814-ses-from-email-stale-override.md as part of the change.
```
