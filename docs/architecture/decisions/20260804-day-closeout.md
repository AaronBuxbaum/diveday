# 20260804-day-closeout — The end-of-day close-out is its own route and an append-only trail, never a gate

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

The Today queue owns the morning — "can the boats sail, who needs me before they do?" — and nothing
owned 5 p.m. The brainstorm's "end-of-day close-out" (docs/product/features/brainstorm.md, Staff
Operations) asks for the mirror: one surface where staff confirm the day is actually over — every
departure's head count reconciled, today's leftovers explicitly carried or dismissed, tomorrow's
blockers seen before walking out. A shop should end its day with the same confidence DiveDay gives
it at the start.

Three constraints shaped the design:

- **No second detector.** `listRollCallGaps` and `getTodayWork` (src/db/today.ts) already decide
  what an open head count and an open job are. A close-out that re-derived either could disagree
  with the queue that chases them — about whether a person is accounted for.
- **Never a gate.** Manifests and roll call are safety surfaces; the close-out is a ritual on top
  of them. The human is the authority on their own day.
- **The precedent of [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md)**, which
  folded the blockers route into Today because it was the same evidence re-sorted. Any new surface
  near Today has to answer that ADR before existing.

## Decision

**A route of its own — `/shop/[shopSlug]/close-out` — not a third `?view=` on the shop home.**
The not-ready precedent forbids a *peer that re-sorts the same list*; the close-out is neither a
peer nor a re-sort. It asks a backwards-looking question the shop home never asks (how did today's
departures *end*, queried over `startsAt` within `shopDayBounds`, boats that left every
forward-looking reader hours ago), it carries a mutation of its own (the recorded close), and it
owns a different moment of the day — Today is what you open, close-out is what you leave through.
A view switch labelled "urgency / departures / closing time" would hide a form behind a sort
control. It replaces nothing and duplicates nothing: no data it shows is re-ranked Today evidence
except the leftovers list, which is *deliberately* the queue's own rows (see below).

- **Assembly, not detection** — `src/lib/closeout.ts` composes purely from `listRollCallGaps`
  output and the `TodayAction` list: per-departure end states (`all_home` / `unreconciled` /
  `count_open` / `still_out` / `not_departed`), today's leftovers (queue rows dated today or
  undated, *minus* the roll-call kinds — a head count is chased, never carried or dismissed), and
  a count of tomorrow's queue by kind (`TomorrowGlance`; see the amendment below).
- **Closing is an append-only recorded act** — a `day_closeouts` row: who, when, which shop-local
  day (`shop_day`, text `YYYY-MM-DD`), and an `outstanding` jsonb snapshot recomputed server-side
  at close time (never trusted from the form): the unsettled departures plus every leftover with
  its carry/dismiss decision. Snapshot text is trail text, like `activity_events.message`.
  Re-opening is not a state transition: nothing locks, and closing again appends another row.
