# H-20261015-who-may-turn-someone: May any active staff turn someone away at the desk, or managers only?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Who may record "Turned away" on a desk row, with its reason?** Today a refused diver's only door is "Not here", which records "did not arrive" and no reason (2026-10-15 safety sheet, item 6).

## Minimum outcome to record

Which roles may turn someone away, and on which rows.

## Outcome

**Decided 2026-10-16 (Product owner: Aaron Buxbaum, in the "Improvement loop" thread, "Do all recommended decisions and actions in the list"), the recommended option:** any active staff member, on blocked rows only. The reason is taken from the row's own blockers; the blocker category is stored, never the answers.

Built 2026-10-16 (safety build, layer 3): a blocked desk row gets **Turned away**, with one reason from its own blockers (medical, waiver, card, age, identity, payment; `turnAwayReasons`, `src/lib/turn-away.ts`). `turnBookingAway` (`src/db/turn-away.ts`) checks the recorder is active staff, takes the departure and seat locks, re-reads readiness in the same transaction (failing closed), and sets the seat `no_show` with `turned_away_at` and `turned_away_reason`, so every reader that leaves a no-show out leaves it out too. It moves no money, writes no arrival, and puts `booking_turned_away` {actor, diver, reason} on the trail, named by record and booking. Once the boat was due out that line is a seat line on the departure log: "Turned away at the desk: {category}". The desk, roster, Today lookup, manifest pill, offline copy, diver story, activity trail and `bookings.csv` say "turned away"; the diver's own page says the shop released the seat and shows no category. Erasure clears the category and keeps the time.

Defaults taken in two rounds of `dive-domain-expert` and `security-reviewer` review (2026-10-16), also in the glossary's **Turned away**:

- **Arrived divers:** a checked-in diver cannot be turned away from the boat's scheduled start (`sailed`); a booked row keeps the door, inside the arrivals window.
- **Held seats:** only "identity" is offered and accepted, plus "payment" when the seat owes. The trail names the booked-as name, and a split clears the category and keeps the time.
- **No payment:** a turned-away seat cannot be paid. Checkouts take held seats only, and a pending checkout is expired under the seat lock when the seat is turned away or marked not here, so a late completion lands as paid after close.
- **Putting back:** "Put back on the list" undoes it, but only before the scheduled start; after it, a plain no-show keeps its undo and a turned-away seat does not.
- **Moving and removing:** the seat moves to another departure, as booked with its payment and package, only before the source's start. After that the door is Remove, which skips the cancellation window and keeps the record ("turned away, then removed"). The desk's money line names only the door that works.
- **Rail reclaim:** Aboard on a turned-away seat at the departure checkpoint is refused (`boat_full`) when taking it back would overfill the boat. After-dive checkpoints are never refused; a reclaim there that overfills the boat is flagged (`overCapacity`), not refused.
- **Stale readiness:** the waiver, card and payment writers take no lock, so a reason can be a moment stale; the check fails closed.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
