# 20260801-distributed-rate-limit-store — Upstash Redis behind the existing RateLimitStore seam

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

[ADR 20260724-rate-limiting](20260724-rate-limiting.md) shipped an in-process token bucket
(`src/lib/rate-limit.ts`) explicitly as an interim measure: on the stated Vercel serverless target,
each cold-started function instance has its own fresh buckets, so the sign-in throttle (20/15min per
IP, 8/15min per email) and every other configured limit is close to a no-op against a distributed
credential-stuffing or abuse run bounded only by function fan-out. That ADR's own text names the
fix: *"Swap in a distributed store (Redis/Upstash) behind the same `RateLimitStore` interface if a
global ceiling is ever required"* — this is that follow-up, prompted by the 2026-07-31 specialist
security audit re-confirming the gap.

## Decision

- **Upstash Redis, via its REST API — no SDK package.** Matches this codebase's existing pattern for
  Stripe webhook verification (`src/lib/payments/webhook.ts`) and Vercel Blob uploads
  (`src/lib/storage/index.ts`), both of which call the vendor's HTTP API directly with `fetch` rather
  than add and audit an SDK dependency for a handful of calls. Upstash's REST API is a plain
  `POST` with a JSON command array and a bearer token — no client library needed. This *is* still a
  new runtime dependency in the sense the repo's hard rules mean (a new hosted, billed, third-party
  service in the request path), which is why it gets this ADR despite adding zero lines to
  `package.json`.
- **The token-bucket math runs inside Redis via one `EVAL`'d Lua script, not read-then-write over
  HTTP.** A naive "GET the bucket, compute in JS, SET it back" would race: two concurrent requests
  hitting two different serverless instances could both read the same stale token count and both
  decide "allowed," which is exactly the failure mode this migration exists to close. `EVAL` runs
  the whole read/refill/decide/write cycle atomically on the Redis side in one round trip.
- **`RateLimitStore.take` becomes `RateLimitResult | Promise<RateLimitResult>`, and `checkRateLimit`
  becomes `async`.** The in-memory store stays synchronous internally (no `Promise` wrapping
  overhead for the common case); the Upstash store does a real network call and returns a genuine
  `Promise`. Every one of `checkRateLimit`'s ~20 call sites was already inside an async server
  action, route handler, or the Credentials `authorize()` callback, so this is a mechanical `await`
  addition at each site, not a control-flow change. Two call sites (`src/lib/auth.ts`'s
  sign-in-by-IP/by-email pair, `src/app/forgot-password/actions.ts`'s reset-by-IP/by-email pair) run
  their two independent checks with `Promise.all` instead of sequentially, so the distributed store's
  added network latency doesn't stack — both files' existing comments note the *response-time*
  symmetry they depend on (a password-reset request must not be measurably slower when the email
  matches vs. not), and two round trips run concurrently take the same wall-clock as one.
- **Env-var-gated with an in-memory fallback, exactly like every other provider seam.**
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` both set (Vercel's own Upstash integration
  provisions both together) switches `rateLimitStoreFromEnvironment()` to the distributed store;
  either absent (every environment until one is provisioned, and all of dev/e2e/CI) falls back to
  the unchanged in-memory store — zero setup cost for anyone not running against production.
- **Fail-open contract is unchanged and still load-bearing.** A malformed Upstash response, a
  non-2xx status, or a network error all throw inside `upstashRateLimitStore.take`, which
  `checkRateLimit`'s existing `try/catch` turns into `{ allowed: true }` — an Upstash outage degrades
  to "no rate limiting," never to "every request 500s." This is the same contract ADR
  20260724-rate-limiting already established; nothing about adopting a real network dependency is
  allowed to weaken it.
- **A bucket key gets a 24-hour `PEXPIRE` in the Lua script**, replacing the in-memory store's
  `MAX_BUCKETS`-eviction bound (which only applies to that store; Redis needs its own bound so idle
  keys don't accumulate forever). 24 hours is generous relative to every configured window (15
  minutes to 1 hour), so an expired key only ever resets a bucket to full *after* it would have
  legitimately refilled anyway — never a stricter outcome than intended.

## Alternatives considered

- **Vercel Firewall / KV instead of Upstash.** Vercel's own Upstash integration is the documented,
  zero-additional-account path for Redis on this platform (ADR 20260724-rate-limiting already named
  Upstash as the natural fit); Vercel KV is themselves an Upstash-backed product with a narrower free
  tier for this use case. No functional reason to prefer one over the other technically; Upstash was
  named first and is what this ADR formalizes.
- **`@upstash/redis` / `@upstash/ratelimit` SDK packages.** Rejected for the same reason the Stripe
  and Vercel Blob integrations avoid their SDKs: one `EVAL` call over `fetch` is the entire surface
  area needed, and a hand-rolled ~40-line Lua script plus a `zod`-validated response parse is easier
  to audit in full than a dependency with its own release cadence and transitive tree.
- **Read-then-write over two REST calls (`GET`/`SET`) instead of `EVAL`.** Rejected: reintroduces the
  exact race this migration exists to close. Two HTTP round trips can interleave across concurrent
  serverless instances in a way one atomic `EVAL` cannot.
- **Keep the in-process store and rely on Vercel's platform-level DDoS/Firewall protection alone.**
  ADR 20260724-rate-limiting already leaned on this as a partial mitigation for the interim state,
  but it doesn't substitute for a real per-source ceiling on credential stuffing or targeted abuse of
  a single account/token, which is exactly the gap the 2026-07-31 audit flagged as still open.

## Consequences

- Every rate limit configured in `RATE_LIMITS` (`src/lib/rate-limit.ts`) is now a real global ceiling
  once `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are provisioned in production, not a
  per-instance one. Provisioning those two env vars is an operational follow-up outside this PR's
  scope (billing/plan selection is a product decision, not an engineering one) — until they're set,
  behavior is unchanged from ADR 20260724-rate-limiting.
- `checkRateLimit` is now `async`; any future call site must `await` it. A missed `await` would type-error
  (`Promise<RateLimitResult>` has no `.allowed`), not silently misbehave.
- `src/lib/rate-limit.test.ts` covers the Lua script's behavior via a fake `fetch` that mirrors the
  server-side token-bucket math (burst, refill, and — the one property that matters — two
  independently-constructed store instances sharing state through the same backend), plus the
  fail-open path for a non-2xx response and a malformed body.
- The in-memory store and its `MAX_BUCKETS` eviction bound are unchanged and remain the default
  everywhere the two env vars aren't set.
