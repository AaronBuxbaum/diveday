# Rate-limiting runbook

`src/lib/rate-limit.ts` is the shared per-source abuse-control seam for every
public write boundary named in CR-013 — onboarding, sign-in, recap photo
uploads, wait-list joins, bookings, and every action behind a booking
capability token (readiness, waiver, schedule-confirmation) — plus everything
added since that has the same shape (demo creation, password reset, the
account-token actions, course inquiries, last-minute-list joins, tips and
reviews, and the one staff-side spend bound). The table below, not this
paragraph, is the list.

## What's protected, and by what dimension

Every policy below is written as `` `RATE_LIMITS.name` (capacity/window) ``.
Those figures are **checked against the code** by a guard in
`src/lib/rate-limit.test.ts`: a number edited here without editing
`RATE_LIMITS`, a number edited there without editing this table, or a policy
added to `RATE_LIMITS` and never documented here, all fail `pnpm check`. Do not
paraphrase a figure into prose — write it in that exact form or the guard
cannot see it.

| Surface | File | Dimension(s) | Policy |
| --- | --- | --- | --- |
| Onboarding (account + shop creation) | `src/app/onboard/actions.ts` | IP | `RATE_LIMITS.onboard` (5/hour) |
| "Try the live demo" (mints a seeded demo shop) | `src/app/actions/demo.ts` | IP | `RATE_LIMITS.demoCreate` (10/hour) |
| Sign-in | `src/lib/auth.ts` `authorize()` | IP **and** attempted email | `RATE_LIMITS.signInByIp` (20/15min) + `RATE_LIMITS.signInByEmail` (8/15min) |
| Password-reset request | `src/app/forgot-password/actions.ts` | IP **and** requested email, checked concurrently | `RATE_LIMITS.passwordResetRequestByIp` (5/hour) + `RATE_LIMITS.passwordResetRequestByEmail` (3/15min) |
| Account-token actions (verify, reset submit, invite accept, unsubscribe confirm) | `src/app/verify/[token]/actions.ts`, `reset-password/[token]/actions.ts`, `invite/[token]/actions.ts`, `unsubscribe/[token]/actions.ts` | IP, checked before the token is looked up | `RATE_LIMITS.accountTokenAction` (20/hour) |
| RFC 8058 one-click unsubscribe | `src/app/unsubscribe/[token]/one-click/route.ts` | capability token, checked before the token is looked up | `RATE_LIMITS.oneClickUnsubscribe` (10/hour) |
| Recap photo upload | `src/app/recap/[token]/actions.ts` | IP **and** booking (post-verification) | `RATE_LIMITS.recapUploadByIp` (30/hour) + `RATE_LIMITS.recapUploadByToken` (10/hour) |
| Post-trip tip checkout | same file, `startTipAction` | IP **and** booking | `RATE_LIMITS.tipStart` (10/hour), spent on both dimensions |
| Review submit / revise | same file, `submitReviewAction` | IP **and** booking | `RATE_LIMITS.reviewSubmitByIp` (30/hour) + `RATE_LIMITS.reviewSubmitByToken` (10/hour) |
| Wait-list join | `src/app/s/[shopSlug]/trips/[id]/actions.ts` `joinWaitlist` | IP | `RATE_LIMITS.waitlistJoin` (10/hour) |
| Booking | same file, `bookSpot` | IP | `RATE_LIMITS.booking` (10/hour) |
| Self-declared certification written by a booking | same file, `bookSpot` | each party member's own email, spent only for a seat that answered the certification question | `RATE_LIMITS.declarationByPerson` (5/hour) |
| Booking-confirmation actions (rental fit, pay, "sign your waiver now") | same file, `confirmContextFor` | IP, checked before token verification | `RATE_LIMITS.capabilityAction` (60/hour) |
| Last-minute-list join | `src/app/s/[shopSlug]/actions.ts` | IP | `RATE_LIMITS.lastMinuteListJoin` (10/hour) |
| Course inquiry | `src/app/s/[shopSlug]/courses/[slug]/actions.ts` | IP | `RATE_LIMITS.courseInquiry` (10/hour) |
| Readiness actions | `src/app/ready/[token]/actions.ts` `contextFor` | IP, checked before token verification | `RATE_LIMITS.capabilityAction` (60/hour) |
| Self-cancelling a booking from the readiness link | same file | IP | `RATE_LIMITS.bookingSelfCancel` (5/hour) |
| Waiver draft/complete | `src/app/waivers/[token]/page.tsx` | IP | `RATE_LIMITS.capabilityAction` (60/hour) |
| Emailing a fresh waiver link from a dead one | `src/app/waivers/[token]/actions.ts` | IP, **and** the booking whose inbox receives it | `RATE_LIMITS.capabilityAction` (60/hour) + `RATE_LIMITS.waiverLinkResendByBooking` (5/hour) |
| Seat-claim link | `src/app/claim/[token]/actions.ts` | IP | `RATE_LIMITS.capabilityAction` (60/hour) |
| Address autocomplete in shop settings | `src/app/shop/[shopSlug]/settings/actions.ts` | signed-in staff member | `RATE_LIMITS.addressLookup` (120/hour) |
| Core Web Vitals beacon | `src/app/api/vitals/route.ts` | IP | `RATE_LIMITS.webVitalsBeacon` (300/hour) |

