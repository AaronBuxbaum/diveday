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
  tomorrow's first `TOMORROW_GLANCE_LIMIT` rows.
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
