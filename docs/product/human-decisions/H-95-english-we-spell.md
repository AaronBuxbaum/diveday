# H-95: Which English do we spell?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Which English do we spell?** The bundles, the course and site templates and the brand guide had drifted into British spelling a word at a time (37 *cancelled*, 22 *colour*, 10 *grey* in the bundles alone), beside American forms elsewhere.

## Minimum outcome to record

US or UK English for every word a shop or a diver reads.

## Outcome

**Decided 2026-10-06 (Aaron Buxbaum, in session):** “Let’s use American copy style instead of British (for example, color instead of colour) everywhere.” Every English bundle, route metadata block, prose literal under `src/`, the brand guide and the pilot kit are spelled the American way; proper names and another system’s imported words keep theirs. Recorded in [design/brand.md](../../design/brand.md)’s copy rules; `pnpm check:voice` refuses a British spelling (`BRITISH_SPELLINGS` in `scripts/check-voice.mjs`).

## Unblocks / follow-up

Code comments and internal docs are not copy and were not swept.

Part of the [human decision log](README.md#decision-register).