Three notes the table can't carry:

- **`capabilityAction` is deliberately the loosest per-IP policy** (60/hour, not
  30). A dock or boat WiFi is one shared IP carrying several divers who each
  spend multiple actions — save-draft, complete, emergency contact, fit,
  nitrox, pay — on a busy morning. It was raised from 30 to 60 by a security
  review on 2026-07-24; this runbook said 30 until 2026-08-06.
- **`waiverLinkResendByBooking` is keyed by the booking, not the token**, so the
  budget belongs to the *inbox*: every reissue leaves another dead token
  pointing at the same booking, and a per-token key would have given one diver's
  mailbox N separate 5/hour budgets. When the dead token can't be resolved to a
  booking at all, it falls back to keying on the token itself — the only case
  where that per-inbox invariant can't be enforced.
- **`addressLookup` is a spend bound, not a security boundary.** The action is
  already owner/manager-gated; each keystroke past the minimum length is a
  billed Amazon Location request on the shop's own account.

Every capability-token check happens **before** the token is verified, so it
throttles brute-force token guessing and not only replay of a link already
known to be valid. Where a file has a shared token-verification helper the
check lives in it and every action in that file inherits it — `contextFor` in
`ready/[token]/actions.ts`, `confirmContextFor` in the trip actions. Files
without one (`waivers/[token]/page.tsx`'s two inline server actions,
`waivers/[token]/actions.ts`, `claim/[token]/actions.ts`) check at each
action's own first line. Both shapes spend the same `capabilityAction` bucket,
so the ceiling is per IP, not per action.

### What a throttled caller is told

Not one answer. The security-relevant split is the first two bullets — silent
where the limiter could enumerate, explicit where the caller already holds the
secret — and that one must not be "unified". The two after it are surfaces that
say nothing for reasons of their own, one of them by accident.

- **Silent on the surfaces where the limiter itself could enumerate.**
  Sign-in (`authorize()`) returns `null`, indistinguishable from a wrong
  password. A password-reset request redirects to `/forgot-password?sent=1`,
  indistinguishable from a mail that was actually sent. The account-token
  actions (verify, reset submit, invite accept, unsubscribe confirm) bounce
  back to their own page, which re-derives the same "this link isn't valid"
  notice a genuinely dead token gets. Naming the limiter on any of these would
  turn it into an oracle for "is this an account" / "is this a live token".
- **Explicit where the caller already holds the secret.** A diver on
  `/waivers/[token]`, `/ready/[token]` or `/claim/[token]` is acting on a
  capability they were sent, so there is nothing left to enumerate — telling
  them "give it a few seconds and try again, nothing was lost"
  (`diver.waiver.rateLimited` / `diver.ready.rateLimited`, which the claim page
  reuses, all reached via `?error=rate`) is strictly kinder than a silent no-op
  that looks like a dead button. Onboarding does the same through the
  `RATE_LIMIT_MESSAGE` code and `diver.common.rateLimited`; the booking form,
  the course inquiry and the last-minute-list join return that same generic
  code from their own action state.
