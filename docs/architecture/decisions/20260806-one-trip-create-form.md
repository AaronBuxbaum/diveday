# 20260806-one-trip-create-form — One place to create a trip: the board's add panel

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

DiveDay had two forms that created a departure, and both of them worked.

`/shop/[shopSlug]/schedule/board` grew an inline "Add a departure" panel with
[20260730-schedule-builder-and-course-paths](20260730-schedule-builder-and-course-paths.md), and
that ADR drew the boundary explicitly: the builder answers *when is it and how many seats*, and
"leaving for `/trips/new` and its full definition" was the thing it existed to avoid for the common
case. The action file said the same thing in a comment that outlived its own truth:

> Everything deeper than "when is it and how many seats" — dives, sites, requirements, crew,
> conditions, the roster — stays on the trip's own page. The builder is the board, not a second
> trip editor.

By the time this decision was taken, the quick-add panel asked for a **price**, a **course**, and a
**dive site**. Three of the six things the comment named as out of bounds were in the panel, added
one at a time, each for a good reason — an unpriced departure reaches the public schedule the
moment it lands (task 150), a course session needs its course, a board built at speed wants the
site. The boundary had not held for a month.

What was left on the other side was `/trips/new`: the same four required fields, plus a
description, a meeting-day count, a deposit, a free-cancellation window, a weekly repeat, and the
per-dive cards. A strict superset. Both forms called `createTrip`. Both had independently derived
the currency-shaped price placeholder, and the board's copy of it carried the comment "same as the
full trip form" — an admission in a source file that two things were being kept in step by hand.

The cost was the one [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md) already
priced: two URLs answering one question is what makes staff check both. Here it was worse than a
split view, because the two forms did not merely sort the same facts differently — they *accepted
different facts*, so which door a staff member walked through decided whether a departure could be
a course weekend or repeat weekly. `/trips/new` was never in `src/lib/staff-destinations.ts`: it
had no nav tab, no ⌘K entry, no shortcut. It was reachable only from five cross-links, one of
which was a secondary button on the board sitting beside the panel that did the same job.

## Decision

**There is one form that creates a departure: the schedule board's add panel. `/trips/new` is
gone, 308'd to the board.**

The boundary the builder's comment drew is restored by **unification, not by shrinking**. Shrinking
was the other option — take price, course, and site back out of the panel and send those answers to
`/trips/new` — and it fails on the fact that put them there: the board is where a shop schedules,
so a form on the board will keep growing toward what a departure is. Better to let it be the whole
form once, and design for the depth.

- **Progressive disclosure, inline, in the panel that already existed.** The quick fields stay
  visible and unchanged: what is it, date, departs, returns, seats, dives, price, course, dive
  site. One ghost "More options" control — labelled with what is behind it, not just "more" —
  reveals the description, the meeting-day count, the deposit and free-cancellation window, the
  per-dive cards (`TripDiveFields`, reused, never re-implemented), and the weekly repeat.
  Collapsed is the default because a shop puts a boat on the board far more often than it invents
  a new kind of departure (design principle 8: collapse the rare path).
- **A drawer was considered and rejected.** The board's add panel opens *under the day header it
  was pressed on*, and that placement is most of what makes it feel like building a schedule
  rather than filling in a form. A drawer would have taken the departure out of its day to ask
  about it.
- **Two controls never share a name.** Expanded, the quick "Dives" box gives way to the dive plan's
  own count (both are `plannedDives`, and two of them on one form would let the last in the DOM
  win silently), and the single "Dive site" select gives way to the per-dive `dive-N-siteId` cards.
  The server action reads the cards when any is filled and falls back to the single select
  otherwise, so a collapsed submission and an expanded one are the same payload shape.
- **One schema, one action.** `addSchema` in `schedule/board/actions.ts` is the old `trips/new`
  `formSchema` moved over, plus the board's `diveSiteId`; every added field is optional or
  defaulted, so both depths parse through it. The currency-shaped price placeholder is derived once
  on the board page and handed to the panel — the duplicated derivation is gone.
- **Landing is the board, with one exception.** A staff member who just put up Thursday should not
  be bounced somewhere else before they put up Friday, so the action returns to the board and the
  notice names the departure ("“Turtle Reef” is on the board."). The exception is the shop's very
  first departure ever, which is also the moment the first-run checklist gives way to the share
  card on the shop home (`FirstBookableCard`); that moment is worth interrupting the board for, and
  the test for it is the home page's own — the shop's total equals what was just created, demo
  shops excluded.
