# FU-20260815-a-wrong-not-certified-stamp-has-no-eraser — Give staff a way to clear a "not certified yet" a diver never said

- **Status:** Open
- **Raised:** 2026-08-15 — the `security-reviewer` pass on `people.no_certification_declared_at`
  (ADR 20260814-self-declared-cards, amendment 2026-08-15), finding 2.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/self-declared-cards.ts`, `src/db/schema.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/_components/`

## What I noticed

`people.no_certification_declared_at` is written by an **unauthenticated** form — the public
last-minute-deal join and the wait-list join, both of which resolve a person by shop + email through
`findOrCreatePerson`. The anti-displacement rule keeps that write off anybody the shop holds a card
for, which is the important half. But for a diver the shop has **no card on file for** — the ordinary
case for someone whose card was never captured — anyone who knows their name and email (both are on
any boat's manifest) can post the public form and permanently mark that diver *"Not certified yet —
diver's word"*.

There is no way back. A grep for `noCertificationDeclaredAt` finds exactly two writers: the public
one, and `ERASED_PERSON_COLUMNS` in `src/db/anonymize.ts` — owner-only erasure, which destroys the
whole record. **No staff action clears the stamp.** It renders on the deal-list and wait-list rows,
and it goes out in every `people.csv` the shop exports and every scheduled backup bundle from then on.

Contrast a wrong *level*: that is a `certifications` row, and a staffer can archive it from the diver
record in two taps. The weakest statement in the model is the only one that is permanent.

Impact is genuinely bounded — it gates nothing, `decideTripAdmission` and readiness never read it,
and it is suppressed from the summary the moment any card lands — so this is not a vulnerability. It
is a record a shop cannot correct.

## Why it isn't already done

The ADR scoped the stamp to one column, one writer and two read surfaces, and a staff control is a
new surface with its own authorization question. The write also has a legitimate reason to be
sticky: it is provenance, and "where a record began is history" is the argument that keeps
`self_declared_at` after a sighting. Clearing is therefore not obviously the same act as archiving a
card, and a staffer clearing it should probably be recorded rather than silent.

## Proposed change

Smallest honest version: a **clear** control on the diver record, beside where the certifications
live, shown only when the stamp is set. It writes `no_certification_declared_at = null` scoped by
`shopId`, gated on the same staff session every card action uses, and appends an activity event so
the correction is not itself invisible.

Two things to decide while doing it, both cheap:

- **Clear, or supersede?** A second nullable column (`no_certification_cleared_at`) keeps the
  provenance the ADR argues for and makes the reader's test one more condition. Simpler is to null it
  and let the activity trail carry the history; the answer was a stranger's typing to begin with.
- **Role.** Capturing a card is open to every staff role, and this is weaker than a capture, so
  crew-wide is consistent. Do not invent a new gate here — H-48 is already the open question about
  who may *sight* a card, and this must not pre-empt it.

**Not** proposed: an expiry on the stamp (a silent unexplained disappearance is worse than a wrong
row), refusing the public write, or any gating.

## Prompt

```text
Give staff a way to clear a wrong "not certified yet" stamp on a diver.

`people.no_certification_declared_at` is written by two unauthenticated public forms (the shop-wide
last-minute-deal join and the per-trip wait-list join), which resolve a person by shop + email. For a
diver the shop holds no card for, anyone who knows that diver's name and email can mark them
permanently as "Not certified yet — diver's word" on the staff send lists and in every CSV export.
The only thing that clears it today is owner-only erasure, which destroys the whole record.

Read first:
  - docs/product/follow-ups/FU-20260815-a-wrong-not-certified-stamp-has-no-eraser.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md — the anti-displacement rule and the
    2026-08-15 amendment, which is what shipped the column
  - src/db/self-declared-cards.ts (recordSelfDeclaredCards, listCertificationSummaries)
  - src/app/shop/[shopSlug]/divers/[personId]/actions.ts — how archiving a card is authorized and
    how its activity event is written

The work: a shop-scoped writer that nulls the column, a staff action beside the certification
controls on the diver record shown only when the stamp is set, an activity event recording the
correction, copy in both locales, and unit tests including the cross-tenant refusal.

Constraints that make this non-obvious:
  - Do not gate anything on the stamp, and do not narrow who may do this by inventing a new role
    predicate — H-48 is the open product-owner question about who may sight a card, and this must
    not pre-empt it. Capturing a card is open to every staff role; this is weaker than a capture.
  - Decide deliberately between nulling the column and adding a `cleared_at` sibling. The ADR argues
    provenance is history for `self_declared_at`; say in the ADR which way you went and why.
  - Every string in src/i18n/locales/, both en-US and es-ES, same change.

Done when: pnpm check is green, the diver record can clear the stamp, the summary stops reporting it,
and docs/product/follow-ups/FU-20260815-a-wrong-not-certified-stamp-has-no-eraser.md is deleted.
```
