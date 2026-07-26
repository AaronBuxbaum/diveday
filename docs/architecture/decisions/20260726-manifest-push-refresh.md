# 20260726-manifest-push-refresh — Push the offline manifest refresh over SSE, backed by Postgres LISTEN/NOTIFY

- **Status:** Accepted
- **Date:** 2026-07-26
- **Supersedes (in part):** [20260726-manifest-offline-copy-automation](20260726-manifest-offline-copy-automation.md)'s
  closing paragraph, which left refreshing "still polling ... not push" and deferred a push channel to
  its own ADR. This record is that ADR. Everything else in that record — automatic save/refresh
  triggers, the retention window, the self-heal-on-read-failure and keep-if-pending-events fixes, and
  the removed delete button — is unchanged.

## Context

The offline manifest copy (`OfflineManifestManager`) refreshed on a five-minute `setInterval`, plus
`online`/`visibilitychange` triggers. 20260726 deliberately deferred replacing the interval with a push
channel, calling out two real constraints that any implementation has to answer: this app is hosted on
Vercel serverless functions with Neon Postgres (20260718-vercel-neon-hosting) — no free long-lived
connection primitive — and the surface being refreshed is specifically the *offline* boat manifest,
where the whole point is tolerating unreliable signal. A push channel only helps a connected device; it
cannot replace the reconnect/visibility/interval fallback a boat losing signal still needs.

`recordRollCall` (`src/db/manifests.ts`) is the single choke point for every roll-call write — both the
live manifest page's server action and the offline-sync API route (`src/app/api/offline-manifests/sync`)
call it. It is the one place "the live manifest changed" can be raised for every writer at once.

## Decision

Add a `manifest_events` signal, "trip X's roll call changed," raised from `recordRollCall` after a
non-duplicate write commits, and consumed by a new SSE endpoint the offline manifest manager now opens
alongside its existing interval:

