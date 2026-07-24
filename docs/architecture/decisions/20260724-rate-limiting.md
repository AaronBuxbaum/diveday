# 20260724-rate-limiting — In-process token-bucket rate limiting for public write boundaries

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

[The 2026-07-23 codebase review](../../product/archive/codebase-review-20260723.md) (CR-013)
found that onboarding (account/shop creation plus password hashing), sign-in, recap uploads,
wait-list joins, bookings, and every action behind a booking capability token had no centralized
per-source abuse control. PR #139 explicitly deferred per-token/IP recap limits at the time.

## Decision

- **A new first-party seam (`src/lib/rate-limit.ts`), not a vendor.** No distributed rate-limiting
  service (Upstash, Vercel KV/Firewall) is configured for this app today, and adding one is a new
  runtime dependency this ticket has no mandate to introduce. An in-process token bucket closes the
  actual gap the review named — no coordinated abuse control at all — without that new dependency.
  `RateLimitStore` is a two-method interface so a distributed store can replace the in-memory
  default later without touching call sites (see the runbook).
- **Token bucket, not fixed window.** A fixed window lets every client that got throttled retry in
  lockstep at the window edge; a token bucket refills continuously, which is both a better attacker
  model (no exploitable edge) and a better UX (a user who used their burst a minute ago already has
  a little budget back).
- **Per-instance, not global — an accepted gap.** Vercel serverless functions don't share process
  memory across instances or regions. This bounds abuse per instance, not globally. Treated as
  acceptable for now because (a) it is still strictly better than the current *zero* abuse control,
  (b) Vercel's platform-level protections (DDoS mitigation, and Firewall on paid tiers) sit in front
  of this for volumetric attacks, and (c) the `RateLimitStore` interface exists specifically so this
  can be upgraded to a distributed store later without an application-code rewrite.
- **Fail-open on any store error.** A rate limiter that can turn into an outage for legitimate
  traffic is worse than no rate limiter. `checkRateLimit` never throws.
- **IP extraction prefers `x-vercel-forwarded-for`, then `x-forwarded-for` (first entry), then
  `x-real-ip`.** Vercel is the sole hosting target. Vercel's own documentation (Headers → Request
  headers → `x-forwarded-for`, fetched and verified 2026-07-24) states: *"If you are trying to use
  Vercel behind a proxy, we currently overwrite the X-Forwarded-For header and do not forward
  external IPs. This restriction is in place to prevent IP spoofing"* — so a client-supplied value
  is discarded, not appended to, and `x-forwarded-for`'s first entry is Vercel's own observed
  connecting IP, not attacker-controlled. `x-vercel-forwarded-for` is checked first anyway: the same
  docs note it *"is identical to `x-forwarded-for`. However, `x-forwarded-for` could be overwritten
  if you're using a proxy on top of Vercel"* — so it stays trustworthy even under a future
  customer-added proxy in front of Vercel, which `x-forwarded-for` alone would not. This is a
  narrow, deliberate exception to "never derive a canonical value from a request header" (the rule
  that governs `publicAppUrl()` in `src/lib/notifications`): the IP is only ever a rate-limit bucket
  key, never used for an authorization decision or a redirect target, so even a successful spoof at
  worst lets an attacker share someone else's bucket — it can never grant access to anything.
- **Keys are hashed (SHA-256), never raw.** A bearer token, an email address, or an IP is never held
  as a literal in-memory Map key or written to a log line — only its hash (`rateLimitKey()`). This
  is opacity, not authentication; no salt is needed because the goal is "don't let a memory dump or
  a stray log line hand back a usable credential," not "resist offline guessing of the key itself."
- **Capability-token actions are rate-limited at each file's shared verification chokepoint**
  (`contextFor` in `src/app/ready/[token]/actions.ts`, `confirmContextFor` in the schedule actions
  file), checked **before** `verifyBookingCapability` runs. One check per file protects every action
  in it, and checking pre-verification means it also throttles brute-force guessing of the token
  itself, not just replay of a link already known to be valid. The waiver page's two inline actions
  (`src/app/waivers/[token]/page.tsx`) don't share a helper function, so they're checked
  individually with the same policy.
