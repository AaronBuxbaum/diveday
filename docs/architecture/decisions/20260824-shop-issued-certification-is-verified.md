# 20260824-shop-issued-certification-is-verified — A shop's own instructor certifying a diver lands `verified`, not `pending`

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

DiveDay's `certifications` table (level cards) is capture-then-verify: a row starts `pending` —
someone typed a card's agency/level/number, either the diver themselves or a staffer transcribing a
physical card — and only an explicit staff review (`reviewCertification`) promotes it to `verified`,
the one state every readiness gate, depth ceiling, and course prerequisite reads
(`validVerifiedCertification`).

Before issue #717 there was no path from "this shop's own instructor taught and certified this
student in a session it ran" to a `certifications` row at all. A shop that graduated a diver on
Sunday had to hand-type that diver's card back in on Monday, as an unsighted capture indistinguishable
from a stranger's — and until a staffer did, the shop's own booking gate
(`courses.minimum_certification_level` → `createBookingRecord` → `course_prerequisite`) refused the
graduate's own next-level booking.

The card *number* for a freshly-issued certification is not available at the moment of certifying —
it comes from the agency's own processing, routinely days behind the instructor's own sign-off. A
hardened invariant on `certifications` (`certifications_identifier_present_unless_self_declared`,
tightened 2026-08-15 after a bug let a numberless row reach `verified`) requires a real, non-blank
`identifier` for any `verified` row, with one existing exception: a self-declared row, which may be
numberless only while `pending`.

## Decision

**A per-student "Certified" tap on a course session's own roster lands the resulting `certifications`
row `verified` immediately, with `identifier` left `null`.** Never `pending`, and never automatic —
this is the only writer of the new `issued_by_shop_at` provenance column, reached from exactly one
place: an explicit instructor (or any active staff member — see below) tap on that session's roster.
A trip's status changing, a roll call closing, or any other lifecycle event must never mint one.

**Trusted by provenance, the same shape `imported_at` already established, and stronger.** An
imported card lands `verified` on arrival because DiveDay assumes the shop's own prior system already
checked it — trusted because of a system nobody at this shop watched. A shop-issued card is trusted
because a specific, accountable instructor on this shop's own roster is asserting personal knowledge
that a specific person met the standard, in a session this shop ran. That is not a weaker claim than a
staffer looking a number up with the agency; it is a different, and at least as strong, one. Landing
it `pending` until a number arrives would reproduce the exact gap this decision exists to close, one
layer down — the diver would still be `Blocked` on their own graduation until a staffer later retyped
a number.

**Three new columns on `certifications`, mirroring the existing provenance idiom
(`imported_at`/`imported_from_label`, `self_declared_at`) rather than a new status value:**
`issued_by_shop_at` (the stamp), `issued_from_trip_id` (which session), `issued_by_person_id` (who
tapped it). A new `certification_status` enum member was considered and rejected — see below.

**The check constraint gains a third, unconditional exception.** The self-declared exception is
conditioned on `status = 'pending'` — a diver's bare claim can never be numberless *and* `verified`.
The shop-issued exception is not conditioned on status at all, because the row is meant to be
numberless *and* `verified` from the moment it is created; that is the entire point.

**Who may tap it: any active staff member of the shop, not instructor-only** — the same trust
boundary H-48 already settled for card *sighting* (`docs/product/human-decisions.md`). A shop-issued
certification is a stronger act than sighting (it originates verified evidence rather than confirming
a claim already on file against a physical card), and that distinction is deliberately not re-litigated
here: extending H-48's answer to a stronger act is the position this decision takes, not an oversight.

**Serialized against itself.** A numberless row has no unique index to catch a duplicate the way every
other write to this table does (`certifications_shop_agency_identifier_unique` is keyed on
`identifier`, and a null identifier is invisible to it — CR-009). Two genuinely concurrent taps could
otherwise both pass an "already certified at this level" check before either insert commits. The
write locks the target person's own row `for("update")` inside a transaction first, so the check and
the insert act as one atomic unit (`issueShopCertification`, `src/db/readiness.ts`).

**Scoped to `certifications` (the level ladder) only.** `specialty_certifications` and
`nitrox_certifications` are deliberately not extended by this decision — see the follow-up filed as
issue #975. Both tables hold even an *imported* row back from clearing its own gate until a staff
confirm, because a specialty or nitrox mistake is materially higher-consequence than a level mistake;
whether a shop's own instructor should get the same one-tap-to-verified treatment there is a distinct
product call this decision does not make.

## Alternatives considered

- **Land the row `pending` until a number arrives.** Rejected: reproduces the gap this decision exists
  to close. The diver stays `Blocked` on their own shop's graduation until a staffer retypes a number
  that arrives asynchronously, days later.
- **A new `certification_status` value** (e.g. `verified_pending_number`). Rejected:
  `validVerifiedCertification` is deliberately a one-line predicate (`status === "verified"`) read
  identically by every gate. A third value either has to be treated as equivalent to `verified`
  everywhere — an enum member that changes nothing except adding a place every future reader has to
  remember to handle — or isn't, in which case the diver is back to the rejected `pending` outcome.
- **Instructor-only issuance**, narrower than H-48's "any active staff" answer for sighting. Rejected
  for consistency with the established trust boundary; the surface itself (a tap beside a name on that
  session's own roster) is the scoping mechanism, not the tapper's specific role.
- **Extend the same treatment to specialty and nitrox certifications in the same change.** Rejected as
  a distinct decision — see issue #975.

## Consequences

- A shop's own graduate can book their next-level course or a fun dive immediately, with no staffer
  retyping a card.
- A `verified` level card can now be numberless. Any future reader of `certifications` that assumed
  `verified` implies a real `identifier` must check `issued_by_shop_at` (or the existing
  `self_declared_at`-and-pending case, which this does not change) before relying on that assumption.
- No path currently edits an existing certification's `identifier` in place — a card number typed in
  later lands as a second, separate `verified` row at the same level (harmless for gating; a data-
  hygiene loose end). A lightweight "add the card number" affordance is a plausible future follow-up,
  not built here.
- `issued_from_trip_id` references `trips.id` with `onDelete: "set null"` — a *production* trip is
  never hard-deleted (ADR 20260820-every-delete-is-soft), but the e2e/demo reset path does, and the
  certification itself must survive its own session's row going away with only that one pointer
  cleared.
- Revisit if a real agency ever exposes a usable card-issuing API (H-10 stays Dropped): that would be
  a different, additive decision, not a reason to unwind this one.