- **Loud, never blocking** — a departure with an after-dive gap (glossary "unaccounted for" kinds
  1–4) or a boat still out renders danger/warning and adds a required acknowledgement checkbox to
  the close form: closing over it is deliberate, never accidental — and never impossible. The
  dock-count kinds (5–6) are stated but do not demand the checkbox: a nightly forced "I know" from
  every shop that never taps roll call teaches crews to tick boxes unread, which is exactly how
  the loud states die (DOM-H3's wallpaper lesson).
- **Carry/dismiss is a memory, not a filter.** Tomorrow's queue keeps deriving from the source of
  truth; a dismissed row reappears if it is still true. The record is what changes — the shop can
  see what it decided and who decided it. This is what "nothing conditions on the close" means in
  practice.
- **Every staff role may close the day.** Whoever is last out owns the ritual; accountability is
  the name on the trail row, not a role gate. The leftovers list mirrors the viewer's own Today
  queue (owner/manager ops alerts included only for them, same `canViewShopReports` gate).
- **Out of scope: gear-return reconciliation.** The brainstorm entry lists it, but there is no
  gear register in the product to reconcile against — scoping it in would have meant inventing
  one as a side effect. It joins the ritual when a gear register exists.

## Amendment (2026-08-06) — "Tomorrow, at a glance" is a handoff, not a second queue

As shipped, the tomorrow section re-rendered tomorrow's `TodayAction` rows — the queue's chip,
subject, detail, and a link — **without any of Today's inline controls**. The same row that sends a
waiver, invites from the waitlist, or copies a payment link on the shop home was an inert list item
here, which quietly taught staff that tomorrow's work cannot be touched until morning. That is
[20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md)'s finding at section scale: a
surface re-rendering another's evidence is a view of it, not an owner of it.

The section now states **how much** is waiting (total, plus a count per kind using the queue's own
`KindChip`) and offers one link to Today, which is the surface that can act on those rows. Nothing
else about the route changes: the departures list, the leftovers' carry/dismiss choice, the
acknowledgement checkbox, and the append-only close are untouched, and the close-out keeps its own
route for the reasons above. `TOMORROW_GLANCE_LIMIT` is gone with the rows it bounded — a count
cannot scroll, so there is nothing left to cap.

Today gained the other half of the handoff at the same time: once every one of today's departures
is back at the dock (`lastBoatIsIn`, src/lib/today.ts, read off the departures `getTodayWork`
already returns — no new detector, no wall-clock band), the shop home shows one calm card pointing
at the close-out. The registry called this route "Today's evening mirror" while linking to it from
nowhere but the nav's More drawer. It stays a suggestion: nothing nags, nothing gates, and a day
with no departures shows no card at all.

**2026-08-12 — the card keys on the first boat home, not the last.** Waiting for *every* departure
meant the only non-palette door to this surface was missing on the evenings a shop most wants it: a
day with a night dive still on the board, or with one boat running late, showed no card at all,
which is how a route described as "part of every single working day" ended up reachable on some days
only (FU-20260811-close-out-has-one-conditional-door). The gate is now `anyBoatIsIn` — a departure
that is home is work the close-out can take, whatever else is still at sea — and `lastBoatIsIn`
stays to choose the card's words, because "The last boat is in" is a sentence that must never be
rendered over a boat still out. Two states, two sets of copy, rather than one vague sentence true of
both. Nothing else moves: same inputs, same no-clock-band reasoning, still a suggestion, and still
no card on a day where nothing has come home yet. The alternatives this deliberately did *not* take
were promoting the close-out into the nav (the staff header is full at five primary tabs, so it
would have cost another destination its place) and retiring the surface, which is now harder to
justify than when it shipped: the post-trip recap note is written here, so the page owns work rather
than only mirroring it.

## Alternatives considered

- **A third `?view=` on the shop home** — the not-ready precedent cuts the other way: that ADR
  removed a duplicate of Today's own list; this surface asks a different question, holds a form,
  and would make the "view" switch a mode switch.
- **Reuse `activity_events` for the record** — the trail is trip-scoped prose; the close is
  shop-day-scoped and structured (decisions per item), and "was today closed?" should be one
  indexed read, not a message parse.
- **A `closed` flag on a day table (lock + reopen)** — a lock invites downstream conditions and
  needs an unlock ceremony; append-only rows make re-closing the same act as closing.
- **Dismiss suppresses the item from tomorrow's queue** — rejected as a gate in disguise: the
  queue would stop being derived from the source of truth, and a wrongly dismissed waiver would
  vanish instead of resurfacing.
- **Blocking close while a head count is open** — rejected outright; the manifest is where a
  count closes, and a shop locked out of its own ritual at 9 p.m. just stops using the ritual.

## Consequences

One new table (`day_closeouts`), append-only, roughly one row per shop per day — small enough to
carry no retention arm; if HD-11 ever sets one, it is one entry in `src/lib/retention.ts` plus a
delete arm. The surface adds a `closeOut` destination to `src/lib/staff-destinations.ts` (leading
the "Run the shop" group, palette included, ungated). The close recomputes day state on the
server, so a stale tab records the truth at close time, not what it was looking at.

Escape hatch: if real shops treat the acknowledgement checkbox as noise (ticked daily without
reading), the mustAcknowledge set narrows to kinds 1–2; if they want the record to *drive*
tomorrow's queue, that is a new ADR superseding the "memory, not filter" clause — the snapshot
already stores everything such a feature would need, so no migration is implied.
