# 20261118-rate-limits-in-postgres — Shared rate-limit buckets live in the app's own Postgres, not Upstash Redis

- **Status:** Accepted
- **Date:** 2026-11-18
- **Supersedes:** [20260801-distributed-rate-limit-store](20260801-distributed-rate-limit-store.md)

## Context

The limiter (`src/lib/rate-limit.ts`) needs one counter all serverless instances share, or a limit
is multiplied by however many instances are warm. ADR 20260801 added Upstash Redis for that: a
third-party service, two env vars, a production deploy gate, a monthly bill, and an outage mode
of its own. Rate limiting was the only thing that used it. Aaron asked (2026-11-18) why a second
datastore exists next to the Neon database that every public write already touches.

## Decision

- **One table, `rate_limit_buckets`** (`key`, `tokens`, `updated_at`, `last_allowed`), and the same
  token-bucket arithmetic as before, in one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
  A second instance racing on a key waits on the row lock and reads the first one's result, so two
  requests never spend the same token. Refund is one `UPDATE`. Buckets carry no shop: a key is a
  hash of an IP, an email or a link.
- **The store is installed at boot** by `src/instrumentation.ts` when `DATABASE_URL` is set
  (`setDefaultRateLimitStore`), the way the log sink is: `src/lib` takes no value import from
  `src/db`. Dev, the e2e fleet and unit tests keep the in-process store; there is nothing to share.
- **Idle buckets are swept by the limiter**: one take in 200 deletes buckets idle for 24 hours,
  far longer than any window (15 minutes to an hour), so no cron is needed.
- **Failure contract unchanged.** A store error is reported once a minute and the request is
  allowed; the doctor's date-of-birth unlock still refuses. The log tag is now `postgres`.
- **Gone:** the Upstash store and its Lua scripts, `KV_REST_API_URL`/`KV_REST_API_TOKEN`, the
  `requiredInProduction` gate for them, `rate_limit.memory_store_in_production` and
  `runtimeMode().warnMemoryRateLimit`.

## Alternatives considered

- **Memory only.** Least code, but each instance counts alone, so the sign-in and date-of-birth
  limits become speed bumps.
- **Vercel Firewall rate rules.** Dashboard configuration outside the repo; it cannot key on an
  email or a link, so it covers only part of the limits.

## Consequences

- One fewer vendor, bill and credential. A public write that is limited adds one small statement
  to a database it almost always opens anyway.
- A Neon outage now also turns the limiter off, but the same outage takes the request down first.
- A limit check on a route that otherwise never touches the database (vitals, CSP reports) now
  does; those are hourly-capped per IP and cheap.
- The Upstash database can be deleted once this ships. Unset the `KV_*` variables on the Vercel
  project (the Upstash integration sets them).
