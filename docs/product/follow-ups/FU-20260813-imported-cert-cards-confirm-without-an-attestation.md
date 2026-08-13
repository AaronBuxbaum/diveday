# FU-20260813-imported-cert-cards-confirm-without-an-attestation — Level cards confirm on a bare tap; specialty cards do not

- **Status:** Open
- **Raised:** 2026-08-13 — dive-site configurability branch (`claude/dive-site-config-ui-20u5si`),
  while making the two Confirm-card controls look alike
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/readiness.ts`, `src/db/nitrox.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/_components/CertificationCards.tsx`

## What I noticed

Confirming an **imported specialty or nitrox card** requires the staffer to tick a box stating they
have seen the card or checked it with the agency. The domain layer enforces it:
`reviewSpecialtyCertification` and `reviewNitroxCertification` both refuse with
`card_sighting_required` when `importedAt` is set and `cardSighted` is not, and the attestation is
written into `reviewNote` so the trail says what was asserted (H-24, `dive-domain-expert` review).

Confirming an imported **level** card — Open Water, Advanced Open Water, Rescue — does not.
`CertificationCards` renders a bare `SubmitButton` for `needsImportConfirm(card)`, `reviewAction`
never reads `cardSighted`, and `reviewCertification` has no `importedAt` branch at all. So the card
that opens *depth* on every gated boat in the shop is verified by an unlabelled tap on a spreadsheet
cell, while the Deep specialty beside it — which gates the same water — is not.

That asymmetry is invisible on screen. Both rows now render an identical "Confirm card" button in the
same place (that was this branch's change); only one of them asks anything.

## Why it isn't already done

Outside the scope I was given, which was that the two controls *looked* different. Closing the gap is
a safety-posture change on a gated surface — it wants a `dive-domain-expert` review and probably a
`security-reviewer` one, and it changes what an existing staff flow demands, so it is not a drive-by
on a UI branch.

The opposite resolution — dropping the attestation from specialty cards so both are a bare tap — is
available and I do not recommend it: H-24's reasoning applies more strongly to a level card, not
less.

## Proposed change

Give `reviewCertification` the same `importedAt` branch its two siblings have: refuse without
`cardSighted`, record the attestation in `reviewNote`, and return `card_sighting_required` so
`reviewAction` can map it to a notice. Then render `ConfirmImportedCard` (already extracted in
`SpecialtyCards.tsx` — move it to a shared `_components/` file) for a level card that
`needsImportConfirm`, with the disclosure naming what the level authorises rather than what a
specialty does.

Not proposing an attestation on "Mark certified" for a card this shop captured itself: that tap
already means a staffer looked the number up, and H-24 explicitly carves it out.

## Prompt

```text
Read src/db/readiness.ts's `reviewSpecialtyCertification` (the `card_sighting_required` branch and
its long doc comment about H-24), src/db/nitrox.ts's `reviewNitroxCertification`, and
src/app/shop/[shopSlug]/divers/[personId]/_components/{CertificationCards,SpecialtyCards}.tsx. The
gap: an imported *level* card is confirmed by a bare tap, while an imported specialty or nitrox card
requires an explicit "I have seen this card" attestation the domain layer enforces — even though the
level card gates the same depth. Close it: add the same importedAt/cardSighted branch to
`reviewCertification`, record the attestation in `reviewNote`, return `card_sighting_required`, map
it to a notice in `reviewAction`, and render the shared ConfirmImportedCard disclosure on level cards
that need it (extract it out of SpecialtyCards.tsx into a sibling component both import). Write the
disclosure copy for a *level* card — what it authorises is depth and trip admission, not one
specialty. Add a regression test in src/db/readiness.test.ts alongside the specialty one. Get a
dive-domain-expert review before merging. Run pnpm check and e2e/certifications.spec.ts. Delete
docs/product/follow-ups/FU-20260813-imported-cert-cards-confirm-without-an-attestation.md as part of
the change.
```