- **Sign-in is enforced in the Credentials provider's `authorize()` callback
  (`src/lib/auth.ts`), not the sign-in page.** NextAuth invokes `authorize()` for every credentials
  attempt regardless of entry path — the page's server action, or a direct POST to
  `/api/auth/callback/credentials` — so it is the one chokepoint that can't be bypassed. (An earlier
  draft of this change also checked in the page action; it was removed because both checks used the
  same rate-limit key and would have silently halved the configured budget by consuming two tokens
  per attempt.) A failed rate-limit check returns `null` from `authorize()`, which NextAuth turns
  into the same generic `CredentialsSignin` error as a wrong password — the sign-in page shows one
  message either way, so the limiter can't be used to distinguish "wrong password" from "rate
  limited" (or, combined with the per-email dimension, to enumerate whether an email is registered).
- **Generic failure responses everywhere.** Every rejection routes through the surface's existing
  generic error notice; no surface gained a distinct "you are rate limited" message. See the runbook
  for the full per-surface table.
- **`DIVEDAY_RATE_LIMIT_DISABLED=1`, guarded exactly like `DIVEDAY_CLOCK`.** The e2e fleet can run
  as few as one worker (`E2E_WORKER_COUNT`), replaying dozens of sign-ins/bookings from every spec
  file through one shared server and one shared `127.0.0.1` "IP." Real throttling there would fail
  unrelated tests for having no bug, only shared state — so `playwright.config.ts` sets this env var
  the same way it sets `DIVEDAY_CLOCK`, and `src/lib/rate-limit.ts` refuses to honor it whenever a
  real `DATABASE_URL` is configured, so it can never reach production.

## Alternatives considered

- **A distributed store (Upstash Redis / Vercel KV) from the start.** Rejected for now: a new
  runtime dependency and paid-tier requirement this ticket has no mandate to add, when the in-memory
  seam already closes the "no abuse control at all" gap the review flagged. The interface is shaped
  so this is a follow-up, not a rewrite.
- **Fixed-window counters.** Rejected for the thundering-herd/UX reasons above.
- **Rate-limiting inside `verifyBookingCapability` itself** (`src/db/booking-capabilities.ts`),
  covering every capability action from one place. Would need the client IP threaded through every
  one of its ~8 call sites and would pull a Next.js-specific concern (`headers()`) into `src/db`,
  which stays framework-free. The file-local chokepoint achieves the same "one check protects every
  action in the file" property without that layering violation.

## Consequences

- Every public write boundary the review named now has a bounded, generic-failure, fail-open rate
  limit. `src/lib/rate-limit.test.ts` and `src/lib/request-ip.test.ts` deterministically cover burst,
  refill, cross-key isolation, the fail-open path, and header parsing.
- The per-instance limitation is real: a sufficiently distributed attacker (many source IPs, many
  serverless instances) is not stopped by this alone. See the runbook for what to do in a suspected
  active-abuse incident.
- Any future PGlite-in-memory-store-style call site that constructs its own rate-limit store must
  keep using `checkRateLimit`'s fail-open contract — a custom store that throws on error would
  silently start blocking legitimate traffic instead of degrading safely.

## Security review (2026-07-24)

A `security-reviewer` pass raised the IP-spoofing question directly — its initial read of standard
proxy behavior (edges *append* to `x-forwarded-for` rather than replace it) would have meant the
original single-header design was bypassable. Verified against Vercel's own current documentation
before changing anything: Vercel confirms it overwrites the header and discards a client-supplied
value specifically to prevent spoofing, so the original design's core trust assumption held. Still
adopted `x-vercel-forwarded-for` as the preferred header (see the IP-extraction bullet above) since
Vercel's own docs identify it as strictly more robust with no downside in the standard case.
`capabilityAction`'s shared-IP budget was raised 30→60/hour on the same review's separate,
legitimate observation that a boat/dock WiFi's one shared IP can carry several divers each
running multiple readiness/waiver actions on a busy morning. The review also re-confirmed the
already-disclosed DNS-rebinding gap in `src/lib/storage/ingest-url.ts` (CR-020, see that ticket's
own ADR) without finding anything new to fix there.
