# 20260804-manifest-push-transport — Keep SSE on Vercel for now; API Gateway WebSockets is the designated migration target

- **Status:** Proposed
- **Date:** 2026-08-04

## Context

[20260726-manifest-push-refresh](20260726-manifest-push-refresh.md) chose SSE on a Vercel function,
fanned out from one Postgres `LISTEN` client per warm process. That record's own Consequences flagged
the cost/scale question as unresolved ("if Neon's direct-connection limit becomes a real constraint,
the escape hatch is …"), and its 2026-08-04 amendment — bounding the stream so Vercel stops killing
it at the duration cutoff — made the shape of the cost visible rather than changing it. This record
answers the question that amendment left open: **what does holding these connections actually cost,
and on which transport.**

The workload is unusual and drives everything below. A manifest page sits open on a boat tablet for a
whole dive day, and almost nothing happens on it:

- **Connection time is enormous.** Assume 3 staff devices per shop with the manifest open, 8 h/day,
  26 days/month → **624 device-hours per shop-month**.
- **Message volume is trivial.** Roll call generates on the order of 100 writes/day/shop, fanned to 3
  devices → **~7,800 deliveries per shop-month**, about 12 messages per connection-hour.

That ratio is the whole decision. This is a *connection-heavy, message-trivial* workload, so any
transport priced by connection time or held compute is expensive here, and any transport priced by
message is nearly free. Two constraints bound the answer: [ADR-0001](0001-nextjs-fullstack.md) keeps
us on one Next.js app with no separate backend, and
[20260802-aws-cost-guardrails](20260802-aws-cost-guardrails.md) sets the AWS budget alarm at **$5/month**
with a "this is outside normal bands" siren at ~$10 — so an option with a double-digit monthly floor
trips this repo's own alarms on day one at current scale.

**Fluid compute is confirmed enabled on this project** (product owner, 2026-08-04), which settles two
things this analysis would otherwise have to hedge. First, the Active-CPU-plus-Provisioned-Memory model
below is the one that applies, not the legacy GB-Hour model. Second, **optimized concurrency is
actually in play** — multiple invocations share one instance on the Node.js runtime, which is what
makes an always-open idle stream survivable here at all, and what makes the cheap end of the range
below the more likely one. It does not make the range go away: the number of concurrent streams per
instance is still not published.

Prices below are **us-east-1 / `iad1`, checked 2026-08-04**, and must be re-verified before anyone
spends against them.

## Decision

**Keep SSE on Vercel (the merged design) and gate it on tab visibility. Designate Amazon API Gateway
WebSockets as the migration target, to be adopted when a stated trigger fires — not before.**

Concretely:

1. **Now, no new infrastructure.** Close the `EventSource` on `visibilitychange → hidden` and reopen
   on visible. `OfflineManifestManager` already refreshes on visibility-return, so this costs nothing
   in correctness and removes every hour a tablet spends backgrounded or pocketed from the bill. This
   multiplies the dominant cost term by the foreground fraction and is roughly ten lines.
2. **Measure before spending.** The status-quo cost spans a **100× range** (below) entirely because of
   an unpublished Vercel heuristic. No migration is justified on estimates when the estimate's own
   uncertainty is larger than the difference between the options. The measurement is the provisioned
   memory attributable to this route in Vercel's usage dashboard, over a week of real shop traffic.
3. **The trigger for migrating** is either of: measured provisioned-memory cost for this route
   exceeding **$5/month**, or Neon direct-connection usage from the `LISTEN` clients becoming a
   binding constraint.
4. **When triggered, migrate to API Gateway WebSockets**, not to a container and not to a third-party
   realtime service — for the cost reasons below, and because it *deletes* the `LISTEN` client rather
   than relocating it (see "What the WebSocket option also buys").

## Cost analysis

Per shop-month, at the workload stated above (624 connection-hours, ~7,800 messages).

| Option | Priced on | Cost / shop-month | Cost at 10 shops | Notes |
| --- | --- | ---: | ---: | --- |
| **A. SSE on Vercel Fluid** (status quo) | provisioned memory × instance-hours | **$0.13 – $13.23** | $1.30 – $132 | 100× range; see below |
| **B. API Gateway WebSockets** | connection-minutes + messages | **~$0.02** | ~$0.20 | plus trivial Lambda/DynamoDB |
| **C. Ably / Pusher** | peak concurrent connections | **$49/mo flat** (Pusher Startup) | $49/mo flat | floor, not marginal |
| **D. Always-on container** | wall-clock, flat | **~$25/mo flat** | ~$25/mo flat | Fargate task + load balancer |
| **E. No push; keep the 5-min poll** | active CPU | **~$0.05** | ~$0.50 | costs 5 min of latency |

### A. SSE on Vercel Fluid — $0.13 to $13.23, and we cannot narrow it from here

Fluid bills **Active CPU** at $0.128/h and **Provisioned Memory** at $0.0106/GB-h. The critical rule:
memory is "billed for the entire instance lifetime in GB-hours … even during I/O operations." An idle
SSE stream is 100% I/O wait, so it pays no CPU and pays memory continuously. Memory is the only term
that matters:

- **CPU** — each reconnect runs `auth()` plus one trip lookup, ~30 ms. At 15 reconnects/h × 624 h =
  9,360 reconnects → ~281 CPU-seconds → **$0.01**.
- **Invocations** — 9,360/shop-month at $0.60/M → **$0.006** (inside Hobby's 1M allowance).
- **Memory** — a 2 GB instance costs $0.0212/instance-hour. The bill is per *instance*-hour, not per
  *connection*-hour, and Fluid's optimized concurrency (enabled, and available on this route's Node.js
  runtime) shares one instance across many concurrent invocations. **Vercel publishes no per-instance
  concurrency number**, so the sharing factor — and therefore the bill — is the one unknown:

  | Streams sharing one instance | Memory cost / shop-month |
  | ---: | ---: |
  | 1 | $13.23 |
  | 10 | $1.32 |
  | 50 | $0.26 |
  | 100 | $0.13 |

This is the finding that shapes the decision. The status quo is either negligible or the most
expensive option on the table, and which one depends on a platform heuristic we cannot read from the
outside. That is a bad thing to build a migration on in either direction — hence "measure first." With
Fluid confirmed on, the single-stream-per-instance row is a worst case that should not actually occur;
it is kept as the bound, not the estimate.

One plan note, since it constrains the merged design: with Fluid, **Hobby's max duration is 300 s and
that is also its ceiling**, while Pro allows 800 s (1800 s in beta). The merged route declares
`maxDuration = 300` and retires its stream at 240 s, which is therefore valid on either plan and needs
no change if the project moves between them.

Also unpriced but real: one Neon **direct** (unpooled) connection per warm process for `LISTEN`, which
is the scarcer Neon resource, and which 20260726 already names as this design's accepted MVP limit.

### B. API Gateway WebSockets — ~$0.02, and the pricing axis matches the workload

Priced at **$0.25 per million connection-minutes** and **$1.00 per million messages** (metered in 32 KB
increments). Free tier: 1M messages and 750,000 connection-minutes/month for 12 months.

- **Connection-minutes** — 624 h = 37,440 min → **$0.0094**.
- **Messages** — 7,800 deliveries → **$0.0078**.
- **Keepalive** — the **10-minute idle timeout is a hard, non-increasable quota**, and browsers cannot
  send protocol-level ping frames from JavaScript, so the keepalive must be an application message and
  *is* metered: ~53/device/day × 3 × 26 = 4,134 → **$0.004**. (Protocol `ping`/`pong` control frames
  are explicitly not metered — they are simply not reachable from browser JS.)
- **Connect/disconnect Lambdas** — the **2-hour maximum connection duration is also a hard quota**, so
  each device reconnects 4× per 8-hour day: 312 connects + 312 disconnects = 624 invocations →
  effectively **$0**.
- **Connection registry** — DynamoDB on-demand, ~1,200 writes/deletes and one query per publish →
  pennies, likely inside free tier.

**Total ≈ $0.02/shop-month**, about **$0.25/shop-year**. At 100 shops it is roughly $2/month. The two
hard quotas (2 h max, 10 min idle) are not obstacles: the merged SSE design already reconnects every 4
minutes, so the client discipline this needs is the discipline it already has.

#### What the WebSocket option also buys

The publish path changes shape in a way that is worth more than the money. `recordRollCall` already
runs inside a Vercel function; it can call `PostToConnection` directly against the registry. That means
**the Postgres `LISTEN` client disappears entirely** — and with it the per-process reconnect/backoff
state machine, the Neon direct-connection pressure, and the one part of this feature that 20260726
admits has no real-Postgres test coverage ("whether a real Neon connection really delivers a `NOTIFY`
fired from a pooled session to a `LISTEN`-ing direct one"). Deleting the least-tested component is a
larger win than $13/month.

#### What it costs to build

Not free, and the ADR should say so plainly:

- **Auth is harder.** A browser `WebSocket` cannot set headers, so the session cannot ride in one. It
  needs a short-lived, shop- and trip-scoped capability token in the query string, validated by a
  Lambda authorizer — the same capability-URL pattern as `/waivers/[token]`, and subject to the same
  care (see [the capability telemetry runbook](../../engineering/capability-telemetry-runbook.md)).
- **WebSocket has no CORS**, so the authorizer must validate `Origin` itself.
- **Tenant isolation moves into the registry.** Fan-out reads connection IDs from a table rather than
  filtering in one process's memory, so the registry row must carry `shopId` and the query must be
  scoped by it. This is a `security-reviewer` change under AGENTS.md's hard rules.
- Two new CDK surfaces (the API + the registry) in `infra/lib/infra-stack.ts`.

### C. Ably / Pusher — the worst possible fit on price

These are priced on **peak concurrent connections**, which is precisely the axis this workload is
heavy on, and they effectively give away the axis we barely use. Pusher's Startup tier is $49/month for
500 concurrent connections; Ably's free tier stops at 200 concurrent. So the *floor* is ~2,000× option
B's variable cost, for a workload whose entire message volume would fit in anyone's free tier. Fastest
to implement, and 20260726 already rejected it for adding a paid runtime dependency; the cost shape
makes that rejection stronger, not weaker.

### D. Always-on container (Fargate / App Runner / Fly)

A single small always-on task holding the `LISTEN` and fanning out is ~$9/month, plus ~$16/month for a
load balancer. Flat with respect to shops, so it is the cheapest option *eventually* — it beats option
A's worst case at about 2 shops and beats nothing else until far higher volume. Two problems now: it
trips the existing $5/month AWS budget alarm immediately, and it reintroduces a long-running server,
which [ADR-0001](0001-nextjs-fullstack.md) deliberately does not have. Revisit only if API Gateway's
per-message model somehow stops fitting.

### E. No push at all — and a note on which resource each choice burns

Deleting the SSE endpoint costs nothing to run and gives back up to 5 minutes of latency on
cross-device roll-call changes, which is what the product did before 20260726. Worth noting that the
poll is *not* free, and is interestingly the opposite shape: each `router.refresh()` is a full RSC
render, so 96 polls/device/day × 3 devices × 26 days = 7,488 renders/shop-month at ~200 ms active CPU
≈ 0.42 CPU-h → **~$0.05**.

That inverts the usual intuition and is the most useful thing in this analysis:

> **Polling trades memory-hours for CPU-hours; streaming trades CPU-hours for memory-hours.** Fluid
> prices memory at $0.0106/GB-h against CPU at $0.128/h — roughly 12× cheaper — which is the only
> reason an always-open idle stream is survivable on Vercel at all.

## Alternatives considered

- **Migrate to API Gateway WebSockets immediately** — right target, wrong time: the status-quo cost is
  unmeasured and may already be $0.13/shop-month, in which case this spends a security-sensitive
  change and two CDK surfaces to save nothing.
- **Keep SSE but move it off Vercel to API Gateway** — API Gateway does not proxy SSE as a streaming
  transport; its long-lived-connection product *is* the WebSocket API. Choosing that endpoint means
  choosing WebSockets.
- **WebSockets on Vercel instead of SSE** — changes nothing about the cost, which is held-instance
  memory, not the framing protocol. SSE is also the smaller primitive for a channel that only ever
  pushes one way, as 20260726 already reasoned.
- **Raise the SSE stream lifetime to Pro's 800 s or the 1800 s beta** — fewer reconnects, but reconnects
  are the negligible term ($0.016 of a bill that is otherwise memory). It would cut invocations we are
  not paying much for while leaving the memory-hours identical.
- **Third-party realtime (Ably/Pusher)** — priced on the exact axis this workload maxes out; see C.
- **Always-on container** — cheapest at scale, trips the $5 budget alarm now, reintroduces a server;
  see D.
- **Delete push, keep the poll** — genuinely viable and nearly free; rejected as the *default* only
  because roll call is safety-adjacent and 20260726 already judged 5-minute staleness worth improving.
  It remains the correct answer if the trigger fires and nobody wants to build the WebSocket path.

## Consequences

Nothing is spent and nothing is migrated today; the visibility gate is a pure reduction with no
architectural commitment, and every option above stays open behind it. The cost of waiting is bounded
by option A's worst case, which at present scale (a handful of pilot shops) is at most tens of dollars
a month and is visible in Vercel's usage dashboard before it becomes a surprise.

What this commits us to is **measuring before migrating**. The 100× range is not a gap that more
analysis can close — it is a property of the platform's published pricing model, and only observed
usage resolves it. If measurement lands at the cheap end, this ADR's answer is "SSE was already right"
and the WebSocket design stays on the shelf.

**Escape hatch and migration cost.** If the trigger fires, the WebSocket migration is: one API Gateway
WebSocket API + authorizer Lambda + connection registry in CDK; a token-minting route in the Next app;
`recordRollCall` calling `PostToConnection` instead of `pg_notify`; `OfflineManifestManager` swapping
`EventSource` for `WebSocket`; and deletion of `src/db/manifest-events.ts`'s `LISTEN` client. Call it a
few days including the `security-reviewer` pass that the tenant-scoped registry requires. The
poll/reconnect/visibility fallback in `OfflineManifestManager` is untouched by any of this and remains
the backstop under every option here — which is what makes all of them reversible.

## Sources

Rates and quotas verified 2026-08-04; re-verify before spending.

- [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing) — Active CPU, Provisioned
  Memory, regional rates, and the "billed during I/O" rule.
- [Fluid compute](https://vercel.com/docs/fluid-compute) — optimized concurrency / instance sharing.
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations) — max duration per plan.
- [Amazon API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) — WebSocket message and
  connection-minute rates, free tier, unmetered control frames.
- [WebSocket API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html)
  — 2-hour connection duration and 10-minute idle timeout, both non-increasable.
