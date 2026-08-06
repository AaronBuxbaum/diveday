# 20260806-manifest-listen-connection-ceiling — Close the shared LISTEN connection when no viewer is left, and cap subscribers per instance

- **Status:** Accepted
- **Date:** 2026-08-06
- **Amends:** [20260726-manifest-push-refresh](20260726-manifest-push-refresh.md)'s fan-out bullet,
  specifically the clause "and is never torn down once opened — an idle direct connection is cheap,
  and reconnect churn on every subscriber count hitting zero is not worth avoiding it." That clause is
  withdrawn. Everything else in that record — the transport, the stream retirement, the publish path,
  the dev/test in-process mode, the scope — is unchanged.

## Context

`src/db/manifest-events.ts` opens one dedicated Neon **direct** (unpooled) `pg.Client` per warm
process and issues `LISTEN manifest_events`; every SSE viewer in that process subscribes to an
in-memory dispatcher. 20260726 chose that shape deliberately, and it is still the right shape: a
connection per *viewer* would multiply the scarcest Neon resource by concurrent viewers instead of by
warm processes.

What that record got wrong is the *end* of the connection's life. It decided the client is never torn
down, on the reasoning that an idle direct connection is cheap. Three things make that reasoning
wrong, and none of them are about the connection being idle:

1. **It is held by an instance's history, not by a viewer.** The connection opens on the first
   subscriber and then survives every subscriber leaving. An instance that served one manifest stream
   at 08:00 still holds a direct connection at 18:00 while serving nothing but bookings and waivers.
   The population of connection-holding instances is monotonic over the life of the deployment's warm
   set — it only ever grows.
2. **A held session prevents Neon's compute from suspending.** Neon autosuspends an idle compute; an
   open `LISTEN` session is not idle. So one warm instance that once served a manifest stream keeps
   the database's compute awake indefinitely, which on a scale-to-zero plan is not a rounding error —
   it is the plan not working.
3. **Running out is silent.** When Postgres refuses with `53300 too_many_connections`, the module
   caught the error and retried with backoff, logging nothing. Push simply stopped working on that
   instance while every surface kept reporting healthy — and the only visible symptom was manifests
   feeling slower to update.

[20260804-manifest-push-transport](20260804-manifest-push-transport.md) already names "Neon
direct-connection usage from the `LISTEN` clients becoming a binding constraint" as one of the
triggers for migrating off this transport, and calls the connection cost "unpriced but real." This
record prices it and bounds it, so that trigger is something an operator can actually watch rather
than discover.

The subscriber set has a second, smaller unboundedness: nothing capped how many SSE viewers one
instance fans out to. Each costs a held stream, a 25-second heartbeat timer, and a slot in the
dispatch loop every NOTIFY walks.

## Decision

**A viewer holds the connection, not an instance's memory of having had one.** Two bounds, doing two
different jobs — and it matters which does which:

1. **Idle close (`LISTEN_IDLE_CLOSE_MS`, 120 s).** The first subscriber opens the shared connection;
   the last one to leave arms a timer, and if nobody has arrived when it fires, the connection is
   closed. A subscriber arriving inside the window cancels it. **This is the bound on Neon direct
   connections.** After it, the number of direct connections this feature holds is the number of
   warm instances with a live manifest viewer (plus at most two minutes of tail), not the number that
   have ever had one.

   120 s is chosen against the churn 20260726 objected to. The churn a viewer produces is its own
   reconnect: the route retires each stream at 240 s and the client returns about 2 s later. A
   linger 60× that gap means a reconnecting viewer never closes anything; only an instance that has
   genuinely stopped serving manifest streams does.

   Closing is generation-counted. Every `connectAndListen` attempt captures a generation; closing
   bumps it. A reconnect timer scheduled by a connection that has since been closed, or a dial still
   in flight when the close lands, checks the generation and abandons itself rather than reviving a
   connection nobody is listening on. This also means an instance whose LISTEN cannot connect —
   exactly the state a connection ceiling produces — **stops retrying** once its last viewer leaves,
   instead of adding load to a database that is already out of connections.

2. **Subscriber ceiling (`MAX_MANIFEST_SUBSCRIBERS`, 500), enforced in the route.** A viewer arriving
   at an instance already fanning out to 500 is turned away. **This is not a connection bound** — an
   instance holds exactly one direct connection whether it serves 1 viewer or 500, and a turned-away
   viewer may land on an instance that then dials one of its own, so at the margin this trades a
   connection for isolation. It is a bound on the per-instance structures: the dispatch loop, the
   heartbeat timers, the held streams. It is a safety valve, not a routine limit. At this feature's
   stated workload (20260804: ~3 staff devices per shop with the manifest open) 500 is roughly 160
   shops' entire manifest fleet on one instance.

**The refusal is a valid, immediately-ended event stream carrying `retry: 60000`, not an error
status.** `EventSource` treats a closed stream as a reconnect and honours the hint; it treats a
non-200 as a permanent failure it never retries. An error status would cost that tab its push channel
for the life of the page rather than for a minute.

