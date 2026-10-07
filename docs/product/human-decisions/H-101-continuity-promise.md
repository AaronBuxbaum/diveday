# H-101: May the public pages promise what happens if DiveDay shuts down?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May the public pages promise what happens if DiveDay shuts down?** Vendor death is the first objection a dive shop raises about a new system (market audit 2026-10-07, item 46), and the mechanisms behind an answer already ship: the one-ZIP export, the weekly scheduled backup to storage the shop owns, and Stripe money that never passes through DiveDay. A service promise needs the product owner's word before a page states it ([marketing.md](../marketing.md), claims policy).

## Minimum outcome to record

Whether to publish the sentence, and in what words. **Authorized 2026-10-07 (Aaron Buxbaum, in the project thread): "We can publish that exact promise."** The sentence is "If DiveDay ever shuts down, you get 90 days' notice, your export, and your backups keep running until the last day."

## Unblocks / follow-up

It ships on `/pricing` (the FAQ row "What happens to my shop if DiveDay shuts down?") and on `/about` (the records card), from one shared key (`continuityPromise`, `marketing.export.continuity`), with a Spanish translation; `src/lib/marketing.test.ts` pins it. Any change to the words, or putting it on another page, is a new product-owner decision.

Part of the [human decision log](README.md#decision-register).
