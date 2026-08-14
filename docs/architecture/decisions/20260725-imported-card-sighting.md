# 20260725-imported-card-sighting — Make the gate-opening confirm assert a card sighting, and never bend a technical rating onto the recreational ladder

- **Status:** Superseded in part — the card-sighting attestation was dropped on 2026-08-14 by
  [20260814-one-tap-imported-card-confirm](20260814-one-tap-imported-card-confirm.md) (H-24 revised).
  Everything below about **technical ratings** (`TECHNICAL_CERT`, `DISCIPLINE_QUALIFIER`, and the
  rule that a technical or overhead rating imports as nothing) is unchanged and still binding.
- **Date:** 2026-07-25
- **Extends:** [20260725-import-specialty-cards](20260725-import-specialty-cards.md) (its two named
  follow-ups) and [20260724-import-verified-cards](20260724-import-verified-cards.md)'s one-tap
  confirm.

## Context

The `dive-domain-expert` review of the specialty-card import raised two findings that were recorded
as out-of-scope consequences rather than fixed, because one was a product decision and the other a
pre-existing defect. The product owner asked for both, with the instruction *"or just show that it
didn't import and why"* — which is the shape the second fix takes.

**1. The confirm asserted nothing.** H-23 chose "an imported specialty card is verified, but its gate
holds until a staffer confirms it" specifically so a spreadsheet typo could not clear a deep dive. But
`reviewSpecialtyCertification` just stamped `reviewedAt` — no prompt, no claim, no note. The same was
true of the nitrox confirm, which authorizes an enriched-air fill. So the posture's entire value
depended on a staffer working down a "12 to confirm" badge choosing not to tap twelve times. Compare
the paper-waiver path, which has required an explicit medical attestation since it shipped
(`recordInPersonWaiver`).

**2. `normalizeLevel` bent technical ratings onto the ladder.** A bare `/advanced/` rule mapped
anything containing "advanced" to Advanced Open Water — so **TDI Advanced Nitrox**, a
decompression-adjacent gas certification, imported as a *verified Advanced Open Water card* two rungs
above Open Water. Unlike the specialty path, nothing held that one: a ladder card clears its gate on
`status` alone. "Tec 40", "Advanced Trimix", "Full Cave", and "CCR Air Diluent" were all in the same
class, and a certification export is exactly the file that carries them.

## Decision

- **Confirming an imported card requires a card sighting.** `reviewSpecialtyCertification` and
  `reviewNitroxCertification` now take `cardSighted` and refuse with
  `{ ok: false, reason: "card_sighting_required" }` when the card carries `importedAt` and the
  attestation is absent. The claim is fixed text — *"I've seen this diver's card, or checked the number
  with the issuing agency"* — surfaced as a required checkbox behind the **Confirm card** disclosure,
  mirroring the paper waiver's medical attestation, and it is **recorded** in the card's `review_note`
  (`CARD_SIGHTING_NOTE`) so the audit trail says what was asserted rather than that a click happened.
  Both functions now return a discriminated result instead of a nullable row, so a caller cannot
  mistake a refusal for a miss.
- **Scoped to the confirms that open a gate.** Only the imported *specialty* confirm (opens the
  specialty/depth gate) and the imported *nitrox* confirm (authorizes a fill) require it. A card this
  shop captured itself is untouched — **Mark certified** already means a staffer looked the number up
  with the agency, and a second checkbox there would be friction with no claim behind it. An imported
  *level* card's confirm also stays one-tap: it clears a soft nudge, not a gate (that card already
  satisfied readiness on arrival, per 20260724).
- **No bulk confirm, and this is the reason why.** A "confirm all" would be the same unlabelled tap
  this replaces, times twelve. Noted at the component so a later convenience feature has to argue with
  it first.
- **A technical or overhead rating imports as nothing, by name.** `TECHNICAL_CERT` matches trimix,
  helitrox, rebreather/CCR/SCR, cave/cavern/mine, decompression and deco procedures, tec/technical,
  extended range, mixed gas, gas blender, hypoxic/normoxic, sump, DPV, and "advanced nitrox".
  `normalizeLevel` returns null for all of them *before* any rung rule runs, and the row mapper emits
  a distinct warning naming it a technical rating and saying it was not imported — separately from the
  generic "isn't a level we gate on", because this is the case a shop would otherwise assume came
  across.
- **"advanced" is the AOW rung only when it qualifies nothing else.** `AOW`/`OWA` still map directly;
  bare "advanced", "Advanced Open Water", and SSI's "Advanced Adventurer" still resolve; but
  "advanced" alongside a `DISCIPLINE_QUALIFIER` (nitrox, trimix, cave, sidemount, wreck, deco, photo,
  navigation, …) does not. A recreational card that simply isn't a rung — Master Scuba Diver,
  Sidemount, Photography — keeps the ordinary note rather than being called technical, which would be
  wrong about the diver's training.

## Alternatives considered

- **Free-text "how did you check this?" instead of a checkbox** — richer audit, but it makes the
  common case slower and invites "ok" as the note. The fixed claim plus the recorded sighting is the
  boring version that still means something.
- **Require the attestation on every card review, imported or not** — rejected: it would add friction
  to "Mark certified", which already carries that meaning, and diluting a claim by asking for it
  everywhere is how attestations become reflexive.
- **Recognize technical ratings and model them** — out of scope and possibly never worth it; DiveDay
  gates recreational dives. Declining by name is the honest position, and it is what the owner asked
  for ("show that it didn't import and why").
- **Keep `/advanced/` and special-case only "advanced nitrox"** — rejected as whack-a-mole; the
  qualifier test covers Advanced Trimix, Advanced Sidemount, and whatever an agency names next.
- **Map technical ratings to the highest recreational rung they imply** (an Advanced Nitrox diver is
  certainly past Open Water) — rejected outright: it invents a clearance from an inference, which is
  the exact defect being fixed.

## Consequences

Easy: the confirm now means something, and it says what it means at the moment a staffer commits to
it; the audit trail distinguishes "someone tapped this" from "someone saw the card". A technical
certification file no longer quietly manufactures recreational clearances, and the preview tells the
shop which rows to handle by hand.

Hard: confirming an imported card is two interactions instead of one, which a shop migrating hundreds
of divers will feel. That cost is the point — it is per-card precisely because the gate is per-card —
but if it becomes the reason shops leave cards unconfirmed, the answer is a better queue (a review
surface listing every card awaiting a sighting), not a bulk tap.

Escape hatch: drop `cardSighted` from both signatures and the two `card_sighting_required` branches to
return to a one-tap confirm; the UI control and the notice are the only other places to touch. For the
ladder guard, `TECHNICAL_CERT`/`DISCIPLINE_QUALIFIER` are two constants in `src/lib/import.ts` —
loosening either widens what maps to a rung, and both are covered by `normalizeLevel` tests that name
the real agency certifications they stand for.
