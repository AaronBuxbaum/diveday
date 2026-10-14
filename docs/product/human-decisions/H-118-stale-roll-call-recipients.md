# H-118: Who hears when an after-dive roll call is left open?

- **Status:** Ready
- **Human owner:** Product owner

## Decision or approval needed

**When an after-dive roll call is still open after the boat was due back (batch 6, item 6; the hourly pass asks from 30 minutes past the end, and a count nobody started opens an hour past it), DiveDay tells someone ashore.** The brief asked for the owner and the shop's shore/emergency contact. The shore contact on the emergency reference (`emergencyReference.shoreContact`) is free text — a name and a number written for a person to read in an emergency — with no address DiveDay can send to and no consent to receive messages, so nothing is sent to it.

## What shipped, as the recommended default

- **Every active owner gets one email** naming the departure, the dive and how many people have no result, with a link to that roll call.
- **Every device following the departure's manifest gets one push**, in its owner's language.
- **Once per departure** (`trips.roll_call_alerted_at`); the Today row says when the owners were alerted. A pass that reaches nobody releases the claim and tries again next hour.
- It rides the hourly crew-notices pass, so it arrives between 60 and 96 minutes after the end for a count nobody started (the roll-call gap's own one-hour return buffer), and 30 to 90 minutes after for one started and left open.
- Never for a rehearsal, a canceled departure or a demo shop.

## Minimum outcome to record

Whether the shore contact should become a structured, consented recipient (a phone number or address with an opt-in), and if so by text, email or both; whether managers should hear as well as owners; whether 30 minutes is right.

## Recommendation

Keep owners only until a shop asks. A structured shore contact is a settings field, a consent line and one more recipient in `sendStaleRollCallAlerts` (`src/db/roll-call-alerts.ts`).

## Unblocks / follow-up

Nothing waits on it: the owner alert is live. The window is `STALE_ROLL_CALL_AFTER_MS` in `src/lib/roll-call-alerts.ts`.
