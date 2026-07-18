# Brainstorm 3 — Staff operations & efficiency

**Lens:** give a busy front desk its day back. The north star's first outcome is *less staff
coordination work* — fewer calls, messages, duplicate entries, and manual checks
([next-steps](../next-steps.md)). This document explores the shop-side surfaces (`/shop/**`) where we
replace phone tag, sticky notes, and cross-referencing three tabs with one calm system.

Personas served most here: **shop owner/manager** (calendar + money), **front desk** (bookings,
check-in, chasing missing waivers/certs), **instructor/DM** (their schedule, students, boat).

---

## The efficiency thesis

A dive shop's real software is *coordination*: who's coming, who's ready, who to call, what boat, what
gear, who's teaching. Today that lives in a manager's head and a spreadsheet. Every idea below turns a
manual cross-check or a phone call into a glance or a single action.

---

## A. The staff cockpit (home surface)

- **"Today at a glance."** The `/shop` home answers the three questions a manager opens the app for:
  *what's running today, who isn't ready, what needs a human right now.* Same shape every morning so
  it becomes muscle memory. *(M, cross-cutting, big bet.)*
- **Blocker queue.** A single list of everything blocking a departure — missing waivers, unverified
  certs, unpaid deposits later — each with a one-tap action (send waiver link, verify card, call
  diver). This is the front desk's whole job, made a list. *(M, cross-cutting, big bet.)*
- **Readiness roll-up per trip.** For each upcoming trip: `X of Y divers ready`, expandable to the
  blockers. Feeds off the same readiness model as safety surfaces (no divergent logic). *(M,
  cross-cutting.)*
- **"Needs me" vs "handled."** Clear separation between what the system resolved automatically and
  what a human must touch. Reduce the surface a person scans. *(S–M, cross-cutting, quick win.)*

## B. Global command & search

Once there are enough entities to justify it (delight backlog, next-steps).

- **Command palette (⌘K).** Jump to any trip, diver, or booking; run actions ("new trip", "check in
  diver", "assign crew") without leaving the keyboard. *(M, cross-cutting, big bet.)*
- **Global search.** One box across divers, trips, bookings, gear — typo-tolerant, recent-first.
  Finding a diver by half-remembered name is a daily task. *(M, cross-cutting.)*
- **Keyboard-first with visible shortcuts.** Power users run the day from the keyboard; shortcuts are
  discoverable, not hidden. *(M, cross-cutting.)*

## C. Kill the duplicate entry

Duplicate entry is the #1 coordination tax. Enter once, reuse everywhere.

- **Person is the spine.** A diver entered once carries their certs, waivers, gear sizes, emergency
  contact, and history to every future booking. Roles, not person-types (glossary). *(M,
  cross-cutting, big bet.)*
- **"Same as last time."** Returning diver → prefill gear sizes and preferences from history; staff
  confirm rather than re-enter. *(S, gear/bookings, quick win.)*
- **Bulk actions.** Multi-select on a roster to send waiver links, assign gear, or move divers
  between trips in one action. *(M, bookings/gear.)*
- **Fast bulk gear assignment** (next-steps Phase D) — conflict-aware, with clear alternatives when a
  size is out. *(M, gear.)*

## D. Scheduling & calendar operations

- **Calendar view of trips/courses** — day/week, capacity and staffing visible per slot, drag to
  reschedule. *(M, bookings, big bet.)*
- **Recurring trips.** "Every Saturday two-tank" scheduled as a series, edited as one or per
  instance. Shops run the same charters weekly. *(M, bookings.)*
- **Crew assignment with conflict detection** — an instructor can't be on two boats at once; ratios
  respected (glossary — agency-mandated instructor:student ratios). *(M, bookings/certs.)*
- **Capacity + waitlist.** When a trip sells out, a waitlist that auto-notifies on a cancellation.
  Turns cancellations into recovered revenue and fewer "is there room?" calls. *(M, bookings.)*
- **Weather/condition holds.** A trip can be flagged "condition hold" and later confirmed/cancelled,
  notifying everyone at once instead of a phone tree. *(M, bookings.)*

## E. Check-in flow

*Check-in* is where waiver, cert, and gear are confirmed before boarding (glossary). The app's job is
making "ready to board" a single glance.

- **One-screen check-in.** Per diver: waiver ✓, cert ✓ (verified), gear assigned, medical clear —
  all on one card, one tap to mark boarded. *(M, cross-cutting, big bet.)*
- **Line-busting.** A check-in mode optimized for a queue at the counter on a phone/tablet — big
  targets, fast next-diver, no dead ends. *(M, cross-cutting.)*
- **Exception handling without losing audit history** (next-steps Phase B) — staff can override with
  a reason, recorded, never silently. *(M, cross-cutting.)*

## F. Saved views & role-shaped workspaces

- **Saved filters/views** for common roles (delight backlog): "my boats today" for a DM, "unpaid
  deposits" for a manager, "waivers outstanding" for front desk. *(S–M, cross-cutting, quick win.)*
- **Per-role default landing.** A DM lands on their schedule, a manager on the money/calendar. Don't
  make everyone navigate to their job. *(S, cross-cutting, quick win.)*
- **Activity history in operational language** (delight backlog) — "Front desk checked in Dana at
  8:41" not "record 4823 updated." Readable by the next human. *(S–M, cross-cutting, quick win.)*

## G. Communication without leaving the app

Deferred to M7 notifications, but the *shape* matters for efficiency.

- **One-tap nudges.** Send a waiver/cert reminder to one diver or a whole trip's outstanding list
  from the blocker queue. Replaces manual texting. *(M, cross-cutting, big bet — pairs with M7.)*
- **Templated messages** in briefing voice — confirmations, reminders, condition holds — editable,
  logged against the booking. *(M, cross-cutting.)*
- **Internal notes** on a diver or booking ("prefers left-hand reg", "always late") visible to
  staff, invisible to the diver. *(S, cross-cutting, quick win.)*

---

## Bigger operational bets

- **Multi-boat / multi-trip day orchestration** — a shop running three boats needs to see all of
  them, move divers and crew between them, and not double-book gear. *(L, cross-cutting, big bet —
  M7+.)*
- **Shift/staffing view** — who's working, who's certified to teach what, coverage gaps. *(L,
  cross-cutting.)*
- **End-of-day close-out** — reconcile who dove, gear returned, incidents logged, tomorrow
  previewed. A satisfying "everyone's home" ritual (see delight doc). *(M, cross-cutting.)*

## What NOT to do

- Don't rebuild a general POS/retail system — gear *rental*, not merchandise (vision non-goal).
- Don't add a feature that reintroduces duplicate entry to save build effort — the spine must stay
  single-source.
- Don't gate efficiency features on notifications shipping — design the *action*, wire the channel
  when M7 lands.
- Don't let saved views multiply into clutter — role defaults first, custom views second.

## Highest efficiency-per-effort (if picking today)

1. The blocker queue with one-tap actions — **M, the front desk's whole day in one list.**
2. One-screen check-in with "ready to board" at a glance — **M, the daily-throughput surface.**
3. Command palette + global search — **M, the power-user multiplier.**
4. Saved role views + per-role landing — **S, quick win, immediate felt relief.**
5. Waitlist auto-notify on cancellation — **M, recovers revenue and kills "any room?" calls.**
