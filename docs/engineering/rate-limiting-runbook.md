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
| Wait-list join | `src/app/shop/[shopSlug]/schedule/[id]/actions.ts` `joinWaitlist` | IP | `RATE_LIMITS.waitlistJoin` — 10/hour |
| Booking | same file, `bookSpot` | IP | `RATE_LIMITS.booking` — 10/hour |
| Readiness actions | `src/app/ready/[token]/actions.ts` `contextFor` | IP, checked before token verification | `RATE_LIMITS.capabilityAction` — 30/hour |
| Waiver draft/complete | `src/app/waivers/[token]/page.tsx` | IP | `RATE_LIMITS.capabilityAction` — 30/hour |
| Schedule-confirmation actions (rental fit, pay) | same schedule actions file, `confirmContextFor` | IP, checked before token verification | `RATE_LIMITS.capabilityAction` — 30/hour |

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

Token bucket (`inMemoryRateLimitStore` in `src/lib/rate-limit.ts`): each key
gets a burst allowance (`capacity`) that refills continuously
(`refillPerMs`), not a fixed window — a legitimate user who used their
burst a minute ago already has a little budget back, rather than waiting for
a hard window edge.

**Per-instance only.** The store is an in-memory `Map`, scoped to one Node
process. On Vercel's serverless model this bounds abuse per function
instance, not globally across every instance/region a request might land on
— a real, accepted gap (see the ADR), not a silent one. There is currently
no dashboard or query surface into live bucket state; if you suspect active
abuse, look at Vercel's own request logs/analytics for the IP/path pattern
first, and consider a platform-level (WAF/Vercel Firewall) block for
anything the in-app limiter alone isn't containing.

**Fail-open.** `checkRateLimit` never throws — a store error always resolves
to `{ allowed: true }`. A broken rate limiter must never become a reason
legitimate traffic gets 5xx'd.

**Bounded memory.** The store caps at 50,000 distinct keys and evicts the
oldest on overflow. Under a sustained high-cardinality attack (a fresh IP
per request) this means old buckets can be evicted before their window
naturally expires — an accepted degrade, not a route to unbounded memory
growth.

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

## If you need a distributed (cross-instance) limit later

`RateLimitStore` is a small interface (`take(key, config, now)`) —
implement it against Redis/Upstash/Vercel KV and pass it as
`checkRateLimit`'s fourth argument (or swap the module-level default). No
call site needs to change. See
[20260724-rate-limiting ADR](../architecture/decisions/20260724-rate-limiting.md)
for why this wasn't built now.
