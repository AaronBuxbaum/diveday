# 20260802-dsd-instructor-manual-ratio — Real PADI DSD ratio, split from the Open Water figure

- **Status:** Accepted, **scope and enforcement points amended 2026-08-02** (see
  [Amendment](#amendment-2026-08-02--agency-agnostic-scope-and-where-the-cap-is-enforced))
- **Date:** 2026-08-02

## Context

[20260724-course-admission-standards](20260724-course-admission-standards.md) enforced a single
entry-level in-water ratio (8 students/instructor, +2/certified assistant, ceiling 12) against both
Open Water Diver training dives and Discover Scuba Diving (DSD) sessions, because at the time DSD's
own ratio was sourced only from a PADI marketing blog and a third-party dive-shop page — not PADI's
Instructor Manual. That ADR's own confidence note, raised on `dive-domain-expert` review, flagged
this as the single line item worth a direct PADI/manual check before leaning on it operationally:
DSD participants have had zero prior water time, unlike an Open Water student who has already
completed confined dives, and some operators run DSD tighter than the certification-course ratio as
a matter of prudence. HD-6 (docs/product/human-decisions.md, H-08 reopened) asked for that check.
The product owner has now supplied the real Instructor Manual figures (2026-08-02): **4 students per
instructor in confined/pool water, 2 students per instructor for the open-water dive** — both
materially tighter than the 8→12:1 figure previously applied to DSD.

`courses.isIntroCourse` already exists and identifies DSD specifically (it is set on DiveDay's own
"Discover Scuba Diving" course template and read for display on the booking page), but the ratio
gate never consulted it — every ungated PADI course got the same capacity formula regardless of
type. That gap, not just the sourcing, is what let the wrong figure govern DSD bookings.

## Decision

**Enforce the real DSD ratio, scoped by `isIntroCourse`, and stop applying the Open Water figure to
DSD sessions.** `src/lib/course-ratios.ts` gains `DSD_RATIO` (confined-water 4:1, open-water 2:1) and
`entryLevelCourseCapacity` takes a third `isIntroCourse` argument: when true, capacity is
`instructorCount * DSD_RATIO.openWaterStudentsPerInstructor`, with no assistant-bonus credit (none
is published for DSD); when false (Open Water training and any other ungated PADI course),
behavior is unchanged from the prior ADR. `courseCrewGap` and the booking-time gate in
`src/db/bookings.ts` read `course.isIntroCourse` off the same course row they already have — no new
query — and so do `courseCrewGap`'s advisory consumers (the Today queue, the staffing coverage
list, and the trip Overview page). See the [Amendment](#amendment-2026-08-02--agency-agnostic-scope-and-where-the-cap-is-enforced)
for the two places the cap is deliberately *not* enforced.

**Only the open-water figure is enforced, matching the prior ADR's precedent for the Open Water
ratio itself:** DiveDay's trip model has no confined-water session type — a trip is one dated
open-water outing, and DSD's confined-water skills segment (mask clearing, regulator recovery)
happens within that same trip, not as a separately bookable session. The confined-water 4:1 figure
is recorded in `DSD_RATIO` for completeness and reference, but the tighter open-water 2:1 figure is
what a booking is actually checked against, since that is the ratio that governs the dive DiveDay
models.

## Alternatives considered

- **Model a separate confined-water session type so both DSD ratios are enforced.** Real fidelity,
  but a materially larger change (new trip/session concept) for a number that's looser than the one
  already enforced — the tighter figure is the one doing the safety work. Left for a future
  refinement if DiveDay ever models confined-water sessions on their own.
- **Add an assistant-bonus credit to the DSD ratio, mirroring the Open Water figure.** No such bonus
  was supplied for DSD; inventing one would repeat the exact mistake this ADR fixes — asserting a
  compliance number DiveDay hasn't actually sourced.

## Consequences

- A DSD or other intro session's real booking ceiling is now 2 participants per instructor (was
  effectively up to 12 with assistants credited) — a shop currently running larger DSD groups will see
  `course_ratio_full` refuse new bookings past that count, and the trip Overview's non-blocking
  `over_ratio` warning will fire for existing over-capacity sessions the next time crew or booked
  count is re-read.
- Open Water Diver training-dive capacity is unaffected — same 8→12:1 figure, same enforcement.
- The intro cap is scoped by `courses.isIntroCourse` alone, not by agency — see the Amendment.
- HD-6 is resolved for the DSD ratio. The companion ask in the same row — the Rescue Diver
  scenario-supervision figure — stays open; Rescue and other continuing-ed courses remain unratioed
  pending that number, unchanged from the prior ADR.
- Escape hatch: if DiveDay later models confined-water sessions explicitly, revisit whether the 4:1
  confined figure should also be enforced rather than left as reference data.
- Safety-critical surface (course/cert gating) — carries a `dive-domain-expert` review before merge
  per AGENTS.md.

## Amendment 2026-08-02 — agency-agnostic scope, and where the cap is enforced

A `dive-domain-expert` review of the change above found that the new figure was reached only
through the pre-existing `agency === "padi"` test, which the entry-level 8/+2/12 rule needs but the
DSD rule does not. Three corrections ship with it; the numbers are unchanged.

- **The intro cap applies to every agency.** 2:1 is a PADI figure, but its rationale — participants
  who have had zero prior water time — is agency-independent, and this ADR's own Context says so.
  Scoped to PADI, an SSI or NAUI Try Scuba (`isIntroCourse: true`, `agency: "ssi"`) was capped by
  nothing but the boat's capacity. The PADI check now lives only on the entry-level branch, where
  the cited PADI number is. `courses.agency` is also normalized (trimmed, lowercased) at that one
  comparison site, so a shop that typed `"PADI"` no longer loses the cap (review finding DATA-L2).
  An intro session likewise stays gated even when a stray `minimum_certification_level` is set —
  nobody on a DSD holds a card.
- **The cap is enforced on every seat-granting write**, including `restoreBooking` — the undo of a
  roster removal — which previously re-checked only `trips.capacity`.
- **The cap is deliberately *not* enforced against a crew change.** `setTripCrew` and
  `changeTripCrew` record a change that leaves a session over ratio rather than refusing it: at 2:1
  an instructor calling in sick is the ordinary case, and a refused unassignment means the printed
  manifest lists crew who are not aboard. The resulting gap surfaces as the non-blocking
  `over_ratio` advisory and new bookings stay refused. See
  [20260724-course-admission-standards](20260724-course-admission-standards.md#amendment-2026-08-02--intro-session-ratio-scope-undo-and-crew-changes).
