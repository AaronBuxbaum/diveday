# Realtime manifest events runbook

The boat manifest refreshes itself over an SSE stream backed by Postgres
`LISTEN`/`NOTIFY`. This document is about the one resource that design consumes
and cannot see: **Neon direct (unpooled) connections.**

- Design: [20260726-manifest-push-refresh](../architecture/decisions/20260726-manifest-push-refresh.md)
- Cost and transport: [20260804-manifest-push-transport](../architecture/decisions/20260804-manifest-push-transport.md)
- The bounds this runbook operates: [20260806-manifest-listen-connection-ceiling](../architecture/decisions/20260806-manifest-listen-connection-ceiling.md)

Code: `src/db/manifest-events.ts` (the connection and the dispatcher),
`src/app/api/trips/[id]/manifest-events/route.ts` (the stream),
`src/components/OfflineManifestManager.tsx` (the viewer and its fallbacks).

## How many connections a warm instance holds

**One. Never more, and only while it has a live viewer.**

Every SSE viewer on one warm instance shares a single dedicated `pg.Client`
issuing `LISTEN manifest_events`. It is the **direct** (`DATABASE_URL_UNPOOLED`)
connection, not the pooled one, because `LISTEN` needs a persistent session and
Neon's pooler runs PgBouncer in transaction mode, which cannot hold one.

The lifecycle, since 2026-08-06:

| Event | Connection |
| --- | --- |
| First subscriber arrives | dialled, `LISTEN` issued — logs `manifest_events.listen_opened` |
| More subscribers arrive or leave | unchanged — they share it |
| Last subscriber leaves | held for a further **120 s** (`LISTEN_IDLE_CLOSE_MS`) |
| A subscriber arrives inside those 120 s | the timer is cancelled; nothing was closed |
| 120 s elapse with nobody | closed — logs `manifest_events.listen_closed` |
| Connection drops on its own | reconnects with backoff, 2 s doubling to 30 s |
| Last subscriber leaves while it is failing to reconnect | retries stop at the 120 s mark |

So the fleet-wide count is **the number of warm instances with a manifest viewer
in the last two minutes**, not the number that have ever served one. Before this
change it was the second number, which only ever grew.

A viewer holds a stream continuously: the route retires each stream at 240 s and
the browser reconnects about 2 s later. One tablet with the manifest open all day
therefore holds a stream all day. If its reconnects land on different instances,
each of those instances dials, and the one it left goes quiet two minutes later —
so a single continuously-open viewer contributes a little more than one connection
at the margin, never many.

