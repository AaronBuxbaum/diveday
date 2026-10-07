# H-89: Which voice do the public pages speak in?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Which voice do the public pages speak in?** The 2026-09-17 brief (the pages still read as machine-written after the 2026-09-03 word sweep) was answered in [design/voice-strategies-20260917.md](../../design/voice-strategies-20260917.md): a diagnosis (the sweep removed the words and left the shapes: the mirrored pair, the list of three with a tail, the tag sentence, the house phrase reused across pages, one temperature everywhere), six voices each applied to the homepage, and the questions only the owner could answer. Recommended 1, The Letter, with 6, Margin Notes, plus a warmer register on `/about` as the second pick.

## Minimum outcome to record

One number, and where a second register goes. **Decided 2026-09-24 (Aaron Buxbaum, in session): "6, with 4 on the about page"** — Margin Notes on every public page (the product's own screens, annotated by the builder: a note under twenty words naming one visible thing, a reason or a limit, never an evaluation, never a request, and one door into the demo as that role) and Over a Beer on `/about` (spoken: every heading is the owner's question repeated back without a mark, contractions throughout, one joke about the work, facts conceded flat). Recorded in [design/brand.md](../../design/brand.md) as the current voice ("The two registers of the public pages").

## Unblocks / follow-up

Every public page rewritten in the same change; the four shape refusals joined `pnpm check:voice` on the public pages' strings; `e2e/marketing.spec.ts`'s pins and `src/app/about/copy.test.ts` moved with the copy. The owner questions in the strategies doc stay open and nothing was written on his behalf: no town, no date, no name on the homepage, and support still reads "a real person reads it" (H-12/H-26).

Part of the [human decision log](README.md#decision-register).
