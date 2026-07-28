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

- [x] **"Today at a glance."** (Shipped) `/shop` Today workspace shows departure board and ranked jobs.
- [x] **Blocker queue.** (Shipped) Today work queue organizes missing waivers, unverified cards, unstaffed sessions, and freed seats.
- [x] **Readiness roll-up per trip.** (Shipped) Shows guests/readiness status per departure.
- [x] **"Needs me" vs "handled."** (Shipped) Automated background checks separate auto-handled data from critical manual staff actions.

## B. Global command & search

- [x] **Command palette (⌘K).** (Shipped) Palette filters over divers and trips, running navigation.
- [x] **Global search.** (Shipped) Command palette plus a live filters page.
- [x] **Keyboard-first with visible shortcuts.** (Shipped) `g`-sequences for navigation and `?` shortcuts cheat-sheet.

## C. Kill the duplicate entry

Duplicate entry is the #1 coordination tax. Enter once, reuse everywhere.

- [x] **Person is the spine.** (Shipped) Central diver records hold certs, waivers, rental fit sizes, emergency contacts, and history.
- [x] **"Same as last time."** (Shipped) Returning diver picker matches emails and populates saved sizes, cards, and contact details.
- [x] **Bulk actions.** (Shipped) Staff can issue all outstanding roster waivers in a single click.
- [Superseded] **Fast bulk gear assignment.** *(Gear inventory assignment was removed in M5 in favor of size tracking. Per-trip prep list aggregates rental items and sizes automatically).*

## D. Scheduling & calendar operations

- [x] **Calendar view of trips/courses.** (Shipped) Schedule page and website embeddable calendars.
- [x] **Recurring trips.** (Shipped) Trip series scheduling with series-wide editing, cancellation, and horizon extensions.
- **Crew assignment with conflict detection** — an instructor can't be on two boats at once; ratios respected. *(M, bookings/certs.)*
- [x] **Capacity + waitlist.** (Shipped) Freed-seat invites trigger notifications from waitlist.
- **Weather/condition holds.** A trip can be flagged "condition hold" and later confirmed/cancelled. *(M, bookings.)*

## E. Check-in flow

*Check-in* is where waiver, cert, and gear sizes are confirmed before boarding (glossary). The app's job is
making "ready to board" a single glance.

- [x] **One-screen check-in.** (Shipped) Manifest view consolidates waivers, payment readiness, certifications, and boarding checkpoints.
- **Line-busting.** A check-in mode optimized for a queue at the counter on a phone/tablet. *(M, cross-cutting.)*
- [x] **Exception handling without losing audit history.** (Shipped) Append-only boarding history and transaction checks.

## F. Saved views & role-shaped workspaces

- [x] **Saved filters/views.** (Shipped) Diver roster presets (All / Missing contact / Has insurance) and custom browser-saved views.
- [x] **Per-role default landing.** (Shipped) Role-aware landings (captains/DMs land on crew-assigned boats; instructors land on course sessions).
- **Activity history in operational language** — "Front desk checked in Dana at 8:41" not "record 4823 updated." *(S–M, cross-cutting.)*

## G. Communication without leaving the app

- [x] **One-tap nudges.** (Shipped) One-tap waiver send from Today and Blockers lists.
- [x] **Templated messages.** (Shipped) Automated emails/SMS for confirmations, night-before briefs, and waitlist recovery.
- **Internal notes** on a diver or booking visible to staff, invisible to the diver. *(S, cross-cutting, quick win.)*

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