- **Transport:** `GET /api/trips/[id]/manifest-events` streams `text/event-stream` on the Node.js
  runtime (not Edge — the listener needs the `pg` driver). Staff-session-gated the same way the manifest
  page itself is, plus the same shop-ownership check `getTripWithBooked` already enforces elsewhere, so
  one shop's stream can never observe another shop's trip. A 25-second `: ping` comment keeps
  intermediate proxies/load balancers from timing out an idle stream; the client's native `EventSource`
  reconnects on its own if the stream still closes (a Vercel `maxDuration` cutoff, a dropped connection).
  The route checks `request.signal.aborted` before registering its abort listener, not only after —
  a client that disconnects while `auth()`/`getDb()`/the trip lookup were still awaiting can abort the
  signal before the stream's `start()` callback ever runs, and a listener registered after the fact
  never sees an abort that already fired; without the check that leaks the subscription and heartbeat
  interval for the rest of the warm process's life. The stream also defines a `cancel()` hook, not just
  the `start()`-registered abort listener — a consumer can cancel the response body directly (a test
  harness's `reader.cancel()`, or a downstream adapter) without `request.signal` itself ever aborting,
  and without `cancel()` that leaves the subscription registered; the next notification then throws
  enqueuing onto the now-cancelled controller, which (since the shared dispatch loop isn't
  per-subscriber isolated) can stop delivery to every other subscriber sharing that process, not just
  this one.
- **Fan-out — one shared LISTEN client per warm process, not one per viewer:** `src/db/manifest-events.ts`
  lazily opens a single dedicated `pg.Client` per process and issues `LISTEN manifest_events`; every SSE
  request in that process subscribes to the same in-memory dispatcher, filtering by `{shopId, tripId}`.
  This is *why* it's a shared client rather than per-connection: `NOTIFY`/`LISTEN` needs a persistent
  session, which Neon's pooled `DATABASE_URL` (PgBouncer transaction mode) cannot hold — the dedicated
  client always dials `DATABASE_URL_UNPOOLED` (falling back to `DATABASE_URL`, matching
  `vercel-build.mjs`'s existing fallback), same reasoning `20260718-vercel-neon-hosting` already applied
  to migrations. It reconnects with exponential backoff (2s–30s) on error/close, resetting back to the
  base delay once a reconnect's `LISTEN` actually succeeds — so a connection that drops again after a
  long healthy run retries quickly rather than being stuck at whatever it escalated to on its way up —
  and is never torn down once opened — an idle direct connection is cheap, and reconnect churn on every
  subscriber count hitting zero is not worth avoiding it.
- **Publish:** stays on the pooled `DATABASE_URL` connection — `select pg_notify('manifest_events',
  json)` is a single statement, not a session-scoped one, so PgBouncer transaction mode is fine for it.
  `recordRollCall` and `updateLatestRollCallNote` both `await` it (not fire-and-forget) — an unawaited
  promise can be frozen mid-flight the instant a serverless function's response completes, the same
  lifecycle problem `src/app/forgot-password/actions.ts` already solved once with `after()`. This call
  site can't reach for `after()` the same way, since `recordRollCall` runs outside any request scope in
  its unit tests; `publishManifestEvent` instead catches and swallows its own failure internally, so
  awaiting it costs one extra cheap round-trip on an already-open connection and never turns a publish
  failure into a roll-call failure — the existing poll/reconnect/visibility fallback is still the
  backstop for a push that never arrives.
- **Dev/test:** when `DATABASE_URL` is unset (PGlite), the same module dispatches in-process via a plain
  listener set instead of touching Postgres at all — same public functions, same filtering semantics, no
  real LISTEN/NOTIFY involved. This is what the test suite exercises; the Postgres LISTEN/NOTIFY wiring
  itself has no automated test (see Consequences) and needs a manual check against a real Neon branch
  before this ships.
- **Client-side reconcile is serialized, not just triggered:** a device reconciling a backlog of offline
  events publishes one signal per event (`recordRollCall` fires once per write), and that same device is
  normally subscribed to its own trip's stream — so applying N queued events can trigger N pushes back to
  itself while its own sync request is still in flight (`syncOfflineManifest` only resolves the pending
  IndexedDB records once its own response lands). `OfflineManifestManager`'s `reconcile` uses the same
  in-flight/queued-follow-up pattern `save` already does, so a burst of triggers collapses into the
  current sync plus at most one more pass, never N overlapping `syncOfflineManifest` calls resubmitting
  the same batch.
- **The five-minute interval and reconnect/visibility triggers in `OfflineManifestManager` are
  unchanged** — they become the fallback path (SSE unavailable, blocked by a captive portal, or this
  process's LISTEN client is mid-reconnect) rather than the primary one. This is deliberate, not a
  leftover: it is exactly the case 20260726 already reasoned through for a boat with unreliable signal.
- **Scope:** only roll-call writes raise the signal, matching what 20260726 anticipated ("the moment roll
  call changes elsewhere") — both the boarded/not-boarded/cleared events `recordRollCall` inserts and a
  note edited in place afterward through `updateLatestRollCallNote` (the note is part of the roll-call
  record the offline copy shows). Other manifest-affecting writes (add/remove diver, waiver completion,
  crew changes) still reach the offline copy only via the interval/reconnect/visibility fallback, same as
  before this change. Extending the signal to those call sites is a follow-up, not bundled here.
- **The live (online) manifest page itself is not wired to this signal.** It already re-renders on its
  own actions via `revalidatePath`; making it live-update from *other* staff's actions is a separate,
  larger UI question (which row updates, how) and out of scope here.

## Alternatives considered

- **Third-party realtime service (Pusher/Ably/PartyKit/Supabase Realtime)** — offloads the
  persistent-connection problem to infrastructure built for it, and would scale past a single warm
  process better than the shared-LISTEN-client design above. Rejected for now: it is a new paid runtime
  dependency (AGENTS.md hard rule: new runtime dependency → ADR) with its own key/ops-owner question, and
  Postgres LISTEN/NOTIFY already covers this app's expected concurrency (a handful of staff devices per
  shop) without adding one.
- **One dedicated LISTEN connection per SSE viewer** — simpler to reason about in isolation, rejected
  because it multiplies Neon direct-connection usage by concurrent viewers instead of by warm processes;
  direct connections are the scarcer resource on Neon's connection limits, not the app-level fan-out.
- **WebSocket gateway** — bidirectional is unneeded here (the manifest page never needs to send anything
  over this channel); SSE is the smaller primitive and Next.js route handlers support it directly, no
  separate gateway process.
- **Extend the NOTIFY signal to every manifest-affecting write now (bookings, waivers, crew)** — rejected
  for this change to keep the failure-mode analysis bounded to one call site; roll call is also the
  highest-value case, since it is the change most likely to happen while the boat itself is mid-trip.

## Consequences

A connected device sees another device's roll-call change within the SSE stream's latency instead of
waiting up to five minutes — the scenario 20260726 named as the reason to revisit. Nothing about the
offline-boat failure mode gets worse: the interval/reconnect/visibility fallback is untouched, so a
device that never manages to hold the SSE connection open behaves exactly as it did before this change.

New failure surface this change owns: the shared LISTEN client is process-local, so on Vercel's classic
per-request-instance model (no Fluid Compute warm reuse), each concurrent SSE viewer's request may get
its own process and therefore its own direct connection — the "shared client" saving only materializes
when Vercel keeps an instance warm across concurrent requests. This is an accepted MVP limit given
today's expected concurrency (a handful of staff phones per shop); if Neon's direct-connection limit
becomes a real constraint, the escape hatch is the third-party-service alternative above, or moving
publish/subscribe to a single dedicated long-running process (a small always-on Node service) instead of
riding serverless instances. `connectAndListen`'s `pg.Client` is injectable (`NotifyClient` in
`src/db/manifest-events.ts`) specifically so `src/db/manifest-events-listen.test.ts` can drive LISTEN
issuance, notification filtering/parsing, and reconnect-with-backoff against a fake client — that suite
covers the module's own logic. What it cannot cover, because no real Postgres server is involved, is the
actual wire-level behavior: whether a real Neon connection really delivers a `NOTIFY` fired from a
pooled session to a LISTEN-ing direct one, session/pooling quirks specific to Neon, and connection-limit
behavior under real concurrency. Verify that by hand against a real Neon branch before relying on it in
production; a bug there degrades silently to "always falls back to the poll," not to a crash, which is
the intended failure direction but still worth knowing before merge.
