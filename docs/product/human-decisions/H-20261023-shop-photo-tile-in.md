# H-20261023-shop-photo-tile-in: May visual captures show a plain tile where a shop photo goes?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**The storefront's photo strip kept reporting "changed" with the same photos on both sides**
(#2937: ten captures on one PR, decode and resample noise), after three earlier fixes to the same
class. Each one costs a reviewer an explanation. Replacing the photos with one plain tile in every
capture ends it, at the price of visual review never showing the real photos. The 2026-10-23 code
sheet (item 8, call 5) asked whether that is acceptable.

## Decision

**Decided 2026-10-23 (Aaron, in the project thread: "Yes").** Visual captures show one fixed tile
wherever a shop photo goes. The photos are seed stock, and the layout around them is what review
checks. One non-visual test keeps proving the real photos load, at a size and with their alt
attribute.

## What ships

`tileShopPhotos` in `e2e/visual-harness.ts` answers every request for the demo shop's strip photos
in a capture with one flat tile; `e2e/storefront-brand.spec.ts` checks the real ones load.

## Unblocks / follow-up

Closes #2937.

Part of the [human decision log](README.md#decision-register).
