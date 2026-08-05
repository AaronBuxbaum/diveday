# 20260804-ios-native-shell — Record a native iOS shell as the escape hatch for background sync, and what it would and would not buy

- **Status:** Proposed
- **Date:** 2026-08-04

## Context

[20260804-manifest-web-push](20260804-manifest-web-push.md) closed the pocket case on the web platform
as far as it goes: a compiled service worker now writes the offline snapshot on push and flushes
pending roll-call events on Background Sync. It also documented where that stops, and the stopping
point is one platform.

**Safari has never implemented Background Sync** — not in a tab, and not in a Home Screen web app
either. That last part is the trap: installing to the Home Screen is what unlocks Web Push on iOS, so
it is natural to assume it unlocks the other background APIs too. It does not, and WebKit has
published no position suggesting it will.

So on an iPhone the outbound path — getting roll call recorded at sea back to the shop — is
opportunistic: it happens when a push happens to arrive, or when a human opens the app. Those events
*are the record of who came back aboard*, which makes this the sharpest remaining gap in the offline
manifest, and the reason to write down what a native shell would actually change before anyone reaches
for one under pressure.

This record does not propose building it. It records the option, its real ceiling, and the trigger.

## Decision

**Keep the PWA. Record a Capacitor-based iOS shell as the escape hatch, to be reconsidered only
against a measured trigger — and only with its ceiling understood.**

The trigger is both of:

1. **Pilot shops are iPhone-heavy**, so the opportunistic outbound path is the common case rather than
   the exception; and
2. **Unsent roll call is observed happening** — events sitting on a device past the end of a dive day,
   not merely theoretically possible.

The second condition matters more than the first. Today nothing measures it, and building a second
platform on a hypothesis would be the expensive way to find out it was rare.

### What a native shell would genuinely buy

- **Silent push.** This is the single largest win and it is easy to miss. Chrome and Edge reject a Web
  Push subscription unless `userVisibleOnly: true`, which is why the whole design coalesces to at most
  one push per device per minute and why every refresh costs a captain a buzz. iOS's
  `content-available` background push has no such requirement: the app can be woken to sync with
  *nothing shown*. That removes the constraint the current design is shaped around.
- **A periodic background path.** `BGAppRefreshTask` / `BGProcessingTask` give iOS something Safari has
  no equivalent of at all — the closest web analogue, Periodic Background Sync, is Chromium-only and
  already rejected in 20260804-manifest-web-push.
- **Storage that is not IndexedDB.** The offline snapshot currently lives in IndexedDB, which iOS
  evicts on its own schedule; `a captain who lost the saved copy to storage eviction` is already a
  named e2e case. Native storage is not subject to the same eviction.

### What it would *not* buy — the part to read twice

**It does not make background sync deterministic.** iOS budgets background execution, and both
mechanisms above are explicitly best-effort:

- Silent push is low-priority by design, throttled to a couple per hour, and cut off entirely once a
  device's daily energy/data budget is spent. Apple's own guidance is that it is never guaranteed to
  be delivered.
- `BGAppRefreshTask` is scheduled by the system against usage history, battery and network, may be
  deferred or skipped, and is capped around 30 seconds of execution.

So the honest comparison is **opportunistic-with-a-notification (today) versus opportunistic-and-silent
with better odds (native)** — not "unreliable versus reliable". The guarantee a dive shop actually
wants, *this device is current at the instant signal dies*, is not purchasable from any background API
on any platform. It comes from a deliberate refresh before departure, which is what the freshness pills
and "Refresh now" exist for, and what 20260804-manifest-push-transport already concluded.

Anyone reaching for a native app expecting determinism will spend months and arrive at a better
probability distribution. That is worth having — it is not worth being surprised by.

## Alternatives considered

- **Capacitor pointing at the deployed app (`server.url`)** — the cheapest shape: one codebase, one
  deploy, native plugins for push and background tasks. The catch is the offline story. Service workers
  in `WKWebView` require App-Bound Domains (`limitsNavigationsToAppBoundDomains`, capped at ten
  domains), support is partial, and there are known IndexedDB-corruption and worker-re-registration
  bugs. The existing offline manifest leans on both. This is the leading option *only if* the offline
  layer moves to native storage rather than riding the worker.
- **Capacitor with a bundled static build** — sidesteps `WKWebView` service-worker problems by shipping
  assets locally, but requires a static export this app cannot produce: SSR, server actions, PPR and
  `instant` navigation are load-bearing (ADR-0001, 20260804-instant-navigation). Not viable without a
  rewrite.
- **A native shell with a native offline store, webview for everything else** — the cleanest background
  and durability story, and the most work: the encrypted snapshot, the roll-call queue and the sync
  protocol would each need a second implementation, which is exactly the duplication
  20260804-manifest-web-push refused for the service worker. If this is ever built, the store must have
  one owner and one format, not two.
- **React Native / a full native rewrite** — discards the shared codebase for a background capability
  Capacitor already exposes. No.
- **Do nothing and accept the gap** — the current position, and defensible while nobody has measured
  the gap biting.

## Consequences

Writing this down costs nothing and buys the thing an escape hatch is for: when someone proposes a
native app in a hurry — probably right after an incident where roll call did not make it back — this
record already contains the ceiling, so the conversation starts from what it can actually deliver.

**What adopting it would commit us to**, so it is priced honestly:

- **App Store review replaces instant deploys** for anything in the shell. A repo that currently ships
  a fix in minutes would ship shell changes in days. That is an operational change for a small team,
  not just an engineering one.
- **Apple Developer Program membership** and macOS CI runners for builds.
- **Guideline 4.2 exposure.** Apple rejects thin web wrappers; a shell whose native value is push and
  background sync generally passes, but "generally" is doing real work in that sentence.
- **A second platform to keep current** with a web app that changes daily.
- **The offline layer would need re-homing** off IndexedDB/service worker, per the alternatives above —
  which is the largest hidden cost and the one most likely to be underestimated.

**Escape hatch from the escape hatch.** Nothing in the current design blocks this. The manifest's three
refresh triggers, the encrypted snapshot format, and the sync endpoints are all platform-neutral; a
shell would replace *how* the background work is scheduled, not what it does. That is worth preserving
deliberately: keep background scheduling at the edges (the worker, the page's listeners) and out of the
store and the sync protocol, so a native shell stays a re-hosting job rather than a rewrite.
