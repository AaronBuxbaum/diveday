# 20260803-trip-admission-at-booking — A trip's own cert gate is checked when the seat is sold

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

A trip states what it demands of a diver in two places: its own `trip_requirements` row (minimum
certification level, required specialties, nitrox) and the inherent gate of every dive site the
itinerary visits (`dive_sites.minimum_certification_level` / `required_specialties` /
`requires_nitrox`, folded by `combineSiteRequirements`). Until now **nothing read either of them
until boarding.** `calculateReadiness` (src/lib/readiness.ts) composed them and blocked the
manifest; `createBookingRecord` (src/db/bookings.ts) never looked.

The consequence is the finding recorded as DOM-M6 in
[comprehensive-review-20260802](../../product/archive/comprehensive-review-20260802.md): a diver
whose card this shop has already looked up with the agency and recorded as **Open Water** could book
the Advanced-only deep wreck, and — because that charter is exactly the kind that carries
`requires_payment` and a pay-at-booking checkout — **pay in full** for a dive they were never going
to be allowed to do. They find out at the dock, and the shop finds out holding their money.

The shape of the fix already existed one gate over. A *course* enforces
`courses.minimum_certification_level` at enrollment, in the booking transaction, failing closed on a
diver with no verified card ("Existing-card courses deliberately fail closed at enrollment"). The
trip's own gate had no equivalent.

What made this non-trivial is the second lesson already on the record. H-08 asked the same question
for the course minimum-age gate — *refuse when the shop has no evidence, or admit?* — and the
product owner **chose to fail open** (option B, 2026-07-24): a diver with no date of birth on file
books exactly as before, "so shipping it changed nothing for existing divers — option C (fail
closed) was declined for exactly that blast radius." The same blast radius applies here and is
larger: the seeded demo shop states `open_water` on *every* non-course trip, which is what a real
shop's default looks like too. A gate that refuses on absent evidence would refuse **every
first-time customer on every charter**, and every diver whose cards were never captured because
nothing before this asked for them.

## Decision

**A booking is refused when the shop's own record of this diver says the seat is impossible — never
merely because the record is silent.**

The rule lives in one pure function, `decideTripAdmission` in **`src/lib/trip-admission.ts`**, and
is called from exactly one place: `createBookingRecord`. Every door therefore reaches it — the
public schedule form and its party booking, all four staff doors through `seatDiver`, the global
add-booking flow, and a diver's own self-service reschedule — because every one of them already goes
through that function. No call site re-implements it.

It refuses when **both** of these hold:

1. The trip's effective requirement — its own row composed with every site the itinerary visits,
   strictest level, union of specialties, nitrox if any one of them wants it — demands something;
   **and**
2. this shop has adjudicated this diver (at least one `verified` certification on file) and nothing
   in their record can satisfy that demand: no certification of any status reaches the required
   rung, or a demanded specialty has no card of any status, or nitrox is demanded and no
   enriched-air card exists.

The refusal is a code with structured detail, never a sentence: `trip_prerequisite`, carrying
`{ requiredLevel, missingSpecialties, nitroxRequired, heldLevel }` so a staffer can see *which*
requirement failed and *what the diver holds*. Words come from the message bundles as usual.

Three deliberate choices inside that rule:

- **Verification status and refresher dates are not consulted.** A pending capture is a card a
  staffer is about to adjudicate; an overdue date is a shop-set *refresher-due* date (glossary,
  **C-card**) a diver can clear before departure. Neither makes a seat impossible, and readiness
  still refuses boarding until they are resolved. What cannot be moved by paperwork before the boat
  leaves is the rung of the ladder a diver stands on and whether they hold a specialty card at all.
- **Nitrox here is the *charter* requirement, not the mix request.** One card, two independent
  gates: `trip_requirements.requires_nitrox` / `dive_sites.requires_nitrox` say *you must hold an
  enriched-air card to board this boat*, while `bookings.wants_nitrox` is this diver asking for that
  mix on this dive (glossary, **Nitrox request**). This rule touches only the first. The ladder the
  same card climbs is unchanged and consistent with `src/db/nitrox.ts` and the amended H-11 —
  **book** on a card in any state, **board** on a verified one, **fill** only on one that is
  verified, unarchived, and (if imported) confirmed.
- **An identity-unconfirmed booking is not judged by the matched record's cards** (H-13). Those
  cards are evidence about somebody; whether they are evidence about the person booking is exactly
  what the flag says is unknown. Readiness already fails closed on the flag itself.
- **The gate runs after capacity and the course gates, and before a walk-in's person row is
  written.** A full boat is answered as full — the cheaper answer, and one that says nothing about
  the person behind a guessed email — and a refused walk-in leaves no orphan person behind.
- **A course session is admitted on the course's own rule, not the itinerary's** (added
  2026-08-03, `dive-domain-expert` review). Continuing education is taught *at the sites it
  certifies people for*: an AOW course's deep adventure dive happens at a site marked
  `advanced_open_water`, and a Deep specialty course at a site with `requiredSpecialties:
  ["deep"]`. Composing the site's inherent gate on a trip with a `course_id` refused a verified
  Open Water diver enrolling in the very course that would give them the card — and refused them
  invisibly (the trip page rendered the "this site also requires…" note only in the *non-course*
  branch) and unfixably (`saveRequirementsAction` refuses to edit a course session's requirements
  at all), with detaching the dive site — losing the briefing and the depth advisory — the only
  escape. `courses.minimum_certification_level` is already enforced at enrolment, more strictly,
  by the `course_prerequisite` gate above; the itinerary must not add a second one on top. This
  changes **nothing** about readiness: the site's gate still raises the student's blocker for the
  instructor, which is the right place for it.

