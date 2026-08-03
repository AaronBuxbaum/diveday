# Rate-limiting runbook

`src/lib/rate-limit.ts` is the shared per-source abuse-control seam for every
public write boundary named in CR-013: onboarding, sign-in, recap photo
uploads, wait-list joins, bookings, and every action behind a booking
capability token (readiness, waiver, schedule-confirmation).

## What's protected, and by what dimension

| Surface | File | Dimension(s) | Policy |
| --- | --- | --- | --- |
| Onboarding (account + shop creation) | `src/app/onboard/actions.ts` | IP | `RATE_LIMITS.onboard` — 5/hour |
| Sign-in | `src/lib/auth.ts` `authorize()` | IP **and** attempted email | `RATE_LIMITS.signInByIp` (20/15min) + `RATE_LIMITS.signInByEmail` (8/15min) |
| Recap photo upload | `src/app/recap/[token]/actions.ts` | IP **and** booking (post-verification) | `RATE_LIMITS.recapUploadByIp` (30/hour) + `RATE_LIMITS.recapUploadByToken` (10/hour) |
| Wait-list join | `src/app/s/[shopSlug]/trips/[id]/actions.ts` `joinWaitlist` | IP | `RATE_LIMITS.waitlistJoin` — 10/hour |
| Booking | same file, `bookSpot` | IP | `RATE_LIMITS.booking` — 10/hour |
| Readiness actions | `src/app/ready/[token]/actions.ts` `contextFor` | IP, checked before token verification | `RATE_LIMITS.capabilityAction` — 30/hour |
| Waiver draft/complete | `src/app/waivers/[token]/page.tsx` | IP | `RATE_LIMITS.capabilityAction` — 30/hour |
| Booking-confirmation actions (rental fit, pay) | same trip actions file, `confirmContextFor` | IP, checked before token verification | `RATE_LIMITS.capabilityAction` — 30/hour |

Every capability-token action funnels through one file-local chokepoint
(`contextFor` / `confirmContextFor`), so a single rate-limit check there
protects every action in that file — checked **before** the token is
verified, so it also throttles brute-force token guessing, not only replay
of a link already known to be valid.

Every rejection redirects to the same generic notice the surface already
uses for "that didn't work" (never a distinct "you've been rate limited"
message) — this is deliberate: revealing which dimension tripped (IP vs.
email vs. token) would let an attacker use the limiter itself to enumerate
valid emails or tokens.

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

**Fail-open.** `checkRateLimit` never throws — a store error, a non-2xx
Upstash response, or a malformed Upstash response body all resolve to
`{ allowed: true }`. A broken rate limiter (in-memory or distributed) must
never become a reason legitimate traffic gets 5xx'd.

**Bounded storage either way.** The in-memory store caps at 50,000 distinct
keys and evicts the oldest on overflow. The Upstash store instead sets a
24-hour `PEXPIRE` on every bucket key in the same Lua script that reads and
writes it — generous relative to every configured window (15min-1hr), so a
key only expires after it would have legitimately refilled to full anyway.
Under a sustained high-cardinality attack (a fresh IP per request) the
in-memory store's old buckets can be evicted before their window naturally
expires — an accepted degrade, not a route to unbounded memory growth.

## Adjusting a limit

Change the relevant entry in `RATE_LIMITS` (`src/lib/rate-limit.ts`) —
every policy is defined in that one object so the numbers stay reviewable in
a single diff. There is no separate config file or environment variable for
the thresholds themselves.

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
