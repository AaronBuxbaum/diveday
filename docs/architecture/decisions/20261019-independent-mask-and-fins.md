# 20261019-independent-mask-and-fins — Rent masks and fins independently

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

A diver may bring a mask and rent fins, or bring fins and rent a mask. One combined choice
charged and prepared both pieces, and hid the difference from the staff preparing the boat.
Independent staff sizing also requires distinct fin and boot answers to survive diver edits
and contact imports. This implements issue #2845.

**Partial supersession:** This decision supersedes only ADR
[20260826-physical-mask-and-fins-register-units](20260826-physical-mask-and-fins-register-units.md)'s
commitment to keep `rental_fit_profiles.mask_fins` and public rental-fit copy unchanged. Its
separate physical-register decision and migration rationale remain accepted.

## Decision

Use separate `mask` and `fins` catalog entries, rental flags, price lines and allocation needs.
Each selected piece reserves only its matching physical unit. A mask has no size question;
fins have their own size. Boots retain a separate size for the wetsuit rental.

Keep the existing cheaper-set pricing rule, with mask and fins as independent core pieces.
The demo prices each at 400 cents, preserving its previous combined 800-cent total; a shop
sets its own prices through the existing rental settings.

All capture paths, completeness checks, recall, packing lists and exports preserve independent
boot and fin sizes. An import never fills an unanswered size from another piece’s cell.

The migration is additive during deployment. The old combined boolean and enum value remain
storage-only while the previous release serves requests, and no new feature uses them.
The runtime fit table now omits the old boolean, while `src/db/migration-schema.ts` retains its
physical definition so unrelated migration generation does not drop it. Once this version has
deployed, remove the migration-only definition and the enum value in a later release.

## Alternatives considered

- **Split only the controls:** would still charge or allocate an unwanted piece.
- **Keep one shared boot/fin size:** loses valid distinct answers when fins use letter sizes.
- **Drop the combined storage immediately:** breaks the previous release during deployment.

## Consequences

A diver can request and pay for exactly the gear they need. Every rental consumer now names
mask and fins separately; tests pin independent quotes, demand, allocation, sizing and import.
Revisit if a shop needs a separately priced mask-and-fins package; that would be a pricing bundle
above these independent physical pieces, requiring quote changes rather than merging fit data.
