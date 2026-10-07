# H-93: How do the public pages sell?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**How do the public pages sell?** The owner's 2026-10-05 brief: “we’re not really selling very well; we want to do a good job of listing and explaining all of our interesting features, selling it well on their pages… we can add more pages, update, change the approach, anything you like.” The diagnosis posted in that thread: the headlines described the page rather than what a shop gets (“Four screens from a dive shop’s day, with notes from the person who made them”), H-89’s notes-only voice ruled out saying why anything matters, and most features sat in a collapsed list on `/product` with no page of their own.

## Minimum outcome to record

The voice, the page inventory, and where the demo opens.

## Outcome

**Decided 2026-10-05 (Aaron Buxbaum, in session):** the brief handed over the approach in as many words, and the plan was posted in its thread before the build. Every section leads with what the shop gets, then the screen as proof, then a demo door that opens on that screen; the builder’s notes stay as the screen’s captions; `/about` keeps the spoken register. Twelve feature pages under `/product/<feature>` (`src/lib/feature-pages.ts`), each with a headline about the result, the real screen, how it works, everything it includes, what it does not do and the questions shops ask, its demo door landing on its own screen; `/product` becomes the hub that links them, and the homepage follows one booking to the boat. Amends H-89 on every public page but `/about`. Recorded in [design/brand.md](../../design/brand.md) (“The two registers of the public pages”) and [marketing.md](../marketing.md).

## Unblocks / follow-up

Shipped as one stack, merged 2026-10-05: the feature pages (#2103), then the homepage, the hub, pricing and `/about` (#2109). The Spanish manifest word was settled on the way (#1957, `es-ES/README.md`).

Part of the [human decision log](README.md#decision-register).
