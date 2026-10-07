# H-78: Does the rental fit describe the shop's stock, or the diver's body?

- **Status:** Chosen
- **Human owner:** Product owner + dive operations lead

## Decision or approval needed

**Does the rental fit describe the shop's stock, or the diver's body?** `rentsDrysuit` means "renting a drysuit from us" and three safety signals use it as a proxy for "will be in a drysuit" — `drysuitWeightCheck` and `drysuitFinFit` in `src/lib/dive-prep.ts` and `checkDrysuitCard` in `src/lib/drysuit-card.ts`. Most drysuit divers own their suit, so a diver in their own dry shell has `rentsDrysuit === false` and gets a wetsuit-derived `weightPreference` printed on the packing list and the manifest rail as a number to pack to. The glossary names under-weighting as the dangerous direction for a drysuit. Raised independently by three `dive-domain-expert` reviews reaching the same conclusion from three files, and filed as issues #1752, #1810, #1800, #1811, #1792 and #1816.

## Minimum outcome to record

Which of three shapes: a diver-level fact, a per-booking answer, or keeping the catalog proxy with the known-wrong case written down.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): give the fit an exposure-suit fact of its own.** The signals key on what the diver wears, not on what the shop hands over, which is the only answer that makes the ambiguity go away rather than picking a side. The accepted cost is the diver who dives dry in winter and wet in summer, whose standing answer will sometimes be wrong for one trip. #1752 is the root and carries the fact; #1810 re-keys the weight check; #1800 holds wetsuit/drysuit exclusivity in the writer rather than on the four forms; #1811 moves the "shop no longer rents this" suppression into `rentalFitLine` so a booking that already holds the piece is not told otherwise; #1792 builds the visibility half (a count of divers holding a fit for a dropped piece) rather than the clearing half, because a fit is the diver's answer and not the shop's to erase. **#1816 (hood and glove sizes) is NOT unblocked by this** — its sizing shape waits on H-76(c), because if the diver's form stops asking for a size letter then free text per kind is the wrong shape for hoods and gloves too.

Part of the [human decision log](README.md#decision-register).
