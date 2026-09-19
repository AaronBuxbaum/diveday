# 20260919-health-check-does-not-wake-the-database — Keep `/api/health` off the database, and cover database liveness from three places that do not poll

- **Status:** Accepted
- **Date:** 2026-09-19

## Context

[20260907-external-uptime-monitor](20260907-external-uptime-monitor.md) put a Route 53 health check
on `https://www.dive.day/api/health`, and made that route's green answer mean the process **and**
its database: it runs `select 1` through the same `getDb()` every request path uses. That read as
strictly better than checking the process alone, and on its own terms it is.

What it missed is the arithmetic on the other side of the wire. A Route 53 health check with a
30-second request interval is not one request every thirty seconds. AWS's own documentation is
explicit: *"each of the Route 53 health checkers in data centers around the world will send your
endpoint a health check request every 30 seconds. On average, your endpoint will receive a health
check request about every two seconds."* That is roughly **1.3 million requests a month**, each one
a Vercel function invocation and a database round-trip.

Neon's compute **scales to zero after five idle minutes** and is billed for the time it spends
awake, not for the queries it answers. A query every two seconds means it never gets five idle
minutes — so from the day the health check shipped, the probe alone pinned the compute awake
permanently. The measured September usage is the fingerprint: 100 CU-hours by the 19th, against a
Free-plan allowance of 100, where the first six days (crons only, a ~50% duty cycle) account for
about 21 and the twelve days since 2026-09-07 account for about 72. A full month unchanged projects
to ~182 CU-hours, which is simply `0.25 CU × 730 hours` — a bill set by the monitor's cadence and
by nothing anyone does with the product. That is what forced the move to a paid Neon plan.

No TTL fixes this. Caching the verdict inside the route cuts queries but not CU-hours, because any
interval short enough to be a useful monitor is far shorter than the five-minute idle timeout.
Narrowing Route 53 to its minimum three checker regions takes the effective interval from ~2s to
~10s, which is still ~30× under the timeout. The conflict is structural: **an external uptime
monitor that verifies the database and a database that scales to zero cannot both exist.**

## Decision

**`/api/health` reports process liveness only. It does not touch the database.**

- The route answers `200` with `{ status, commit }`, keeps `Cache-Control: no-store`, and keeps
  `await connection()` so it is never prerendered — a probe answered from the build output would be
  green forever, including while the deployment is down. The database read is gone, and
  `src/app/api/health/route.test.ts` asserts `getDb` is **never called**, so reintroducing it fails
  a test rather than silently restoring the cost.
- **The Route 53 check is unchanged**: still `HTTPS_STR_MATCH` on `"status":"ok"`, 30-second
  interval, three failures to flip. The string match is what makes green mean *DiveDay's own route
  answered* rather than *something returned a 200*, and it does not need a database to do that.
- A `200` here now proves: DNS resolves to this deployment, TLS terminates, the server booted, a
  route handler executes, and the build answering is the one named in `commit`. That is precisely
  the failure 20260907's Context calls the one that matters most — the one where nothing inside the
  deployment is running, so Sentry, the metric filters and the cron monitors all go quiet together.
- There is no failure branch, because a handler that cannot run cannot answer. A dead deployment
  produces Vercel's own 5xx or a timeout, which is what the monitor reads.

**Database liveness is covered three other ways, none of which polls:**

1. `/status` runs the real `checkDatabase()` in the request that renders it — on demand, by whoever
   is asking, which is the one moment the answer is worth paying for.
2. Sentry reports the first failing user request immediately. A database that is down while anyone
   is using the product is a Sentry issue within seconds.
3. Every cron's Sentry Cron Monitor is a dead-man's switch. A pass that cannot reach the database
   throws inside its `try`, which sends an `error` check-in rather than a silent 503, and the
   hourly passes make that at most an hour.

   This ADR is what makes that sentence load-bearing, and it was not true when the sentence was
   first written: `/api/cron/integrations` was the one route of eleven with no check-in at all —
   it captured exceptions, so a pass that ran and threw was visible and a pass that never ran was
   not. `sourcery-ai` caught it on the pull request. The monitor is added in the same change, with
   the route's first test, so the claim above holds for all eleven.

`scripts/dev-server.mjs` warms `/status` instead of `/api/health`. The warm's whole job is to spend
Turbopack's compile and PGlite's migrate-and-seed up front so the first real page does not, and a
health route that no longer reads the database would report `warmed in 0.4s` and leave the 26-second
surprise in place.

## Alternatives considered

- **Keep the database check and accept always-on compute** — ~182 CU-hours ≈ $19.35/month as the
  true price of the monitor, and if we are paying for always-on anyway, disable scale-to-zero so
  divers never eat a cold start. Rejected as the default because the cost buys ~1 hour of detection
  latency on one narrow failure (database down, nobody using the site) and nothing else. It remains
  the escape hatch below.
- **Cache the verdict in the route with a short TTL** — cuts queries ~30× and Vercel invocations
  with it, and keeps end-to-end verification. Does not change CU-hours at all, for the reason in
  Context, so it does not address why this ADR exists.
- **Narrow Route 53 to three checker regions** — ~5× fewer invocations, same structural problem.
  Worth doing on its own merits for the Vercel bill; it is not a fix for this and is not bundled
  here.
- **A separate low-frequency database probe** (its own route, its own health check on a long
  interval) — a second Route 53 check is $0.75/month and any interval under five minutes pins the
  compute exactly as before. An interval over five minutes is worse than the cron monitors we
  already have, which cost nothing.
- **Move the database check behind a heartbeat row written by the crons** — the probe reads the last
  recorded timestamp rather than querying live. Still a read, so still a wake-up; a durable store
  outside Postgres (Edge Config, KV) would be a new runtime dependency for a signal three existing
  mechanisms already carry.

## Consequences

- **A database failure that happens while nothing else is happening is noticed in up to an hour
  instead of ~4 minutes.** This is the whole cost of the decision and it is stated here so nobody
  has to rediscover it during an incident. Every other database failure — any traffic at all, any
  cron pass — is unchanged or faster.
- The incident runbook's "a 503 on `/api/health` is the database" reading is gone; `/api/health` no
  longer 503s for database reasons. `docs/engineering/incident-response-runbook.md` and the operator
  note in `infra/lib/observability.ts` are updated in this change: the first move on a suspected
  database problem is `/status`, not the probe.
- Neon's compute can reach its idle timeout again, which is what makes the cron cadences in
  `vercel.json` matter at all. They are aligned onto shared wake minutes in the same change; with
  both, the projected floor falls from ~182 CU-hours to ~31 plus whatever real use adds.
- `checkDatabase()` keeps one caller and stays a shared function rather than being inlined into
  `/status`, because the next thing that wants this question must get the same answer.
- **Escape hatch.** If detection latency on the no-traffic database failure ever proves to matter —
  a pilot shop reporting an outage we did not see, or a first booking morning we want belt-and-braces
  — the reversal is to restore the `select 1` and accept the always-on compute, priced above. Revisit
  when a shop is live on real bookings, when the database moves to something without scale-to-zero
  billing (see the H-04 provider question), or if Neon's idle timeout becomes configurable beyond
  five minutes.