**Both new states narrate themselves.** `manifest_events.listen_opened` /
`listen_closed` bracket every direct connection this feature holds — the only handle an operator has
on the count, since nothing else in the app can see it. `listen_connect_failed` carries the SQLSTATE
(a code, never the message, which can carry connection detail), so `53300` is legible as the ceiling
rather than as an unexplained absence of push. `stream_at_capacity` is damped to one line per minute
per instance and carries the refusal count, for the same reason `checkRateLimit`'s fail-open reporter
is: the line fires exactly when the instance is already under the load that produced it, and every
turned-away viewer returns every 60 s to be turned away again.

**Nothing degrades silently.** This is the constraint the design is held to, and it is met by
arithmetic rather than by a promise. A viewer with no stream — refused at the ceiling, or served by an
instance whose LISTEN is down — still has `OfflineManifestManager`'s five-minute poll, its
`online`/`visibilitychange` triggers, and Web Push, all independent of the stream. Each poll calls
`router.refresh()` and re-saves the offline snapshot, so the snapshot's age stays under five minutes,
which is a third of the fifteen (`OFFLINE_MANIFEST_CURRENT_MS`) the freshness pill is permitted to
call "current". The pill reads the snapshot's own age and never the stream's state, so it cannot
claim a freshness the refusal took away — and if the poll stops too (offline, frozen tab), the pill
tips to "Aging" on its own. The degraded state is therefore bounded to the staleness the product had
before push existed at all, which 20260726 already designated as the backstop.

## Alternatives considered

- **Close immediately when the last subscriber leaves.** Simplest, and wrong for the reason 20260726
  gave: a viewer's own four-minute stream retirement would close and re-dial the connection every
  four minutes on every instance, turning a steady state into constant churn — and a re-dial that
  lands in a `53300` window loses push for a viewer who never went anywhere. The linger costs at most
  two idle minutes per instance and removes that entirely.
- **A much longer linger (say 30 minutes).** Closer to the old behaviour, and it gives back most of
  the win: the whole problem is instances holding connections while serving nothing, and half an hour
  of that per instance is most of a dive day's worth across a warm set.
- **Cap direct connections per instance instead of subscribers.** There is nothing to cap — the
  design already holds exactly one. The count that matters is across instances, which no instance can
  see. That is what the log lines are for.
- **A refusal as HTTP 503.** Honest as a status code and wrong as a behaviour: `EventSource` never
  retries a non-200, so the viewer loses push until the page is reloaded, turning a one-minute
  degrade into an indefinite one. The status code would be read by nobody and the cost paid by a
  captain.
- **Show the viewer that push is degraded.** Considered and rejected as a *requirement*, not as an
  idea. The manifest card already carries a freshness pill computed from the snapshot's own age, and a
  second indicator for "the push channel specifically is down" would be a technical detail on a
  safety-adjacent surface whose answer is always "nothing, it refreshes anyway." If the poll ever
  stopped covering the gap, the pill is where that must show, and it already would.
- **Migrate to API Gateway WebSockets now**, which deletes the LISTEN client entirely
  ([20260804-manifest-push-transport](20260804-manifest-push-transport.md) §B). Still the designated
  target, still gated on the same measured trigger. This record is what makes one of those triggers
  observable; it is not a substitute for the migration and does not move the trigger.
- **Keep the connection but drop `LISTEN` when idle.** `UNLISTEN` releases the subscription, not the
  session — the direct connection, which is the scarce thing, would still be held. It saves nothing
  that matters and adds a third state to reason about.

## Consequences

The direct-connection count this feature contributes stops being a function of the deployment's warm
history and becomes a function of live viewers. On a quiet night it reaches zero, which it previously
could not, and Neon's compute can suspend again — the scale-to-zero the plan is priced on.

The cost is a re-dial after every two-minute gap in viewership on an instance, and a re-dial can fail.
It fails into the same state a drop already did: backoff, no push, the poll covering it. The
connection-open path is a little more likely to be exercised than before, which is an argument for its
logging, not against the change.

`MAX_MANIFEST_SUBSCRIBERS` may never fire. Vercel does not publish a per-instance concurrency number
(20260804 makes that the central unknown of the cost analysis), so 500 concurrent invocations on one
instance may not be reachable at all. It stays because an unbounded structure that nobody is watching
is a worse thing to own than a ceiling that never trips, and because the refusal path is now tested
rather than hypothetical.

What this does **not** fix: connection usage across instances is still unmeasured from inside the app,
and the ceiling is still Neon's, not ours. The log lines make it countable — see
[the realtime manifest events runbook](../../engineering/realtime-manifest-events-runbook.md) — but
counting them is an operator errand, not an automatic one. Wiring `listen_opened`/`listen_closed`
into an actual gauge is the obvious follow-up and is deliberately not bundled here.

Reversibility: the linger and the ceiling are two constants. Setting `LISTEN_IDLE_CLOSE_MS` to
`Number.POSITIVE_INFINITY` restores 20260726's behaviour exactly. The generation counter and the log
lines are worth keeping either way.