- **The trip-confirmation panel is the exception, and it is not deliberate.**
  `confirmContextFor` returns `null` on a throttle exactly as it does on a dead
  token, so its three callers cannot tell the two apart and each redirects to
  its own generic failure — `?error=pay`, `?error=fit`, `?error=waiver`, never
  `?error=rate`. The diver already holds the capability, so nothing leaks by it;
  what they lose is the "wait a moment, nothing was lost" wording that
  `/ready/[token]` gives them for the same throttle. Closing the gap means
  giving that helper the two-reason result `contextFor` already has
  (`{ ok: false; reason: "rate_limited" | "invalid" }`,
  `src/app/ready/[token]/actions.ts`) — do not "fix" it by widening the
  silent bucket instead.
- **Two say nothing at all, on purpose.** `suggestAddressAction` returns
  `{ status: "failed" }` and the settings card falls back to plain text boxes —
  autocomplete is an enhancement, and a throttle notice on a keystroke would be
  noise. The recap actions redirect to their surface's existing
  `?photo=error`-style flag.

Whichever branch a new call site lands in, the rule is the same: `src/lib`
hands back a code, and the surface picks the words (`RATE_LIMIT_MESSAGE` is
that code, not a sentence).

## How the limiter works

Token bucket (`src/lib/rate-limit.ts`): each key gets a burst allowance
(`capacity`) that refills continuously (`refillPerMs`), not a fixed window —
a legitimate user who used their burst a minute ago already has a little
budget back, rather than waiting for a hard window edge. `checkRateLimit` is
`async` and every call site awaits it.

