# H-79: What does an unconfirmed identity withhold, and what does it cost to confirm?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**What does an unconfirmed identity withhold, and what does it cost to confirm?** Seven issues circle the `identity_unconfirmed` flag: which counter-seating doors raise it (#1790), what it hides on which surface (#1690), what evidence the staffer sees when clearing it (#1789), what happens to money already taken from a package holder (#1697), whether the name-match prompt carries date of birth (#1698), whether a blocked diver can be marked not here (#1702), and the kiosk's guessing budget (#1657).

## Minimum outcome to record

One posture, and the reasoning recorded wherever a surface is left deliberately asymmetric.

## Unblocks / follow-up

**Decided 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): asymmetric — fix the leak and the evidence, leave the search list unflagged.** A staffer who typed a diver's whole name into the search list is performing a deliberate act, not a guess, so that door does not raise the flag; the reasoning goes in the docblock so the next reviewer inherits it instead of re-raising it (#1790). Three things do change. **#1690 ships on its own as a privacy fix**: the boat manifest's roll call still prints a matched person's emergency contact and "Minor · age N" under an unverified name, which the trips roster already stopped doing — the offline manifest payload and the print view are checked in the same change. #1789 carries the matched person's last dive day into the armed confirm block, which widens no disclosure gate: same fact, same person, same staffer, one screen later than the seating prompt already shows it. #1698 adds date of birth to the candidate row. #1697: the fare stands, and the seat's payment control gains a line showing the diver holds unspent package dives so the situation stops arising — refunding counter cash is not a path the code has. #1702: the counter may mark a blocked diver not here, since `noShowGate` deliberately says nothing about readiness. #1657: lower the kiosk budget to what a real morning is worth on the busiest day rather than ten times a twelve-diver boat. #1778's per-IP rate limit on the diver's own stop-the-code door is a straight bug and is keyed on the booking.

Part of the [human decision log](README.md#decision-register).
