# 20260803-one-pagination-model — One pagination model for staff lists

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

Four grammars for one concept coexisted across `/shop/**`:

1. **Numbered prev/next with a position line** — the Orders index and the shop home's
   by-departure view. Both directions work, and the reader is told where they are.
2. **Forward-only keyset cursor** — the diver roster, the reports "Trips this month" table, and the
   reviews moderation queue. One button ("Show more …") plus, once you had moved at all, "← Back to
   the top of the list". **A staffer on page 3 could not go back one page**, and nothing on screen
   said how much list was left.
3. **A cursor stack** — the schedule board's "Show earlier" / "Show later" / "Back to next".
4. **"Go look at the board"** — the add-booking departure picker, which does not page at all.

Each was locally defensible; together they meant staff learned four ways to move through one idea,
and the most common of them (2) could not do the thing people most often want, which is to go back.

The Orders index carried a second, related problem: it loaded **every invoice the shop had ever
raised**. The demo alone seeds 323 across nine months, which is what turned that page into a
~17,700px scroll before it was paged at all. Paging bounded the render; it did not bound the query
or give the reader any sense of what they were looking at.

## Decision

**Every paged staff list answers with the same offset shape and renders the same pager.**

- `src/db/paging.ts` — `offsetPage({ page, pageSize, countRows, fetchRows })` returns
  `{ rows, page, pageCount, pageSize, total }`. The row query and the count run together. A request
  past the end costs one extra query and lands on the **last real page**: a bookmarked `?page=9` on
  a list that has since shrunk shows rows under an honest "Page 4 of 4", never an empty table under
  a heading that cannot be true. A page below 1, fractional, or `NaN` reads as page 1 rather than
  reaching a driver as a negative or `NaN` offset.
- `src/components/Pager.tsx` — a Server Component rendering prev / position / next. Its words come
  from **one** shared key set, `shared.pager.*`. It renders nothing when `pageCount <= 1`, so no
  caller needs its own guard and no shop with one screenful is told it is on "page 1 of 1".
- The **counted noun** stays with the list that owns it (`orders.index.pagination.total`,
  `blockers.pagination.total`, …), passed in as an already-translated ICU-pluralised string. A bare
  noun interpolated into a shared sentence does not survive translation.
- `listDiverSummaries`, `listShopReviewsForStaff`, and `pagedMonthlyReportTrips` convert from
  forward-only cursors to offset. All three already ordered on a total key with an id tiebreak and
  already ran a count, so the conversion is small and exact — `?after=<cursor>` becomes `?page=N`.
- `listShopOrders` and the by-departure view keep their behaviour and adopt the component.
- The four secondary lists left forward-only in the first pass — `pagedCourses` (the courses
  roster), `listShopPromoCodes` and `listOutstandingLastMinutePromos` (the Promos page's two
  lists), and `listWaiverIntegrityAudit` (the waiver signature log) — convert on the same terms.
  The two on `/promos` page independently, so each page link carries the other list's `?page=`
  rather than resetting it, and the signature log's page links carry the `?record=` pin.
- **The schedule board keeps its cursor stack.** It pages a *stream* of upcoming departures with no
  page count to state, its first page deliberately carries the open roll-calls that belong at the
  front of the board (`schedule/board/page.tsx`), and "Show earlier"/"Show later" name a direction
  in time rather than a position in a list. A numbered pager would have to invent a page count for
  a set that is unbounded forward.
- **The Orders index opens on a 90-day window** (`ORDER_DEFAULT_RANGE_DAYS`), **stated on screen**,
  with `?range=all` as the explicit way out and a way back. An explicit `?from=`/`?to=` replaces the
  window rather than nesting inside it.

## Alternatives considered

- **Keyset everywhere, with a prev-cursor stack in the URL.** Rejected for these three lists: it
  buys real "back one page" but still cannot say "page 3 of 7", and it puts a growing opaque blob in
  the URL for lists a shop routinely deep-links and shares. Kept for the board, where the stream
  shape makes it the right answer.
- **Leave the forward-only cursors and only unify the styling.** Rejected: the missing capability
  was the point, not the paint.
- **A shared `total` sentence in the pager's own key set** ("Page {page} of {pageCount} · {total}
  {noun}"). Rejected — interpolating a noun defeats agreement and pluralisation in every language
  that has either.
- **Silently capping the Orders index** at N recent invoices. Rejected outright: a list that hides
  rows without saying so is worse than a slow one.

## Consequences

`src/db/cursor.ts` stays, but it is now the exception a surface has to earn rather than the default.
**The schedule board is the only surface that earns it**, and grammars 2, 3 (off the board), and 4
are gone: every other paged staff list answers with `OffsetPage` and renders `Pager`. Any *new*
paged staff list uses them from the start.

The follow-up pass that finished this also closed two gaps the first pass did not name:

- The **published dive-site catalog** (`/dive-sites/catalog`) had no pagination at all — a catalog
  DiveDay intends to keep adding to, rendered whole as cards. It pages now, and the library's
  "a newer version is published" badge asks `currentGlobalDiveSiteVersions` for the template ids on
  the page it is rendering instead of indexing the whole catalog, so paging the catalog cannot
  silently drop a badge.
- `listDiveSitesPage` hand-rolled its own offset arithmetic. It clamped a page *below* 1 but had no
  answer for one past the end, so a bookmarked `?page=9` on a library that had shrunk rendered an
  empty table under "Page 9 of 4" — the exact failure `offsetPage` exists to prevent. It goes
  through `offsetPage` now.

Two counting rules came out of the conversions and hold for any list that adopts this model:
**count what the list actually lists.** A count taken off `listShopPromoCodes`'s redemption
`leftJoin` would report a code redeemed forty times as forty codes; a count of `trips` that ignored
the booking picker's `hasSpace` filter would page sold-out departures into a page that renders
nothing. Both counts therefore share the row query's exact scope — its joins, its `where`, its
`having`, and its `now`.

Several surfaces change shape visually (a pager band where a "Show more" button was, one where
there was nothing) and the Orders index gains a range note above its table; those baselines move.

Lists that stay unpaged, deliberately, because they are bounded by something other than time:
a shop's staff (`listShopStaff`), its certification paths, its course catalog in a `<select>`,
and a trip's roster and waitlist (bounded by capacity). The **diver record** is the one place a
query is still unbounded on purpose — it loads a diver's whole booking, order, payment, and
imported-visit history to compute the page's stats — but its render is bounded by a preview plus a
disclosure rather than a pager, because it is one person's record, not a list to walk. If that
query ever bites, the fix is a paged history section behind the same `OffsetPage` shape.

The offset scan is O(offset) on a large table. For the roster (name-ordered, page sizes of 20) and
the moderation queue this is not close to mattering; if a shop's orders index ever gets deep enough
that it does, the fix is a tie-broken keyset *behind* the same `OffsetPage` shape, not a fifth
grammar on screen.
