# 20260803-not-ready-is-a-view — Not ready is a view of Today, not a route

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

[20260720-today-work-queue](20260720-today-work-queue.md) rejected "a separate attention route" in
so many words: *it would compete with Today rather than replace it, and the workspace ADR's rule is
to replace a destination, not add a peer.* `/shop/[shopSlug]/blockers` was then built anyway, and
it is exactly that peer.

It is not a near-duplicate; it is a literal one at the data layer. Both surfaces call
`pagedUpcomingTripsWithCounts` and `listTripsReadiness` over the same shared operational horizon
(`src/lib/operational-window.ts`), and both resolve a blocked diver's one fix through the same
`BLOCKER_ACTIONS` map in `src/lib/today.ts`. Nothing distinguishes them but the sort: Today ranks
chronologically then by severity, Not ready groups by departure.

The cost of having shipped it as a route was paid in four places at once:

- A **fifth primary nav tab** whose badge counted the same divers Today's own headline sentence
  counted, two tabs apart in the same header.
- A **third readiness destination** in the shared window note's pivot list, so the sentence "the
  same window, seen another way" had to name a page that was not another way of seeing anything —
  it was the same evidence, re-sorted.
- **Two page shells** to keep in step: a header, an empty state, a loading skeleton, and a set of
  cross-links that existed only because the queue lived at its own URL.
- The **question staff actually ask** — "who can't board?" — answered in two places that could not
  be compared without navigating between them.

Meanwhile the grouping itself is genuinely useful and was never the problem. A front desk working
the week ahead wants one boat's list at a time, and the per-departure "send all waivers" batch is a
tap a chronological queue cannot offer.

## Decision

**The queue has two views over one set of evidence, and the shop home renders exactly one of them.**

- The shop home takes `?view=urgency` (default) or `?view=departures`. A segmented control on the
  queue block switches between them. It is server-rendered from the query param: no client-side
  data fork, no second fetch, and the page's block count does not grow — the by-departure view
  **replaces** the urgency queue rather than stacking below it.
- Everything the old page did for a reason survives verbatim in the by-departure view: per-departure
  groups with the batch waiver send, `alsoOn` annotations (a diver on two boats is one person to fix
  once), pagination (26 departures once rendered as an unbroken ~10,700px scroll), and the
  `truncated` disclosure. A blocker list never truncates in silence.
- `/shop/[shopSlug]/blockers` becomes a **308** to `?view=departures`, carrying `?page=` across. A
  bookmarked page 3 lands on page 3.
- The registry (`src/lib/staff-destinations.ts`) keeps a `blockers` destination, because the
  registry is the only place a destination may be declared and staff still ask for it by name — but
  it is now `navGroup: null` with a `query` of `?view=departures`. It stays in ⌘K (the `g b`
  sequence it also kept was retired with every other shortcut on 2026-08-11 —
  [command-palette-is-the-only-keyboard-route](20260811-command-palette-is-the-only-keyboard-route.md));
  it loses its nav tab. Its badge moves onto Today, which is where blocked divers are read now.
- The window note's pivots take a *list* of surfaces the current page already is. The shop home
  passes both `today` and `blockers`, so it pivots only to Check-in: offering the by-departure view
  as a pivot *and* as a switch on the same screen is the duplicate control
  [principles.md](../../design/principles.md) #8 rules out. Check-in still pivots to both.
  **Amended 2026-08-11:** the shared window note and its pivots are gone entirely
  (`src/components/OperationalWindowNote.tsx` is deleted). The sentence explained the data model to
  a reader who came to clear blockers, and every pivot it offered — Today, Check-in — is a
  permanent nav tab and a permanent phone-dock slot, so the links restated standing chrome.
  Check-in keeps the one clause that was only true of itself: how far either side of now its
  arrivals lens reaches. Nothing about the shared window or the `blockers` registry entry changes;
  only the paragraph that narrated them.

The switch sits **on the queue block**, not under the page header. The departure board above it is
not a queue view, and a toggle floating above content it does not govern reads as a page-wide
filter.

## Alternatives considered

- **Keep the route and de-duplicate the queries.** Rejected: the duplication was never the query,
  it was the destination. Two URLs answering one question is what makes staff check both.
- **Keep the tab and make it deep-link into the view.** Rejected: a fifth primary tab that only
  re-sorts the tab beside it is the duplicate control, whatever it points at.
- **Client-side toggle over one payload.** Rejected: it would have to fetch both shapes on every
  visit to Today, and the URL would stop describing what is on screen — no bookmark, no back
  button, no server-rendered deep link from ⌘K.
- **Drop the by-departure grouping entirely.** Rejected: the batch send and the per-boat read are
  real work the chronological queue cannot do.

## Consequences

The staff header has four primary tabs. The blocked-diver badge has one home. `countBlockedDivers`
and its badge are unchanged — the count was never the thing that was duplicated.

The by-departure view's empty state moves from the bespoke whole-page emoji pattern to the shared
`EmptyState`, because it is now a section under a populated page rather than a whole page
(principles.md #4). `docs/design/principles.md` cited the old blockers page as *the* example of a
terminal empty state and now cites the offline manifest viewer instead.

The by-departure query (`getBlockerQueue`) runs only when that view is selected, so the default
Today visit pays nothing for a view it does not render.

Visually, the `blockers` capture in `e2e/visual.spec.ts` keeps its name and navigates through the
redirect, so the surface stays covered — but its baseline moves, because the same departure groups
now render under Today's greeting, departure board, and view switch instead of their own header.

This is the ADR 20260720-today-work-queue's "replace a destination, not add a peer" rule applied
late, to the one destination that broke it.