**Distributed when configured, per-instance otherwise.** Set both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (Vercel's own Upstash
integration provisions both together) and `rateLimitStoreFromEnvironment()`
switches to `upstashRateLimitStore` — a real global ceiling across every
serverless instance/region, enforced atomically via one Redis `EVAL`'d Lua
script per check (ADR 20260801-distributed-rate-limit-store). Leave either
var unset (every environment until one is provisioned, and all of dev/e2e/CI)
and it falls back to the original in-memory `Map`, scoped to one Node
process — bounding abuse per function instance only, not globally (ADR
20260724-rate-limiting's original, still-real gap when the distributed store
isn't configured). There is currently no dashboard or query surface into
live bucket state either way; if you suspect active abuse, look at Vercel's
own request logs/analytics for the IP/path pattern first, and consider a
platform-level (WAF/Vercel Firewall) block for anything the in-app limiter
alone isn't containing.

**Fail-open, and no longer silent.** `checkRateLimit` never throws — a store
error, a non-2xx Upstash response, or a malformed Upstash response body all
resolve to `{ allowed: true }`. A broken rate limiter (in-memory or
distributed) must never become a reason legitimate traffic gets 5xx'd. Since
2026-08-06 that catch also **reports** before it allows (OPS-7): one
`rate_limit.store_failed` structured log line and one Sentry exception, damped
to at most one per minute per instance. See
[When the store is failing](#when-the-store-is-failing) below.

**Bounded storage either way.** The in-memory store caps at 50,000 distinct
keys and evicts the oldest on overflow. The Upstash store instead sets a
24-hour `PEXPIRE` on every bucket key in the same Lua script that reads and
writes it — generous relative to every configured window (15min-1hr), so a
key only expires after it would have legitimately refilled to full anyway.
Under a sustained high-cardinality attack (a fresh IP per request) the
in-memory store's old buckets can be evicted before their window naturally
expires — an accepted degrade, not a route to unbounded memory growth.

## When the store is failing

**The signal.** A `rate_limit.store_failed` line in the log drain:

```json
{"time":"…","level":"error","event":"rate_limit.store_failed","store":"upstash","error":"TypeError","swallowed":842}
```

- `store` — `upstash` (the distributed store, i.e. a network/Upstash incident),
  `memory` (a bug in this file: the in-process store does no I/O and should
  never throw), or `injected` (a store passed explicitly by a caller; only
  tests do this).
- `error` — the error's *class name*, not its message. `src/lib` logs codes,
  never prose, and the message could in principle carry request detail. The
  full exception is in Sentry.
- `swallowed` — how many store failures went unreported since the last report,
  including this one. **This is the rate.** The reporter emits at most one
  line and one Sentry event per minute per instance, because every public write
  boundary shares this seam and an undamped report is one event per request;
  `swallowed` is what keeps the volume visible anyway. A `swallowed` in the
  thousands means every request in that minute failed the store.

**What it means for the product.** Nothing is being throttled while this is
happening. Sign-in, password reset, onboarding, bookings, and every
capability-token action are running with no abuse control at all. The
application itself is healthy — that is the fail-open policy working as
designed, and it is not up for renegotiation in an incident.

**What to do.**

1. Check `store`. `upstash` → check the Upstash console/status and the
   `UPSTASH_REDIS_REST_*` values on the deployment (a rotated token reads as a
   401 from the REST API, which the store turns into a throw). `memory` → this
   is a code bug, not an outage; open it as one.
2. Treat "unprotected" as the live risk, not the log volume. If the incident is
   long, put a platform-level (Vercel Firewall/WAF) rule in front of the
   affected paths — the in-app limiter cannot be the answer while its store is
   down.
3. Removing both `UPSTASH_REDIS_REST_*` env vars is a valid last resort: the
   next cold start falls back to the in-memory store, which is per-instance but
   working. Re-add them once the incident is over.

There is deliberately no key in the log line. `checkRateLimit`'s `key` is by
convention a `rateLimitKey()` SHA-256 hash, but nothing enforces that at the
type level, so a future call site could pass a raw email or bearer token — and
a log drain is the last place that may land. If you need to know *which* bucket
failed, reproduce it against a test store; the store is either up or down for
everyone, so the key is rarely the question.

## Adjusting a limit

Change the relevant entry in `RATE_LIMITS` (`src/lib/rate-limit.ts`) —
every policy is defined in that one object so the numbers stay reviewable in
a single diff. There is no separate config file or environment variable for
the thresholds themselves. **Update the table above in the same change**: the
guard test named there fails otherwise, which is exactly what it is for.

## Local dev and the e2e fleet

Set `DIVEDAY_RATE_LIMIT_DISABLED=1` to bypass every check — but exactly like
`DIVEDAY_CLOCK`, this is refused whenever a real `DATABASE_URL` is
configured, so it can never disable rate limiting in production. The e2e
fleet (`playwright.config.ts`) sets it because a single worker can share one
server and one `127.0.0.1` "IP" across dozens of unrelated spec files —
without the bypass, replayed test traffic would trip the limiter and fail
tests that have no actual bug.

## Provisioning the distributed store

Create an Upstash Redis database (directly, or through Vercel's Upstash
integration, which sets both env vars on the project automatically) and set
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` on the deployment. No
code change or redeploy-time flag needed — `rateLimitStoreFromEnvironment()`
picks it up from the environment on the next cold start. No SDK package is
involved; `upstashRateLimitStore` calls Upstash's REST API directly with
`fetch`, matching this codebase's existing Stripe/Vercel Blob precedent. See
[20260801-distributed-rate-limit-store ADR](../architecture/decisions/20260801-distributed-rate-limit-store.md)
for the atomicity design (one `EVAL`'d Lua script per check) and
[20260724-rate-limiting ADR](../architecture/decisions/20260724-rate-limiting.md)
for why the in-memory store shipped first. `RateLimitStore` is a small
interface (`take(key, config, now)`); a future store other than Upstash can
implement it and be passed as `checkRateLimit`'s fourth argument (or swap the
module-level default) without touching any call site.

Until it is provisioned, be precise about what the per-instance gap costs. It
does not disable a policy; it multiplies it. A limit of 8 sign-ins per 15
minutes per email is, across N warm instances, up to 8N — because each instance
counts that email's bucket independently, and an attacker who keeps enough
connections in flight is spread across all of them. The dual IP-and-email
dimensions still narrow the attack (rotating source addresses does not reset
the email bucket on the instance serving that request), but the ceiling is a
function of a number nobody controls. That is the whole reason provisioning
Upstash is on the roadmap rather than optional.