- **The segment stays reserved.** `/shop/[shopSlug]/trips/new` remains a route — a **Route Handler**
  answering 308 to the board, carrying `?course=` across and adding `add=full` because that URL only
  ever meant the full form. Removing a surface never removes the destination. A handler rather than
  a `page.tsx` calling `permanentRedirect()` (how `/blockers` does it) because under
  `cacheComponents` a page is partially prerendered, so a redirect thrown from its body answers
  **200** with the hop resolving inside the streamed payload: a browser follows it, a bookmark, a
  crawler, and a `curl` do not. Measured, not assumed — the first cut used a page and
  `e2e/schedule-trip.spec.ts` read 200 back.

Every former inbound link now opens the panel instead of a page:

| From | Now |
| --- | --- |
| Board header ("Full trip form") | removed — the panel is right there |
| Board empty state | `?add=1` |
| Shop home, no departures | `?add=1` |
| `FirstRunChecklist` "put a trip on the board" | `?add=1` |
| Guests demand signal ("schedule another departure") | `?add=1&date=<this departure's day>` |
| Course catalogue "schedule a session" | `?course=<id>` (panel opens with the course selected) |

The board reads `?add`, `?date`, and `?course` and opens the panel accordingly; a `?course=` is
resolved against the session's own shop, so a cross-tenant id simply resolves to nothing.

## Alternatives considered

- **Shrink the board's panel back to when-and-how-many, keep `/trips/new`.** The literal reading of
  the builder's own comment. Rejected because it un-ships three answers staff already give on the
  board for good reasons — an unpriced departure is public the moment it lands, a course session
  needs its course — and because the pressure that added them does not go away: the board is where
  scheduling happens, so a form on the board will grow toward what a departure is. Shrinking buys a
  boundary that has to be defended again next month.
- **Keep both forms and make the board's panel a link into `/trips/new` with its fields
  pre-filled.** Preserves the deep form's page but keeps two URLs, two schemas, and the hand-kept
  currency derivation. It also loses the inline add's whole point: the panel opens under the day
  header it was pressed on.
- **A board-owned drawer or modal instead of inline disclosure.** Handles the height gracefully and
  is the obvious pattern for a long form. Rejected on placement: the panel appears beneath the day
  it will schedule, and a drawer takes the departure out of its day to ask about it. A modal would
  also have made "add three departures to Thursday" a three-modal job.
- **Two buttons on the board — "Add a departure" and "Full form".** One primary action per screen
  (design principle 8); two doors to one destination is the split this ADR exists to close, just
  moved from two URLs to two buttons.
- **Redirect every creation to the shop home, as `/trips/new` did.** Coherent, and it keeps the
  first-bookable share card working unconditionally. Rejected because it bounces a shop off the
  board between Thursday and Friday. The first-departure-ever exception keeps the one landing that
  earns the interruption.

## Consequences

- **A crew member is now told why they cannot schedule.** `/trips/new` showed a "limited to owners,
  managers, and instructors" notice; the board silently omitted every add control. The sentence
  moved to the builder, so the H-14 boundary explains itself where it applies.
- **The panel is taller when expanded than any inline panel had been.** It is still bounded — one
  form, one submit — and the collapsed default is what a shop sees all week. The expanded state
  gets its own visual capture (`schedule-builder-add-full`).
- **Copy moved, never re-authored.** The whole `trips.new.*` key block was lifted into
  `schedule.builder.*` in both locales, verbatim, with three renames to avoid collisions
  (`dayCountLabel` → `daysLabel`, `courseDescription` → `courseNote`) and three genuinely new
  strings (`moreOptions`, `fewerOptions`, `moreOptionsDescription`) plus two notice variants that
  name the created departure.
- **One fewer page shell to keep in step** — a header, a Suspense fallback, an error map, and an
  `instant` declaration that existed only because the form lived at its own URL. With no `page.tsx`
  left in the segment there is no `scripts/route-coverage.json` row either: a 308 is a hop, not a
  surface to screenshot or scan.
- **The board is a heavier render than the form page it replaced** — KPI tiles, a keyset page of
  departures, per-trip crew and day counts — and `createTrip` pays one on the way in and another on
  the way out. Four specs that drive a create plus a long sequence of navigations now carry an
  explicit `test.setTimeout(30_000)` with that reasoning, the same aggregate-cost note
  `e2e/role-permissions.spec.ts` already carries. Real cost, stated rather than absorbed as flake.
- **`e2e/helpers.ts`'s `createTrip` now drives the panel**, which is what ~30 specs use to mint a
  departure of their own. That is the intended consequence: the helper exercises the one real path
  staff take, rather than a second form no nav ever pointed at.
