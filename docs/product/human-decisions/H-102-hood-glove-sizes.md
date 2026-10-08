# H-102: Does a hood and glove size belong in the rental fit, and is `hood_gloves` one kind?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Does a hood and glove size belong in the rental fit, and is `hood_gloves` one kind?** Hoods rack S/M/L/XL and 3/5/7 mm, gloves S–XL, and DiveDay held no size for either; one checkbox could not say "gloves, no hood" (warm water) or "both, different thicknesses" (quarry) (issue #1816, from #1805's `dive-domain-expert` review).

## Minimum outcome to record

Whether to hold a size, in what shape, and whether to split the kind.

## Outcome

**Decided 2026-10-07 (Aaron Buxbaum, in the project thread): split it, and give each a size.** `rents_hood` and `rents_gloves` replace `rents_hood_gloves`, with `hood_size` and `glove_size` beside them. Each size is **free text on both fit forms**, like the staff side's drysuit box, because a hood needs two axes and no closed grid has an owner; it reaches the packing list verbatim. Both are sized kinds now: completeness asks for them, the register's hood and glove units meet their own columns, and the evening "keep it" can name them. No backfill (H-49): a fit or a catalog that said `hood_gloves` reads as neither. The old column stays in the schema, unread and unwritten, for one deploy, and the next migration drops it.

## Unblocks / follow-up

Drop the unused `rental_fit_profiles.rents_hood_gloves` column (#2184).

Part of the [human decision log](README.md#decision-register).
