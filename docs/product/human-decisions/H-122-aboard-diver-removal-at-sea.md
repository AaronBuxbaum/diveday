# H-122: May a manager remove a diver marked Aboard from a boat at sea?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Once a boat has left, may anyone remove a diver the crew marked Aboard?** Before this a roster removal had no trip-state gate: one wrong-row tap at the desk took a person on the water off the count, emailed them a cancellation and could refund them (2026-10-15 safety sheet, item 1).

## Minimum outcome to record

Whether a removal at sea is refused or confirmed, and what the correction is.

## Outcome

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, in the "Improvement loop" thread, "Do all recommended decisions and actions in the list"), the recommended option:** no. A diver marked Aboard on a boat that has left cannot be removed by anyone. Remove on that row says why and changes nothing. The first wording sent staff to mark the diver ashore; the review below replaced it.

Built 2026-10-16 (safety build, layer 1): `cancelBooking` refuses in its transaction under the trip and seat locks (`src/db/aboard-at-sea.ts`); the diver's own cancel link and a party lead's cancel keep the seat too, and the diver's page, reply keywords and the party-cancel preview do not offer what they would refuse.

Sharpened the same day by two `dive-domain-expert` reviews (captain and auditor frames). The seat is held when:

- the crew's roll call puts the person on the water (`onTheWaterByRollCall`): any standing after-dive result, `boarded` or "not back aboard", whatever the dock said, or a dock `boarded` once the boat has left. It has left from its scheduled time, the rule the blow-out uses (`departureUnderway`), or once the crew say a stage past Boarding.
- the departure has sailed (`hasSailed`) and nobody spoke for the seat. The glossary's **Sailed** counts that seat as carried, because silence is an unfinished dock count, often taps on an offline copy not yet synced. Only the dock's "not boarded", a dock tap undone, or the desk's no-show mark lets it go.

**After the boat is home the refusal stands.** The seat sailed, and cancelling it would erase that from the record. So the copy no longer says "Mark them ashore first", which could only be followed by writing false marks. Remove says "{name} sailed on this departure, so the booking stays. To give money back, refund their order." Roll-call marks remain for correcting a mistaken tap. The order's refund is the way money goes back.

The whole-trip Cancel is held to the same rule as the blow-out: it refuses while the boat may be on the water (`cancelDeparture`).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
