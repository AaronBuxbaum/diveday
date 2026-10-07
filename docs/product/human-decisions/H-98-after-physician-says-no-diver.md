# H-98: After a physician says no, does the diver need a physician to clear their…

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**After a physician says no, does the diver need a physician to clear their next waiver?** "Send a new waiver" (PR #2159) gave a refused diver a fresh release, and shipped the stricter rule the dive-domain review asked for: the next release parked for a physician whatever it answered, and paper was refused (issue #2158).

## Minimum outcome to record

Whether a clean new release clears the diver on its own.

## Outcome

**Decided 2026-10-07 (Aaron Buxbaum, in the project thread):** “we should allow a waiver without, but show a warning that a previous waiver had a physician say no (with link)”. A clean new release clears the diver without a second physician. The refusal stays on file and keeps outranking every older signature, and every surface that shows the new release says a physician did not clear this diver, with a link to the refused record on the roster and the diver record (`overriddenRefusal` in `src/lib/waivers.ts`). The warning ends only when a physician has since cleared a release covering every question the refused one flagged. Any staffer may record a paper waiver after a refusal: the dive-domain review asked for owner-or-manager only, and Aaron chose “Any staff” on the decision card (2026-10-07).

## Unblocks / follow-up

The offline manifest carries no medical warnings yet (#2163).

Part of the [human decision log](README.md#decision-register).
