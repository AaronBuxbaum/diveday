# H-122: May a manager remove a diver marked Aboard from a boat at sea?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Once a boat has left, may anyone remove a diver the crew marked Aboard?** Before this a roster removal had no trip-state gate: one wrong-row tap at the desk took a person on the water off the count, emailed them a cancellation and could refund them (2026-10-15 safety sheet, item 1).

## Minimum outcome to record

Whether a removal at sea is refused or confirmed, and what the correction is.

## Outcome

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, in the "Improvement loop" thread, "Do all recommended decisions and actions in the list"), the recommended option:** no. A diver marked Aboard on a boat that has left cannot be removed by anyone. Remove on that row says "{name} is marked aboard. Mark them ashore first, or call the captain." and changes nothing. The correction is a recorded act on the manifest (mark ashore, or undo the tap), then remove.

Built 2026-10-16 (safety build, layer 1): `cancelBooking` refuses in its transaction under the trip and seat locks (`src/db/aboard-at-sea.ts`); the diver's own cancel link and a party lead's cancel keep the seat too. "Has left" is past the departure's buffered hour, the crew saying a stage past Boarding, or a count back aboard after a dive. A diver never marked Aboard, or marked ashore, can still be removed.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
