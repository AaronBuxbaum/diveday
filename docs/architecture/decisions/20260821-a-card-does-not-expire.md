# 20260821-a-card-does-not-expire — Drop the certification expiry date; a card's evidence is its number

- **Status:** Accepted
- **Date:** 2026-08-21

Supersedes [20260723-certification-expiry-date-only](20260723-certification-expiry-date-only.md).

## Context

`certifications.expires_at` and `specialty_certifications.expires_at` modelled a rule that does
not exist. Neither PADI nor SSI expires a recreational certification or mandates a refresher —
the glossary's **C-card** entry has said so since it was written — and H-08 responded in
2026-07-24 by *keeping* the column and its gating and relabelling the staff copy as a shop-set
"refresher due" date. The relabel shipped, and the code underneath did not change: a date in the
past made `validVerifiedCertification` false, which raised `certification_expired` /
`specialty_expired`, held the depth ceiling down, and refused a course prerequisite. So the
strictest gate in the product — the one that decides who gets in the water — was enforcing a shop
policy that no agency asks for and most shops never set.

The product owner reversed the relabel half of H-08 on 2026-08-21 (issue #630, combining #626 and
#609). This ADR records the removal and the two things it deliberately leaves alone.

**The claim is about a recreational *diver* card, and it is worth being exact**, because a
divemaster reading a flat "nothing in diving expires" would be right to stop trusting the rest.
Three things really do lapse, and **DiveDay models none of them**, so none was ever what this column
held: a **professional rating** renews annually at every agency (a lapsed Instructor is out of
teaching status and uninsured); **GUE** alone among the agencies in the enum states a validity on
its certifications and requires recertification; and a **CMAS** star card is permanent while the
national federation's licence behind it is annual and medical-linked. CPR/EFR and O₂-provider
tickets expire too, and are a genuine prerequisite for Rescue and the professional grades. What was
stored here was none of those: it was a shop-set refresher date on a recreational level or specialty
card, and no agency asks for one (`dive-domain-expert`, 2026-08-21).

## Decision

- **Both columns are dropped** (`drizzle/20260821223019_drop-certification-expiry`), with the
  `-- diveday:allow-destructive` line the guard requires and "pre-pilot, no users, H-49" as the
  reason. No backfill, no tolerance code: there are no rows anyone would miss.
- **`validVerifiedCertification(card)` is `status === "verified"` and nothing else.** It takes no
  `todayLocal`, and neither do `hasVerifiedCertificationAtLeast`, `certificationBlocker`,
  `specialtyBlocker`, or `diverDepthLimit`. `ReadinessInput.timezone` is gone with them — nothing
  in `calculateReadiness` reads a calendar date any more.
- **Two blocker codes are deleted**, `certification_expired` and `specialty_expired`, along with
  their entries in every label map and their message keys in both locales.
- **Every surface that rendered the date is gone**, not reworded: the add-card and add-specialty
  forms, the diver-record card lines, the `expired` card display state, the `/ready/[token]` entry
  forms' expiry input, the departure log's refresher line, and the CSV import's
  `certification_expires_at` column mapping with its two issue codes.
- **A shop may no longer require a professional rating.** `REQUIRABLE_CERTIFICATION_LEVELS`
  (`src/lib/readiness.ts`) is Open Water, Advanced Open Water, Rescue — a different set from
  `CertificationLevel`, which is what a person can *hold*. Divemaster and Instructor stay in the
  enum and on the record: crew hold them, `course-ratios.ts` counts them, and an instructor-led
  session is gated on one being assigned. The site and trip requirement `<select>`s and both zod
  schemas read the narrower list.

### Explicitly not touched

- **`waiver_records.expires_at`.** A waiver genuinely lapses. Unchanged.
- **The Scuba Refresher course template.** A ReActivate-style refresher is a real product a shop
  sells. This removes a date on a card, not a course.
- **Dive recency** (`bookings.last_dived_band`, `src/lib/dive-recency.ts`). "When did you last
  dive?" is the question a card cannot answer, and a `dive-domain-expert` review already found it
  worth more than everything the booking gate catches
  ([20260821-currency-is-what-catches-people](20260821-currency-is-what-catches-people.md)). It
  stays, and it is still not a gate.

## Alternatives considered

- **Keep the column, stop gating on it** — a date nothing reads is a field staff still fill in,
  and the next reader restores the gate because the column looks load-bearing.
- **Keep it for specialties only** — no agency expires a Deep or Wreck card either; the asymmetry
  would be ours alone and would need explaining at every call site.
- **Add `master_scuba_diver` above Rescue instead of capping there** — MSD is Rescue plus five
  specialties plus fifty dives, which a linear ladder cannot express, and
  [20260725-imported-card-sighting](20260725-imported-card-sighting.md) deliberately files it under
  `level_not_gated`. Raised as an open point on #630 and answered: cap at Rescue, no new enum value.

## Consequences

- **Boarding is strictly more permissive.** Every diver a past date used to block now clears on
  `verified` alone. That is the intent — the block was enforcing a rule the agencies do not have —
  but it is the one direction a safety gate should never move by accident, so it is stated here
  rather than left to be discovered: no diver is newly *refused* by this change, and some who were
  refused are now cleared. `pnpm test src/lib/readiness.test.ts` is where that contract lives.
- Readiness no longer needs a timezone, so a caller cannot get one wrong. The shop's timezone is
  still threaded everywhere a *rendered* date needs it (`pnpm check:timezone` is unaffected).
- A shop that genuinely wants a currency policy has one place to put it, and it is not a card:
  `last_dived_band` already asks the diver the question that catches people, and #617 is live.
- **Escape hatch.** If an agency ever does start expiring recreational cards, the column comes
  back as a new migration on an empty-by-default nullable date, and the gate goes back into
  `validVerifiedCertification` — one function, with `readiness.test.ts` in front of it. The cost is
  a migration and one predicate, not an archaeology exercise, which is why dropping it now is
  cheaper than carrying it.