Fail-closed where the *lookup* is what fails: both requirement reads happen inside the booking
transaction, so a query that throws aborts the whole thing and no seat is written.
[Tests](../../../src/db/bookings.test.ts) assert that directly.

## Alternatives considered

- **Fail closed on absent evidence** (the strict reading of "check it at booking"). Rejected on the
  precedent H-08 set for the same question three weeks earlier: with a shop's default gate stated on
  every trip, it locks out every new customer and every un-carded existing diver, and moves the
  product's front door behind a counter visit. It remains the available upgrade once shops have
  captured cards — see *Consequences*.
- **Refuse only on the level ladder, not specialties or nitrox.** Rejected: the harm DOM-M6 names is
  a *site* gate (Spiegel Grove is AOW **+ Deep**), so a level-only rule would miss the case that
  motivated it.
- **Reuse `calculateReadiness` and filter to certification blockers.** Rejected: it answers a
  different question — "is this diver cleared right now?" — and every blocker it raises that a
  person can still fix before departure would have become a refused sale. It also demands a
  `TripRequirement` row and waiver/payment inputs a booking has no business synthesising.
- **Enforce it per surface** (the public form checks, staff override). Rejected outright: five doors
  drifted apart once already, which is why `seatDiver` exists.
- **A staff override.** Rejected because there is nothing to match: the existing readiness path
  grants staff **no** override of a cert blocker — a blocked diver is blocked on the manifest for
  everyone — and inventing one here would be a new policy smuggled in as a refactor. Staff clear
  this refusal the way they clear the readiness blocker: capture and verify the card.

## Consequences

**What this deliberately does not do.**

- It **does not refuse a diver the shop has never carded.** A brand-new customer can still book —
  and still pay for — a charter they may turn out not to qualify for. That is DOM-M6 narrowed, not
  closed, and it is narrowed exactly as far as H-08 chose to narrow the age gate. Closing it is a
  human decision (the analogue of H-08's declined option C), not an engineering one, and it should
  be taken only once shops have backfilled cards.
- It **does not refuse on an expired/overdue card, a pending capture, or an imported specialty card
  awaiting a staffer's one-tap confirm.** Readiness holds all three at the dock.
- It **does not gate `restoreBooking`.** An undo of a roster removal is not a new sale, and that
  function already documents why it copies only the capacity and ratio checks.
- It **does not change the manifest, roll call, or readiness in any way.** Boarding remains the
  authority; this only stops the money.
- It **adds no override affordance**, matching today's readiness behaviour rather than inventing a
  policy.

**Cost.** Two extra reads per booking (the requirement row and the visited-site fold) inside the
transaction, plus three evidence reads only when the trip actually demands something *and* the diver
is known — a booking on an ungated trip pays nothing new beyond the two.

**Surfaces.** `trip_prerequisite` is a new `BookingOutcome` reason, so every consumer that maps a
refusal to words needs an entry: `src/app/actions/seat-diver-surfaces.ts` (done — the trip/roster
doors get their own notice, the counter's `coarse` collapse folds it into `walkin_unavailable`), the
notice maps on the trip page, the global add-booking page, and the diver record, and the
`booking_blocked` reason union in `src/lib/analytics.ts`.

**The structured refusal reaches the words** (added 2026-08-03). The `{requiredLevel,
missingSpecialties, nitroxRequired, heldLevel}` payload above is this decision's stated
justification for carrying detail at all, and it initially reached no UI: `seatDiver` kept only the
code and every surface rendered one static sentence. It now rides the staff redirect as a single
`gate=` param (`encodeTripAdmissionRefusal` / `decodeTripAdmissionRefusal`, codes only, rejected
wholesale if anything is unrecognized) and resolves through
`tripAdmissionRefusalText` (`src/i18n/readiness-labels.ts`). This matters beyond precision: the one
sentence said *"Add the missing card above"*, and on a **level** refusal there is no missing card —
telling a staffer to add one points them at the certifications form as the way past a safety gate,
and a hand-entered card lands `pending`, which clears admission on the very next attempt. That is
the leak H-24 exists to prevent. So a level refusal names the requirement *and* the held level and
makes "add a card" conditional on the diver actually holding one, while a specialty/nitrox refusal
says plainly that no such card is on the record — which is where "add it" is right.

**The public form does change** (amended 2026-08-03). It originally fell through to the
non-disclosing "unavailable" — *"This trip isn't taking bookings right now"* — which is **false and
visibly so** on a page displaying "4 spots left", and left no record on any staff surface for the
diver who then phones. The resolution is to say what the **trip** requires rather than what the
person lacks: identical for every submitter, describing the boat, and revealing only what the page
above the form now displays. Because a trip's requirement is a property of the trip and no oracle,
it is also **stated before the booking form** (`tripRequirementList`), where previously it was
passed only into `BookingConfirmation` — i.e. first shown *after* the seat was bought. H-22's rule
is intact: nothing the public form says is about that diver's record. The residual
succeed/fail oracle is recorded for the product owner, not closed here.

**Copy.** `trips.notices.diverTripPrerequisite`, `divers.notices.tripPrerequisite`,
`shared.tripAdmission.*`, `trips.requirements.siteAlsoRequiresCourse`,
`trips.notices.requirementsBlocking*`, and diver-side `trip.requirement*` /
`booking.errors.tripRequirement*` — both locales.

The rule is stated once, in `src/lib/trip-admission.ts`, with its reasoning in the module docstring
so a future reader meets the H-08 precedent before they meet the code.
