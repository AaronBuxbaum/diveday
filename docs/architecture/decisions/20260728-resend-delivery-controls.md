# 20260728-resend-delivery-controls — Use a durable, paced Resend delivery layer

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Resend enforces a team-wide request-per-second limit with no burst allowance. DiveDay previously
sent every email through the single-message endpoint, allowed fan-out `Promise.all`, discarded rate
limit headers, and recorded a 429 as a terminal failure. Vercel can run several instances, so an
in-memory limiter alone cannot protect the shared Resend team limit or recover after a process exit.

## Decision

Keep the existing fetch-based Resend seam, but add three controls behind it:

- Every request reserves a durable team-wide permit at 8 requests per second, leaving headroom below
  the configured 10 requests per second limit.
- 429, network, and 5xx failures retry with the provider's `Retry-After`/reset guidance first, then
  bounded exponential backoff with jitter. Permanent 4xx responses do not retry.
- Retryable failures are written to a durable, shop-scoped outbox and drained by the existing cron
  route. Fan-outs use Resend's batch endpoint in chunks of 100 when the provider supports it.

The application retains its current best-effort contract: booking, waiver, and account operations
do not fail because email is unavailable. Idempotency keys remain stable for each logical send, and
the outbox stores the validated notification payload rather than rendered provider JSON.

## Alternatives considered

- **In-memory limiter only** — cannot coordinate separate Vercel instances or survive a restart.
- **A new hosted queue dependency** — adds runtime and operational cost before current Postgres
  capacity is exhausted; the existing cron and database are sufficient for this bounded workload.
- **Batch every send** — impossible for independent interactive requests and would complicate the
  immediate fallback behavior; batch is reserved for known fan-outs.

## Consequences

This makes provider traffic observable, paced, retryable, and safe across process restarts without
changing booking truth. Resend calls may wait briefly for a database permit, and retryable mail can
remain queued until the next cron pass after the in-request retry budget is exhausted. If volume or
latency makes the cron drain insufficient, the escape hatch is a dedicated worker using the same
outbox and idempotency contract; migrating the payload table is additive.
