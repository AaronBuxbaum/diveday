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

`rental_fit_profiles` gains `needs_staff_fit_at`, `needs_staff_fit_note`, and
`needs_staff_fit_by`. When the shop can't fill a size a diver asked for, staff flag the diver
instead of packing something else.

**The flagged diver keeps their line on the packing list; only the *size* comes off.** The row
reads "Fit at check-in" with the count intact, and they are also named in a
`diversNeedingStaffFit` bucket that explains it. This is deliberately not "drop their kit": the
count is the number the packer actually loads from, so removing the row loads the boat one BCD
short and the crew arrives with nothing to fit them from. Unsized pieces — regulator, dive
computer, GoPro — are untouched by the flag entirely; a regulator has no size to be wrong about,
and leaving life support ashore to avoid packing a wrong-size wetsuit is the strictly worse trade.
(A `dive-domain-expert` review caught the first cut doing exactly that.)

**Weights are untouched too**, though they do record a value. Lead is bulk stock in 2 lb
increments — a shop is never "out of 12 lb" — so there is no stock size to be short of, and usual
weighting is the most safety-relevant number in the whole fit: under-weighting is a diver who
can't hold a safety stop, over-weighting is an over-inflated BCD and a bad ascent. Blanking it
because there's no L BCD trades a real number for nothing.

Their **tanks still count**. Gas isn't sized, and a diver never loses their air over a wetsuit.

The check-in bucket carries **the sizes they asked for**, not just their name. The person doing
the fit is usually the captain, who by design can't edit the fit and now sees no size on the
packing line — "bring a range in their band" is an empty instruction if the band appears nowhere
in the app.

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
it. `setNeedsStaffFitAction` applies the same gate to the *clear* direction. That one is easy to
get wrong and was wrong in the first cut: a clear is the **absence** of a form field, so hiding
the button changes nothing about what the action receives, and both review passes found a captain
could clear any flag by submitting the form directly. Hiding a control is not authorization.

Two boundaries matter more than they first look:

- **The gate is on *overriding*, not on *writing*.** A diver with no fit on file has stated
  nothing to override, so recording their sizes the first time is ordinary data entry and stays
  open to any staff member. Gating it would strand the Saturday walk-up whose only staff on the
  floor are a captain and a deckhand — their sizes end up on a napkin and the prep list still
  reads "not asked".
- **Raising the flag is open; clearing it is gated.** Raising escalates to a person and is exactly
  what the captain who finds the empty rack needs. Clearing asserts "we can pack her stated size
  after all" — the judgement call — and an unattributed one-tap clear would put a diver back into
  gear nobody re-checked, which is the very thing stickiness protects against. `needs_staff_fit_by`
  records who raised it, matching how roll-call events record who called them.

### 3. Diver date of birth: collected, optional, fail-open

`people.date_of_birth` — date-only (CR-009), nullable, entered on the diver profile. At booking,
a course's existing `minimum_age` is enforced **only when a date is on file**:

- No date on file (including every diver today, and every brand-new walk-in) → books exactly as
  before. New `course_min_age` outcome never fires.
- Date on file and under the minimum **on the day the course runs** → refused, **on staff-initiated
  bookings only**.
- **The anonymous public form never refuses on age.** A refusal there answers "is the holder of
  this address a child under N?" to anyone who can guess an address, and the course minimums
  (10/12/15/18) let a few probes bracket a real child's age. It runs before the capacity check, so
  probing is free and leaves no booking behind. It is also unsound on the merits: that form never
  proves the submitter is the person on file for the email — the same uncertainty
  `identityUnconfirmedAt` exists for (H-13) — so it would judge a stranger by someone else's
  record. A `security-reviewer` pass caught this as an exploitable oracle in the first cut.
- **The diver's own checklist never names age either.** `under_minimum_age` is filed under
  `setup` and worded identically to `identity_unconfirmed`, so it collapses into the same generic
  "your shop is finishing a check" line. Anyone who can guess an email can book it onto a public
  session and read the confirmation panel; distinguishable copy there would be the same oracle one
  step later. Staff see the real reason, with both numbers.
- **Age is therefore also a readiness blocker** (`under_minimum_age`), re-evaluated on every read
  rather than once at enrollment. That is what makes the public path safe to let through, and it
  closes a second gap the domain review raised: a booking-time-only gate is inert for every diver
  whose date was recorded *after* they booked, which — since nothing collected dates before this
  shipped — is nearly all of them. It also catches a session rescheduled across a birthday.

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
- **Dropping the flagged diver's kit from the list entirely.** The first implementation did this,
  reasoning that any packed size would be the wrong one. It under-packs: the count is what the
  packer loads from, and a boat that arrives with N-1 BCDs has nothing to fit the flagged diver
  *from*. Blanking the size while keeping the count gets both properties.
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
- Deck crew keep every action they need at the dock (record a first fit, flag for fitting) and
  lose only the ability to rewrite a request already on file.
- The export bundle now carries `date_of_birth`, `dive_insurance` (a pre-existing omission a new
  column-level coverage test caught), and the three `needs_staff_fit_*` columns; without them a
  shop that exported and re-imported silently lost every flag and every birth date — and the
  latter is what H-08's fail-closed upgrade path depends on. The contact importer reads
  `date_of_birth` back, dropping an implausible one with a warning rather than feeding a garbage
  year to an age gate. The bundle now contains minors' birth dates, which is within the stated
  posture of `canExportShopData` but worth naming.
- H-06 is fully implemented. H-08's minimum-age piece is now enforced-when-known; the Junior-tier
  *depth* ceilings (12 m / 18 m / 21 m by age band) remain documented-but-unenforced, since those
  need a numeric site depth DiveDay still doesn't store — see
  [20260724-course-admission-standards](20260724-course-admission-standards.md).
- Safety-critical surfaces (gear fit, course admission) and new personal data — carries
  `dive-domain-expert` and `security-reviewer` review before merge per AGENTS.md.
