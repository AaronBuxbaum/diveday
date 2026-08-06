# 20260806-staffing-is-the-shift-roster — Staffing is the shift roster; crew gaps belong to Today

- **Status:** Accepted
- **Date:** 2026-08-06

## Context

`/shop/[shopSlug]/staffing` did two jobs. One is its own: **shifts** — who is working, when, over a
date window, created and removed by `createShiftAction` / `deleteShiftAction`. That is the only
place in the product a shift exists.

The other was a per-departure **coverage table**: every scheduled trip in the window, badged
"Covered" or "N gaps", with a bulleted list of what was missing. It was a second rendering of a
fact Today already owns, and the code said so out loud in both directions:

- `courseCrewGap` (`src/lib/course-ratios.ts`) was called in **two** readers —
  `src/db/staffing.ts` and `src/db/today.ts` — and the comment at each call site referred the
  reader to the other one, on the theory that naming the twin keeps it honest.
- The twins had **different vocabularies** for the one verdict. Today files it as
  `instructor_missing`; staffing split the same `courseCrewGap` result into `over_ratio` and
  `course_needs_instructor`, plus two codes of its own (`no_crew`, `no_shift_coverage`). Four
  staffing strings and one Today string for one computation.
- Keeping them in step needed a **test asserting the two surfaces agree** (DOM-M3, in
  `src/db/today.test.ts`) — the standing cost of a duplicate that documentation alone could not
  hold.

The decisive asymmetry is what each surface could *do* about a gap. Today's `DepartureBoard`
assigns crew directly: staff are dragged onto a boat and `updateTripCrewAction` writes it. The
staffing coverage rows linked to `/trips/[id]#crew` and stopped there. **The surface named for
crewing could not crew.**

This is the shape [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md) already ruled on
(a surface that re-renders another surface's evidence is a view or a summary, never a parallel
table) and the rule [20260804-day-closeout](20260804-day-closeout.md) states as *no second
detector* (close-out composes Today's own readers rather than detecting anything itself).

## Decision

**Staffing is the shift roster. The roster is the page; crewing appears on it as one summary line
that hands over to Today.**

- The date-window roster — each person, their capabilities, their shifts, the trips they crew, and
  the add/remove shift controls — is the whole body of the page.
- The coverage table is replaced by a single card: *"N departures in this window still need crew"*
  plus one link to the shop home, where the departure board can actually assign someone. Zero
  departures and zero gaps each get their own quiet sentence; the link appears only when there is
  something to fix.
- The count is composed from **the reader Today's own detection runs on** —
  `courseCrewCountsByTrip` (`src/db/today.ts`, now exported for exactly this) fed into
  `courseCrewGap`. `src/db/staffing.ts` no longer counts in-water crew itself. The one addition is
  the zero-crew case, read straight off the assignment rows: a departure with nobody rostered is a
  fact, not a rule, and a fun-dive charter has no course ratio to be outside of.
- `StaffingGapCode` and its four message keys are **deleted**, in both locales. The words for a
  crew gap live where the fix does. `no_shift_coverage` goes with them: what it described is
  already legible on the roster itself, in each person's shifts and "Crewing" list.
- The **route stays.** Shifts are their own question, their own mutation, and their own moment in
  the week — which is precisely what the coverage table was not.

## Alternatives considered

**Keep the coverage table and delete Staffing's detection, rendering Today's verdict instead.**
This removes the twin computation but not the twin surface: two per-departure tables of the same
rows, one of which still cannot assign anyone. 20260803-not-ready-is-a-view rules this out — a
second rendering of the same evidence earns its place as a *view of* that evidence, not as a peer
table on another route.

**Delete the route and fold shifts into Today or the schedule board.** Rejected: shifts are the
one thing here that exists nowhere else, they are a *weekly* act (a manager laying out who works
when) rather than a day-of one, and Today is already the busiest surface in the product. The
consolidation this ADR performs is the coverage table's, not the roster's.

**Make the roster crew boats too — a drag-and-drop assignment surface over the window.** That is a
second implementation of `updateTripCrewAction`'s interaction, and the argument for it ("the page
is called Staffing") is naming, not need. One place assigns crew.

**Count only what `courseCrewGap` reports, leaving zero-crew departures out.** Cleanest possible
"no second rule", and wrong on the page: a fun-dive charter with nobody on it is the most obvious
thing a manager laying out a week needs to see, and no course ratio describes it. Zero-crew is
read as a fact off the assignment rows, not re-derived as a rule.

## Consequences

- One detector, one vocabulary. A new `CourseCrewGap` code now lands on Today alone; there is no
  second surface to keep in step and no way for the two to name a shortfall differently.
- DOM-M3's agreement test survives in a stronger form: because the roster's count is composed from
  Today's reader, it asserts a delta (Today flags one more session ⇒ the count rises by exactly
  one) rather than policing two independent computations.
- The staffing page's visual baseline shrinks by the height of the coverage table. That is the
  change, not a regression.
- The roster's summary counts the whole selected window while Today's board shows today, so a gap
  five days out is counted here and crewed from the trip's own crew editor. The count is a nudge
  to look, not a work queue — the work queue is Today.
- One database round trip was traded for another: staffing dropped its `person_roles` join and
  added a call to Today's crew-count reader.
