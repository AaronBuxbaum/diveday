# H-20261015-aboard-diver-removal-at: May a manager remove a diver marked Aboard from a boat at sea?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Once a boat has left, may anyone remove a diver the crew marked Aboard?** Before this a roster removal had no trip-state gate: one wrong-row tap at the desk took a person on the water off the count, emailed them a cancellation and could refund them (2026-10-15 safety sheet, item 1).

## Minimum outcome to record

Whether a removal at sea is refused or confirmed, and what the correction is.

## Outcome

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, in the "Improvement loop" thread, "Do all recommended decisions and actions in the list"), the recommended option:** no. A diver marked Aboard on a boat that has left cannot be removed by anyone. Remove on that row says why and changes nothing. The first wording sent staff to mark the diver ashore; the review below replaced it.

Built 2026-10-16 (safety build, layer 1): `cancelBooking` refuses in its transaction under the trip and seat locks (`src/db/aboard-at-sea.ts`); the diver's own cancel link and a party lead's cancel keep the seat too, and the diver's page, reply keywords and the party-cancel preview do not offer what they would refuse.

Sharpened the same day by three `dive-domain-expert` reviews (captain and auditor frames, then a re-review). Nothing is held until the boat has **left**: its scheduled time, the rule the blow-out uses (`departureUnderway`); a crew stage past Boarding; or any after-dive roll-call event, diver or crew list, even one since undone, because no after-dive checkpoint is taken at the dock. Once it has left, the seat is held when:

- the crew's roll call puts the person on the water (`onTheWaterByRollCall`): a standing `boarded` at any checkpoint, or a standing "not back aboard" after a dive, on the diver list or, for a staffer who holds a seat, the crew list.
- the departure has sailed (`hasSailed`) and nobody spoke for the seat at the dock. The glossary's **Sailed** counts that seat as carried, because silence is an unfinished dock count, often taps on an offline copy not yet synced. A dock tap undone is silence again. Only the dock's "not boarded" (for a staffer on this crew, the crew list's), or the desk's no-show mark, lets it go.

**After the boat is home the refusal stands.** The seat sailed, and cancelling it would erase that from the record. So the copy no longer says "Mark them ashore first", which could only be followed by writing false marks. Roll-call marks remain for correcting a mistaken tap. The order's refund is the way money goes back. Remove says why in two ways:

- On the water: "{name} sailed on this departure, so the booking stays. To give money back, refund their order."
- Never counted at the dock, which is never called "sailed": "Nobody counted {name} at the dock, so the boat may have carried them. If they didn't come, mark them Not boarded on the manifest, then remove the booking." That removal releases a dive-package dive through the ordinary cancel; an order refund on its own does not.

**The whole-trip Cancel** (`cancelDeparture`) and a run's bulk call-off of off-cadence dates refuse while anybody may be on the water (`departureMayBeAtSea`): the crew took the boat out (a stage past Boarding, or an after-dive event), a seat is held by the rule above, or a crew member stands boarded at the dock once the scheduled time has come or was never marked ashore once the departure has sailed. **A weather scrub at the tied-up dock still works**, with or without a dock count, and so does a late boat still at the dock with nobody counted aboard (re-review default, 2026-10-16). The day's weather call keeps its own stricter rule (ADR 20261009-day-weather-call).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
