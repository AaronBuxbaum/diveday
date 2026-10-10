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

The offline manifest carries the warning too, as the physician's evaluation day and nothing else of the record (#2163). The live and offline roll calls both put it on the row as a capsule, ahead of an unresolved-referral capsule.

## Amendment 2026-10-09: an unresolved referral (issue #2195)

**Decided 2026-10-09 (Aaron Buxbaum, on the issue):** a later clean waiver may also stand over a referral that no physician has answered yet, the same way it stands over a physician's "no". The diver is cleared, and every surface that warns about an earlier refusal warns about the open referral too, with a link back to it: the diver record, the trip's Divers tab and the live manifest (`overriddenReferral` in `src/lib/waivers.ts`). `effectiveWaiverForBooking` is unchanged, so a booking whose own release is the unresolved hold still waits for a physician. The recommended alternatives (block until a physician clears it, or let staff retire a referral as answered in error) were not taken. The offline manifest and paper print the warning with its date and no link.

Part of the [human decision log](README.md#decision-register).
