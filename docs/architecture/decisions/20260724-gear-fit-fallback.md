# 20260724-gear-fit-fallback — Needs-staff-fit fallback, gear-override gate, and diver date of birth

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

Two H-rows had one implementation step left each, and both land in the same place — what the
crew does with a diver's stated request when reality doesn't match it.

**H-06 (gear policy)** decided, but had not built: *"any staff member on the trip may substitute a
real available item (logged), but overriding/denying a diver's stated request is reserved to
instructor/divemaster/manager (rides on the H-14 role matrix), and when a requested size is
unavailable the request drops to a 'needs staff fit' state rather than auto-assigning a different
size."* The H-14 roles it depended on shipped in
[20260724-role-authorization](20260724-role-authorization.md), so it was buildable.

**H-08 (course admission)** left minimum-age enforcement open after
[20260724-course-admission-standards](20260724-course-admission-standards.md) recorded PADI's
published age and depth numbers as reference data only. That ADR named the blocker precisely:
DiveDay stores no diver date of birth, and adding one is a new-PII decision with a
fail-open-vs-fail-closed question attached. The product owner chose **option B — collect it, fail
open** (2026-07-24).

## Decision

### 1. "Needs staff fit" is a first-class state, not a substituted size

`rental_fit_profiles` gains `needs_staff_fit_at` + `needs_staff_fit_note`. When the shop can't
fill a size a diver asked for, staff flag the diver instead of packing something else. The flagged
diver's sized kit **drops off the packing lines entirely** (`buildDivePrepChecklist`) and they are
named in a new `diversNeedingStaffFit` bucket on the prep page — packing a size nobody chose is
the exact outcome the flag exists to prevent, so the list must not quietly show one.

Their **tanks still count**. Gas isn't sized, and a diver never loses their air over a wetsuit.

`rentalFitLine` — the one-line fit on rosters and manifests — gains a fourth state,
`needs_staff_fit`, deliberately distinct from both "own kit" and "not asked". Collapsing it into
either is how a diver ends up kitted from a size the shop doesn't have.

**The flag is sticky.** `saveRentalFit` does not clear it; only the explicit "fit resolved" action
does. A stale flag costs one extra look at the dock; a wrongly-cleared one puts a diver in gear
nobody checked, so the asymmetry is resolved in favour of the boring failure.

### 2. Editing a diver's stated fit is gated; flagging is not

New predicate `canOverrideGearRequest` → owner, manager, instructor, **divemaster**. Note this is
*wider* than `canConfigureTrips` (which excludes divemasters): sizing a diver is in-water
judgement a DM makes constantly, while defining what a trip *is* is not their call. The two gates
answer different questions and should not be collapsed.

Enforced in both layers per ADR-0006: `saveProfileAction` re-checks against live roles
(`canPersonOverrideGearRequest`), and the diver page renders the fit read-only for staff without
it. `setNeedsStaffFitAction` is deliberately **open to all staff** — it escalates to a person
rather than overwriting the diver's request, which is the whole reason it's the safe fallback.

### 3. Diver date of birth: collected, optional, fail-open

`people.date_of_birth` — date-only (CR-009), nullable, entered on the diver profile. At booking,
a course's existing `minimum_age` is enforced **only when a date is on file**:

- No date on file (including every diver today, and every brand-new walk-in) → books exactly as
  before. New `course_min_age` outcome never fires.
- Date on file and under the minimum **on the day the course runs** → refused.

Age is measured on the trip's start date, not the booking date: a 14-year-old booking a 15+ course
for a date after their birthday is eligible, and checking at booking time would wrongly refuse
them. `checkMinimumAge` returns an explicit `unknown` rather than a boolean so the fail-open policy
lives at the call site — a future switch to fail-closed is a deliberate edit, not a one-character
inversion buried in arithmetic.

## Alternatives considered

- **Fail closed on a missing date of birth (option C).** Matches this codebase's prevailing
  convention for safety gates (waiver, cert). Rejected by the product owner for blast radius: no
  diver has a date on file today, so shipping it would block every existing diver from every
  age-gated course until someone backfilled birthdates. Option B is upgradeable to this later once
  shops have had time to fill the field in; the reverse is not true.
- **Don't collect date of birth at all (option A).** Zero new PII, and dock-side ID checks remain
  the real control regardless. Rejected because the shop often *does* know the diver's age, and
  catching a mis-aged booking three weeks early is worth a nullable column.
- **Per-item "needs staff fit" (flag the BCD, not the diver).** More precise, but the shop tracks
  no equipment inventory at all (`dive-prep.ts`) — there is nothing to hang per-item availability
  off. A per-diver flag with a free-text note ("no L BCD") carries the same information to the
  dock at a fraction of the modeling cost.
- **Clear the flag automatically when sizes are edited.** Tempting — the request changed, so the
  old shortage may be moot. Rejected: it silently re-enables packing for a diver a human flagged,
  and the failure mode is a diver in unchecked gear.
- **Gate the flag action too.** Rejected: it is the safe fallback. Making the *conservative* action
  harder to reach than the override would push crew toward the override.

## Consequences

- A shop that never fills in a date of birth sees no behavioural change at all from part 3 — the
  gate is inert without data. That is the point of option B.
- Deck crew (captain, crew) can no longer rewrite a diver's rental fit. They can still flag for
  hands-on fitting, which is the action they actually need at the dock.
- The prep list may now show fewer packed items than divers booked; the "fit these divers at
  check-in" section explains the gap. Tank counts are unaffected.
- H-06 is fully implemented. H-08's minimum-age piece is now enforced-when-known; the Junior-tier
  *depth* ceilings (12 m / 18 m / 21 m by age band) remain documented-but-unenforced, since those
  need a numeric site depth DiveDay still doesn't store — see
  [20260724-course-admission-standards](20260724-course-admission-standards.md).
- Safety-critical surfaces (gear fit, course admission) and new personal data — carries
  `dive-domain-expert` and `security-reviewer` review before merge per AGENTS.md.
