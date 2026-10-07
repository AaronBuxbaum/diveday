# H-84: What may DiveDay assert about a dive it cannot model?

- **Status:** Chosen
- **Human owner:** Product owner + dive operations lead

## Decision or approval needed

**What may DiveDay assert about a dive it cannot model?** Nothing in the schema can express "this departure was a decompression dive" — `flySafeFrom` says so in its own docstring — and the code computes the ordinary 18-or-24-hour figure anyway and hands it to the diver in a sentence carrying **DAN's name**, for a dive DAN declines to give a number for. Filed as #1555. Beside it, #1694 found four readers answering "did this person dive with us" two different ways, one of them the fly-safe advisory, and #1686 found the multi-day read ignoring `roll_call_events` entirely — the stronger of the two records, since a crew member counting somebody onto the boat outranks a desk tap.

## Minimum outcome to record

Whether a trip-level decompression flag exists at all, and what the recap says when it is set.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): add the flag, and refuse to answer for it.** A trips-level "exceeds no-decompression limits" flag, defaulting to no so a shop that never sets it is unaffected; when set, `flySafeFrom` returns null and the recap says nothing about flying at all — the conservative reading, and the same thing the module already does while the boat is at sea. Refusing beats a different sentence, because a shop that never maintains the flag then keeps a number rather than a wrong attribution. #1694 extracts the four clauses into one exported predicate, counting both escapes: a day the desk saw the diver on, and a day the crew logged dives on after a blow-out, are dive days — the same evidence the fly-safe advisory already trusts with a decompression margin. **#1686's proposed shape is stale** and its body is rewritten before the work starts: the `no_show` escape it wanted to widen was deleted by a `dive-domain-expert` review, and the roll-call index prefix has to be checked first or the ticket becomes a migration. This row puts `src/lib/fly-safe.ts` back in front of the owner, so **H-75's deferral is re-openable rather than settled**.

Part of the [human decision log](README.md#decision-register).
