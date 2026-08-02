# 20260802-cache-components-cross-render-state — Put same-route ephemeral state in the layout, not the page body

- **Status:** Accepted
- **Date:** 2026-08-02

## Context

ADR 20260801-cache-components-activity-state audited `cacheComponents`'s Activity-based state
*preservation* (state surviving a hide/show revisit when it shouldn't) and fixed six instances.
This record covers the opposite failure direction, found afterward: state getting **discarded**
mid-visit, with no navigation the user would recognize as one.

`RosterBulkWaiverSelection.tsx`'s "tick a few divers, then send" selection (`e2e/add-diver.spec.ts`'s
bulk-waiver-send test) lived in a Client Component rendered from the Guests page body
(`trips/[id]/guests/page.tsx`), below that page's own `<Suspense>` boundary. Two rapid
`revalidateAndRedirect` calls to the *same* `/guests` URL (each "Add to trip" is its own
server-action redirect) produced a page body that mounted, unmounted, and remounted 1-2 extra times
over roughly a second — confirmed with a `console.log` in the component's own mount/unmount effect,
timestamped and read back via `page.on("console", ...)` in the test. `networkidle` did not correlate
with it: the extra remount still happened after the network went idle, ruling out a straggling
fetch. A cold, single `page.goto` to the same route (no prior redirect) never remounted at all — so
the trigger is specifically a same-route mutate-then-redirect, not something inherent to the route
itself. Each remount reset the selection's `useState<Set<string>>` to empty, silently dropping
whichever checkbox had just been ticked — a live bug for a fast-clicking staffer, not just a test
flake. The exact Next.js internal trigger was not pinned down further (searches surfaced only
dev-mode/React-Strict-Mode double-render issues, which don't apply to `next start` production
builds); given `16.3.0-preview.10` was the newest published release at the time (no newer canary
available to try), waiting for an upstream fix was not an option.

## Decision

Render `BulkWaiverSelectionProvider` from `trips/[id]/layout.tsx`, wrapping `{children}`, instead of
from inside the Guests page body. The layout already exists specifically to stay mounted across
same-trip navigations ("switching surfaces never re-renders or re-fetches the spine — only the page
body below swaps," per its own docstring) — the identical property that protects it from the page
body's own same-route re-render. Verified with the same mount/unmount logging: exactly one mount for
the whole bulk-waiver-send test, no matter how many times the page body itself re-rendered underneath
it.

Moving state up costs a new obligation: `BulkWaiverSelectionProvider` no longer unmounts for free
when the user actually leaves Guests (for another trip tab, or a different trip entirely), so it
resets itself with a `usePathname()`-keyed effect — the identical idiom ADR
20260801-cache-components-activity-state uses for `InlineConfirm`/`ScheduleBuilder`, applied here to
open the gate (allow state to survive a same-route re-render) rather than close it (stop state from
surviving a real navigation).

**General pattern for any future instance:** if a Client Component's local state is being reset by
an apparent remount that isn't a navigation the user initiated, look at what `<Suspense>` boundary
sits between it and the route's `layout.tsx`. State that must survive everything below that boundary
re-rendering belongs above it — in the layout — with a `usePathname()` reset effect so it doesn't
leak into an actual navigation instead.

## Alternatives considered

- **A test-side stability poll** (wait for a per-mount id to stop changing before interacting) —
  built first, worked, then discarded. It only hid the bug from the test; the same remount could
  still drop a real staffer's tick in production between two fast clicks. Fixing the render location
  fixed both.
- **File an upstream Next.js issue and wait** — `16.3.0-preview.10` is the latest published version
  as of this writing (checked via `npm view next versions`); there is nothing newer to upgrade to,
  and the preview channel's release cadence is not something this project controls. Revisit if a
  future Next release's changelog mentions cacheComponents re-render/remount fixes.
- **Persist selection in `sessionStorage` instead of moving the provider** — rejected as a first
  choice; it survives a full page reload the layout-hoist doesn't, which this feature doesn't need,
  and it's an extra serialization surface for a plain in-memory `Set`. Worth revisiting only if a
  future case needs the state to survive a hard refresh too.

## Consequences

- `BulkWaiverCheckbox`/`BulkWaiverSendButton` are unchanged (they only ever consumed the context);
  only the provider's render location and its own reset effect changed.
- The layout now renders one small Client Component wrapper around `{children}` on every trip
  sub-page (Overview/Manifest/Prep too), not just Guests. Harmless: nothing on those pages reads the
  context, and a Server Component passed as `children` into a Client Component does not itself
  become client-rendered.
- The e2e fix that shipped first (a `data-mount-id` stability poll, `e2e/helpers.ts`'s
  `waitForStableAttribute`) was removed once this landed — it had no remaining caller and the
  underlying race it worked around no longer exists. The bulk-waiver-send test dropped from
  routinely needing `test.setTimeout(30_000)` (fighting the extra remounts) to a measured
  12.5-14.6s under 2-worker contention, given `test.setTimeout(20_000)` for headroom.
- Escape hatch: if a future `cacheComponents` release changes this remount behavior (fixed, or
  worse), the layout-hoist pattern here is still valid Next.js structure regardless — nothing to
  unwind either way.
