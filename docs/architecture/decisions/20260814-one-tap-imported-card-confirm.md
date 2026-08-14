# 20260814-one-tap-imported-card-confirm — Every imported card confirms the same way, and that way is one tap

- **Status:** Accepted
- **Date:** 2026-08-14
- **Amends:** [20260725-imported-card-sighting](20260725-imported-card-sighting.md) — its first
  decision only. The technical-rating half of that ADR (`TECHNICAL_CERT` / `DISCIPLINE_QUALIFIER`,
  and the rule that a technical or overhead rating imports as nothing) is untouched and still
  binding.
- **Owner decision:** H-24, revised 2026-08-14.

## Context

DiveDay had two different answers to one question, and nothing on screen said so.

Confirming an imported **specialty** or **nitrox** card required a staffer to tick an attestation —
*"I've seen this diver's card, or checked the number with the issuing agency"* — enforced in the
domain layer (`card_sighting_required`) and recorded into the card's `review_note`. Confirming an
imported **level** card — Open Water, Advanced Open Water, Rescue — was a bare, unlabelled tap.

The asymmetry does not survive being stated out loud: the level card is what opens *depth* on every
gated boat in the shop, and the Deep specialty beside it gates the same water. One asked; the other
did not. Both rendered an identical "Confirm card" button in the same place, so a staffer could not
tell which was which until they clicked.

Filed as `FU-20260813-imported-cert-cards-confirm-without-an-attestation`, which recommended closing
the gap upward — put the attestation on level cards too. The product owner chose the other direction.

## Decision

**Both confirms become one tap.** `reviewSpecialtyCertification` and `reviewNitroxCertification` lose
the `cardSighted` parameter and the `card_sighting_required` refusal; the checkbox disclosure
(`ConfirmImportedCard`) is gone, replaced by the single label-switching button the level card has
always used; and no sentence is written into `review_note` on the shop's behalf.

What is emphatically **not** dropped is the gate itself. H-23's posture stands: an imported specialty
card is `verified` but does not clear its gate until a staffer confirms it, per card, by hand, and an
imported nitrox card does not authorize a fill until the same. `needsImportConfirm` still holds the
blocker, there is still no bulk confirm, and the readiness tests that prove the gate stays shut
before the tap are unchanged. What was removed is the *second* statement of why, not the human act.

The reasoning for the reversal is consistency plus cost. The attestation's value always rested on a
staffer reading a sentence they had ticked a hundred times before, and 20260725's own Consequences
section named the risk: *"if it becomes the reason shops leave cards unconfirmed, the answer is a
better queue, not a bulk tap."* An unconfirmed card is a shut gate, so the failure mode of friction
here is not a false clearance — it is a shop that stops migrating and keeps its cards somewhere else.
Against that, a uniform one-tap confirm is what a staffer can actually learn.

Two consequences are accepted deliberately, and neither should be discovered later as a surprise:

- **The audit trail no longer distinguishes "someone saw the card" from "someone tapped".** It keeps
  `reviewed_at` and the reviewing session, which is who and when, but not what was asserted.
- **Rows written before today keep their `CARD_SIGHTING_NOTE` sentence.** They are not rewritten.
  That note records what a staffer asserted at the time under the policy then in force, and
  back-dating an audit trail to match a later policy is the one thing it must never do.

## Alternatives considered

**Put the attestation on level cards too** — the follow-up's own recommendation, and the direction
H-24's `dive-domain-expert` reasoning points. Rejected by the product owner in favour of speed at the
counter. Recorded here rather than argued: this ADR exists so the next session finds a decision
instead of an inconsistency, and finds the case for the other direction with it.

**Keep the asymmetry and label it** — a specialty card that asks and a level card that does not,
with the difference explained on screen. Rejected: it makes a staffer read an explanation of an
inconsistency instead of removing it, and no wording makes "this one gates depth, and so does that
one, but only this one asks" sound deliberate.

**Attestation only above Open Water** — bare tap for the entry-level card, attestation for
Advanced/Rescue and every specialty. Rejected as the same rule with a harder boundary to state.

## Consequences

Easy: one control, one shape, one thing to learn; a shop migrating hundreds of divers confirms them
at the speed the queue was designed for; and `ReviewRefusal` collapses to `not_found` while the
discriminated result stays, so a refusal is still never mistakable for a miss.

Hard: this is a genuine loosening of a safety posture on a gated surface, made against the standing
`dive-domain-expert` recommendation recorded in H-24. It was not reviewed by that agent before merge
(the session could not spawn one). If a shop is ever found confirming imported cards in bulk without
looking at them, the evidence will no longer be in the row, and the honest fix is the queue 20260725
named — a surface listing every card awaiting a sighting — rather than restoring a checkbox.

Escape hatch: 20260725's own reversal instructions run in this direction too. Restoring the
attestation means re-adding `cardSighted` to both signatures, the two `importedAt` refusal branches,
`CARD_SIGHTING_NOTE`/`reviewNoteFor`'s second argument, the disclosure component, and one notice code
(`card-sighting-required`) with its copy in both locales.
