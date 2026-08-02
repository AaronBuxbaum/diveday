# 20260724-course-admission-standards — PADI-sourced entry-level ratio gate

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

H-08 (docs/product/human-decisions.md) left the exact per-agency ratios, depth ceilings,
minimum-age/Junior rules, and medical-exception process as "must verify — needs the operator's
agency-specific input," alongside the already-accepted conservative baseline (DSD/OW ungated,
AOW+ requiring a verified Open Water card, instructor-led sessions blocked until staffed). The
product owner decided (2026-07-24) that DiveDay should use PADI's and SSI's own published
standards directly — described as consistent enough across agencies to trust, including from
ordinary web sources — rather than waiting on a shop-by-shop agency briefing.

This ADR resolves the **in-water instructor:student ratio** piece of H-08 with real enforcement,
and records the depth-ceiling and minimum-age numbers as documented reference data. It
deliberately does not build numeric depth-ceiling or minimum-age *enforcement* — see
Alternatives/Consequences for why, and what would be needed to add them.

### Sourced standards

- **Open Water Diver training dives (open water):** maximum 8 students per instructor, +2 per
  certified assistant, ceiling 12 per instructor.
  ([PADI Standards: Ratios and Depths](https://deepstop.wordpress.com/2008/11/17/padi-standards-ratios-and-depths/);
  corroborated by multiple dive-shop course pages.)
- **Confined water training:** maximum 10 students per instructor, +1 certified assistant per 4
  additional students.
- **Discover Scuba Diving (DSD):** minimum age 10; maximum depth 6 m/20 ft confined water, 12
  m/40 ft open water; open-water ratio matches the Open Water training figure (8:1).
  ([PADI Discover Scuba Diving FAQs](https://blog.padi.com/discover-scuba-diving-faqs/);
  [Discover Scuba Diving Program Age and Depth Limits](https://www.private-scuba.com/courses/discover-scuba-diving-program-limitations.html).)
  **Confidence note (resolved 2026-08-02):** these two DSD sources were a PADI marketing blog and a
  third-party dive-shop page, not PADI's Instructor Manual / General Standards and Procedures
  (member-only). A `dive-domain-expert` review of this ADR flagged that DSD participants have had
  zero prior water time (unlike OW students, who complete confined dives first), and some operators
  run DSD tighter than the certification-course ratio as a matter of prudence — this ratio number
  was the single line item in this ADR worth a direct PADI/manual check before leaning on it
  operationally. The product owner has since supplied the real Instructor Manual figures — 4:1
  confined water, 2:1 open water, both tighter than the 8→12:1 figure this ADR had been applying to
  DSD — and the gate now enforces them separately from the Open Water figure; see
  [20260802-dsd-instructor-manual-ratio](20260802-dsd-instructor-manual-ratio.md) (HD-6).
- **Open Water Diver:** minimum age 15 (10 for Junior Open Water); depth ceiling 18 m/60 ft.
  ([PADI Certification Rules and Requirements](https://blog.padi.com/padi-certification-rules/);
  [How Old Do You Have To Be to Scuba Dive?](https://blog.padi.com/how-old-do-you-have-to-be-to-scuba-dive/).)
- **Junior Open Water Diver (age 10–14):** ages 10–11 capped at 12 m/40 ft, must dive with a PADI
  Professional or certified parent/guardian; ages 12–14 reach 18 m/60 ft with any certified adult.
  ([Junior Open Water Diver vs. Open Water Diver](https://blog.padi.com/junior-open-water-vs-open-water/);
  [PADI Scuba Diving Restrictions](https://blog.padi.com/padi-diving-restrictions/).) Already
  recorded in [glossary.md](../../product/glossary.md#certification) as domain reference.
- **Advanced Open Water Diver:** depth ceiling 30 m/100 ft — the same number for PADI and SSI.
  ([How Deep Can Open Water vs. Advanced Divers Go?](https://blog.padi.com/how-deep-can-open-water-vs-advanced-divers-go/);
  [SSI Advanced Open Water Diver](https://www.divessi.com/en/advanced-training/scuba-diving/advanced-open-water-diver).)
  **Junior Advanced Open Water (age 12–14):** 21 m/70 ft.
  ([How to Upgrade a PADI Junior Open Water Diver Certification](https://blog.padi.com/how-to-upgrade-a-padi-junior-open-water-diver-certification/).)

## Decision

**Enforce the entry-level in-water ratio as a real booking gate, scoped to PADI courses only.**
`src/lib/course-ratios.ts` encodes `entryLevelCourseCapacity(instructorCount, assistantCount)`: 8
students per instructor, +2 per certified assistant (a Divemaster assigned as trip crew, in
DiveDay's role model), capped at 12 per instructor. **As of
[20260802-dsd-instructor-manual-ratio](20260802-dsd-instructor-manual-ratio.md), this 8→12:1 figure
governs Open Water training dives only — a DSD session (`courses.isIntroCourse`) now enforces its
own, tighter, real Instructor Manual ratio (2:1 open water) instead.** `src/db/bookings.ts`'s
`createBookingRecord`
applies it to a course session only when **both** `courses.agency === "padi"` **and** the course
carries no `minimum_certification_level` — the existing "DSD/OW, no pre-existing C-card gate"
bucket the accepted baseline already established — alongside (not instead of) the trip's own
stated capacity; whichever is stricter binds. A session exceeding its ratio returns a new
`course_ratio_full` booking-outcome reason, surfaced to the public booker, the staff roster, and
the diver-profile booking flow (`TripNoticeBanner.tsx`, `schedule/[id]/_components/types.ts`,
`divers/[personId]/_components/NoticeBanner.tsx`).

**The agency check matters, not just for correctness in principle:** `courses.agency` is shop-set
free text (`src/db/courses.ts`), so an SSI (or NAUI, etc.) Open Water course is a real, ordinary
row in this schema today, not a hypothetical. The sourced ratio above is a PADI figure; DiveDay has
not independently sourced an SSI number. Applying PADI's ratio to a non-PADI course would be a
wrong-but-confident safety control — worse than the pre-existing state (capacity-only) — so
non-PADI ungated courses fall back to capacity alone, same as before this gate existed. This is
resolved with a code check (`course.agency === "padi"`) and a dedicated test
(`src/db/courses.test.ts` — "does not ratio-gate an ungated course from a non-PADI agency").

**The trip's currently-assigned crew is re-read at every booking**, so the ratio ceiling can also
*fall* after divers are already booked — a manager pulling the assigned Divemaster or instructor
off a session for an unrelated reason, after 8 divers are already on the roster, leaves that
session over its own ratio with no code-level block (matching the existing `course_unstaffed`
gate's booking-time-only reach, and deliberately never retroactively cancelling an already-paid
seat). The trip Overview page (`trips/[id]/page.tsx`) surfaces a non-blocking staff warning when
`booked > entryLevelCourseCapacity(currently-assigned crew)`, so the moment is visible before the
boat sails even though nothing is auto-invalidated.

**`tripAssignments` (trip crew) carries no per-trip role** — it is just `(tripId, personId)`; the
"instructor" / "divemaster" distinction used here comes from the person's *global* `personRoles`
tag, not anything scoped to what that person is actually doing on this specific trip. A Divemaster
assigned to a session as, say, the boat captain counts identically toward the ratio's "certified
assistant" bonus as one actually in the water shadowing the class. This is a pre-existing modeling
gap in the crew-assignment schema, not introduced here, but this ratio gate is the first place it
becomes safety-load-bearing rather than cosmetic — worth a dedicated look if DiveDay ever needs
crew roles that are per-trip rather than global.

Continuing-education courses (course row's `minimum_certification_level` set — AOW, Rescue,
specialties) are **not** ratio-capped: they already gate on a verified card at booking, and PADI
does not publish a ratio for them as strict and universally consistent as the entry-level figure.
**One exception worth flagging, not resolving here:** Rescue Diver's in-water scenario/stress-test
day is widely treated as needing tight, hands-on supervision — a `dive-domain-expert` review raised
this specifically as worth checking against a real published number before assuming "no ratio
needed" covers every continuing-ed course, rather than just AOW-style dives under looser
supervision. Left unenforced here pending that check, same as before this change (no regression).

**Record the depth-ceiling and minimum-age standards as documented reference data, not enforced
gates**, in the glossary and this ADR. DiveDay does not currently store a numeric dive-site depth
(`dive_sites.depth_range` is deliberately free text, e.g. "12–18m") or a diver's date of birth —
so there is nothing to compare a Junior age-band or depth ceiling against at booking time. The
existing `minimum_certification_level` gate on courses and dive sites is *how* staff already
encode a depth ceiling today: picking AOW for a site whose real depth exceeds 18 m is the
enforcement mechanism, informed by the numbers recorded here.

## Alternatives considered

- **Also enforce minimum age / Junior depth ceilings now.** Would require: a new
  `people.date_of_birth` column (new PII, collected from potentially-minor divers), a UX decision
  for *where* it's collected (profile edit? booking? check-in?), and — the harder call — whether a
  *missing* date of birth fails closed (blocking every existing diver from every entry-level course
  the moment this ships, matching this codebase's prevailing fail-closed convention for
  waiver/cert gates) or fails open (an advisory-only nudge, no regression risk, but a real gate
  only in name). That fail-open/fail-closed choice has production blast-radius the numeric-standard
  question does not, so it is left for a scoped follow-up decision rather than folded into "trust
  the PADI numbers."
- **Convert `dive_sites.depth_range` to a structured min/max and enforce a numeric depth ceiling
  per diver.** Free text was a deliberate choice for that field; converting it and adding the
  parsing/validation is materially more scope than the ratio gate, and the existing
  `minimum_certification_level` site gate already does the job today, just without a machine-checked
  link back to a real number. Left as a future refinement if a shop's site catalog wants it.
- **Model PADI's confined-water ratio (10:1) too.** DiveDay's trip model has no confined-water
  concept — a trip is one dated open-water outing — so only the open-water figure (the tighter,
  more conservative of the two) applies.

## Consequences

- A PADI shop running an entry-level course session with only one instructor and no Divemaster
  aboard now has a real 8-seat ceiling, independent of whatever capacity they set on the trip —
  closing a real safety gap where a DSD/OW session's public "capacity" could imply more room than
  PADI's own ratio permits.
- Assigning an additional instructor or a Divemaster to trip crew immediately raises the ratio
  ceiling for that session (booking-time check, same as the existing capacity check) — no schema
  change, no migration. The same re-read means the ceiling can fall too if crew is reduced after
  booking; the trip Overview's non-blocking warning is the mitigation, not a hard block (see
  Decision).
- A non-PADI shop's ungated course (SSI, NAUI, etc.) is unaffected by this change — capacity-only,
  same as before — until an agency-specific ratio is sourced and added.
- H-08's "must verify — needs the operator's agency-specific input" note for **PADI** ratios is
  resolved; the minimum-age/Junior-depth piece stays open pending the DOB-collection and
  fail-open/closed call above; a non-PADI ratio and Rescue Diver's specific supervision needs stay
  open pending their own sourcing.
- Safety-critical surface (course/cert gating) — carries a `dive-domain-expert` review before
  merge per AGENTS.md.