There is a second, unrelated bound in the route: **`MAX_MANIFEST_SUBSCRIBERS`
(500)** viewers per instance. That one does *not* reduce connections — an instance
holds one either way — it bounds the per-instance dispatch loop, heartbeat timers
and held streams. See ["When an instance is at its subscriber ceiling"](#when-an-instance-is-at-its-subscriber-ceiling).

## The ceiling this runs into

Neon's `max_connections` for **direct** connections is a function of the compute
size, not of the plan name, and it is small — on the smallest compute it is in the
low hundreds, and everything else the app does (migrations on deploy, any direct
`psql`) draws from the same budget. The pooled endpoint that serves ordinary
queries has a far larger ceiling and is not what this feature spends.

> **Read the real number from the Neon console** (project → your branch → compute
> size, and the connection-limit table in Neon's docs for that size) before making
> any decision that depends on it. It is the one number in this document the
> repository cannot derive, and it changes if the compute size is ever resized or
> autoscaling is enabled. Everything below is written in terms of "the ceiling"
> for that reason.

**What happens when it is hit.** Postgres refuses the dial with SQLSTATE `53300`
(`too_many_connections`; `53400` for a configuration limit). The module catches
it, logs `manifest_events.listen_connect_failed` with the SQLSTATE, and retries
with backoff. Nothing 5xxs and nothing crashes: the SSE streams on that instance
stay open and keep heartbeating, they simply never carry an event. The manifest
falls back to its poll — see ["What a viewer loses"](#what-a-viewer-loses).

The dangerous property is that this is invisible from every other angle. The page
renders, `/api/health` passes, no error rate moves. Before 2026-08-06 the refusal
was not even logged. **`manifest_events.listen_connect_failed` is the only signal
that this is happening.**

Note also that a database at its direct-connection ceiling will refuse a
*deploy's* migration step for the same reason, which is how this usually announces
itself if nobody is watching the log.

## Why a viewer pins an instance

Two separate things are pinned, and both matter.

**The Vercel instance.** An open SSE stream is a live invocation. On Fluid compute
the instance is billed for provisioned memory for its entire lifetime, "even during
I/O operations" — and an idle stream is 100% I/O wait. So a manifest open on a boat
tablet keeps an instance alive for as long as the page is open; it cannot be
reclaimed and the deployment cannot scale to zero while any viewer is watching.
[20260804-manifest-push-transport](../architecture/decisions/20260804-manifest-push-transport.md)
prices this in full, including the finding that matters most on the current plan:
a bad instance-sharing factor means one pilot shop can consume the project's whole
monthly compute allowance, and the failure mode is the *deployment* hitting its
limit, not a larger invoice.

**The Neon compute.** Neon autosuspends an idle compute. An open `LISTEN` session
is not idle. So for as long as any warm instance holds this connection, the
database compute stays awake. This is why the "never torn down once opened"
behaviour was worse than it looked: a single instance that served one manifest
stream in the morning kept Neon awake for the rest of its warm life, whether or
not anybody was looking at a manifest. The 120-second idle close is what gives
scale-to-zero back on a quiet night.

## What to watch

There is no gauge and no dashboard — the app cannot see a fleet-wide connection
count. What it emits instead is a bracketed pair of log lines, one per connection,
which an operator can count in the log drain.

| Line | Level | Means |
| --- | --- | --- |
| `manifest_events.listen_opened` | info | an instance just dialled a direct connection; `subscribers` is how many viewers it has |
| `manifest_events.listen_closed` | info | that instance released it (`reason: "idle"`) |
| `manifest_events.listen_connect_failed` | warn | a dial was refused; `sqlstate` says why, `retryInMs` when it will try again |
| `manifest_events.stream_at_capacity` | warn | an instance turned a viewer away; `refused` counts refusals since the last line |

**The number to track is opens minus closes over a window** — that is roughly how
many direct connections this feature is holding. Compare it against the ceiling you
read from the Neon console, not against a number in this document.

Two healthy patterns to recognise so they are not misread as faults:

- **Opens and closes in balance, on a lag.** A shop finishing for the day produces
  a close about two minutes after its last tablet is put away. Expect a small,
  steady churn during the day as instances cycle, not a flat line.
- **No lines at all.** Nobody has a manifest open. This is the correct steady state
  overnight, and it is the state that lets Neon suspend.

Two unhealthy ones:

- **Opens with no matching closes, accumulating.** Either viewership is genuinely
  growing, or something is holding subscriptions that should have been released.
  Cross-check `subscribers` on the `listen_opened` lines against how many shops are
  plausibly on the water.
- **Any `listen_connect_failed` with `sqlstate: "53300"`.** That is the ceiling,
  now. Go to the next section.

## As the ceiling approaches

In order, cheapest first.

1. **Confirm the connections are this feature's.** `select count(*) from
   pg_stat_activity where backend_type = 'client backend'` in the Neon console, and
   look for sessions whose `query` is `LISTEN manifest_events`. If they are not
   these, this runbook is the wrong one — check for a leaked migration or a
   long-running `psql`.
2. **Check the count against live viewership.** One connection per instance *with a
   viewer* is the contract. Many more connections than plausible concurrent
   manifest viewers means subscriptions are leaking rather than that demand grew;
   that is a code bug in the route's `stop()`/`cancel()` path and should be opened
   as one.
3. **Resize the Neon compute.** `max_connections` scales with compute size, so this
   is the one lever that moves the ceiling itself. It costs money and it is a
   product-owner decision, not an agent's.
4. **Fire the migration trigger.**
   [20260804-manifest-push-transport](../architecture/decisions/20260804-manifest-push-transport.md)
   already names "Neon direct-connection usage from the `LISTEN` clients becoming a
   binding constraint" as one of its three triggers, and designates **API Gateway
   WebSockets** as the target — which *deletes* this connection rather than
   relocating it. That record also costs the migration out (a few days, including a
   `security-reviewer` pass for the tenant-scoped connection registry).
5. **Emergency stop: delete the push channel, keep the poll.** Option E in that same
   record. Removing the `EventSource` in `OfflineManifestManager` costs cross-device
   roll-call changes up to five minutes of latency — the behaviour the product had
   before 2026-07-26 — and takes this feature's connection usage to zero
   immediately. It is a real option in an incident, not a last resort to be
   ashamed of.

Raising `LISTEN_IDLE_CLOSE_MS` is **not** on this list: shortening it would close
connections faster but re-dial into the same exhausted ceiling every four minutes,
which is worse. Lowering `MAX_MANIFEST_SUBSCRIBERS` is not on it either — it does
not reduce connections and can increase them by pushing viewers onto instances that
must then dial.

## When an instance is at its subscriber ceiling

`manifest_events.stream_at_capacity` means one instance is fanning out to
`MAX_MANIFEST_SUBSCRIBERS` (500) viewers and turned another away. At the stated
workload (~3 staff devices per shop) that is roughly 160 shops' entire manifest
fleet on one instance, so it should not happen; if it does, the first question is
whether subscriptions are leaking rather than whether the shop count grew.

A turned-away viewer receives a valid, immediately-ended event stream carrying
`retry: 60000` and comes back a minute later. It is deliberately **not** an error
status: `EventSource` never retries a non-200, so a 503 would cost that tab its
push channel for the life of the page instead of for a minute.

The line is damped to one per minute per instance and carries `refused` — the count
since the last line — because every turned-away viewer returns every minute to be
turned away again, and an undamped line would bury the event in its own repetition
exactly when the instance is already loaded.

## What a viewer loses

This is the part to be precise about, because "push is down" sounds worse than it is
and the difference matters on a safety-adjacent surface.

A viewer with no working stream — refused at the ceiling, or on an instance whose
`LISTEN` is down — keeps **every other refresh trigger**, all of which are
independent of the stream:

- a five-minute poll (`AUTO_REFRESH_MS`), which does not check visibility, only
  `navigator.onLine`;
- `online` and `visibilitychange` triggers;
- Web Push ([20260804-manifest-web-push](../architecture/decisions/20260804-manifest-web-push.md)),
  which reaches a device whose page is frozen and has no stream to deliver into at all.

Each of those calls `router.refresh()`, and the fresh payload is written back to the
device as a new encrypted snapshot. So **the offline snapshot's age stays under five
minutes**, against the fifteen (`OFFLINE_MANIFEST_CURRENT_MS`) that the freshness
pill on the manifest card is permitted to call "Fresh copy". The pill is computed
from the snapshot's own `savedAt`, never from whether a stream is up — so it cannot
report a freshness the missing stream took away, and if the poll stops too (no
signal, frozen tab) it tips to "Aging" and then "Stale" on its own.

The bound, stated plainly: **without the stream, a cross-device roll-call change
reaches a device within five minutes instead of within seconds.** That is exactly
the behaviour the product had before push existed, and it is the fallback
20260726 designated for a push that never arrives. Nothing goes stale without
saying so.

What no transport can fix, and worth repeating to anyone asking about this in an
incident: nothing guarantees a device is current at the instant its signal dies.
Only a deliberate refresh before departure does, which is what the "Refresh now"
control and the freshness pill exist for.

## Local dev and tests

There is no Postgres involved. With `DATABASE_URL` unset (PGlite — dev, unit tests,
e2e), `subscribeManifestEvents` and `publishManifestEvent` dispatch in-process
through the same listener set with the same `{shopId, tripId}` filtering, and no
connection is ever dialled, so none of the lifecycle above runs.

`connectAndListen` takes an injectable `createClient` (`NotifyClient` in
`src/db/manifest-events.ts`) so `src/db/manifest-events-listen.test.ts` can drive
LISTEN issuance, notification filtering, reconnect backoff, the idle close and the
`53300` path against a fake client. What no test in this repo covers, because no
real Postgres is involved, is the wire behaviour: whether a real Neon connection
delivers a `NOTIFY` fired from a pooled session to a `LISTEN`-ing direct one.
20260726 flags that as needing a manual check against a real Neon branch, and it
still does.
