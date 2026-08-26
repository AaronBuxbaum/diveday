# 20260826-physical-mask-and-fins-register-units — Keep the combined fit answer, split the register units

- **Status:** Accepted
- **Date:** 2026-08-26
- **Issue:** [#953](https://github.com/aaronwittman/diveday/issues/953)

## Context

Rental fit intentionally asks one question for a diver's mask and fins. The gear register tracks
physical units, however, and a shop may have a serial-numbered mask and fins that are not the same
thing. Treating the legacy `mask_fins` register row as one unit meant reserving either half made the
prep row look complete and left staff unable to assign the other half.

## Decision

Keep `rental_fit_profiles.mask_fins` and the public rental-fit copy unchanged. In the register,
`gear_item_kind` has separate `mask` and `fins` values. `gearAssignmentNeeds` bridges one combined
fit answer into two independent physical demands: an unsized mask and fins carrying the diver's fin
size. Prep removes each demand only when that physical kind has its own reservation.

The migration preserves every legacy combined row as fins, retaining its label, size, serial number,
brand, service history, and reservations, then creates a mask companion row. The serial number stays
on fins because the old row did not say which half it identified; staff can edit the companion
record when the physical labels are known. Register-only vocabulary remains separate from rental
catalog and pricing vocabulary.

## Alternatives considered

- **Split the public rental fit question into separate mask and fins questions** — rejected because
  the combined prompt reduces checkout friction and divers typically select or decline the package
  together.
- **Keep `mask_fins` as a single register kind with partial allocation flags** — rejected because
  masks and fins have independent physical lifecycles, service histories, serial numbers, and counts.
- **Require paired mask-and-fins gear sets in inventory** — rejected because dive shops frequently
  replace, size, or service masks and fins independently.

## Consequences

- Existing fit answers, rental prices, and public copy do not change.
- A mask and fins can be reserved, returned, serviced, and searched independently.
- Existing combined rows gain a companion mask row through an explicitly acknowledged pre-pilot
  data migration; no reservation is discarded.
- A shop with only one half registered sees only that half as a prep need, preserving the
  presence-based register behavior.

