# H-159: How does "Record payment" at the counter record cash or the card machine?

- **Status:** Implemented
- **Human owner:** Aaron Buxbaum

## Decision or approval needed

**One tap on Cash or Card machine booked an open order's whole balance as paid**, with no confirm and no undo (visual review 2026-10-24, finding A47; issue #3030). A staffer who tapped the wrong order on a phone had recorded money that never changed hands, and the only way back was a refund flow built for real money. The options were (a) keep the one-tap shortcut, (b) a sheet with the amount, the method and the recorder, or (c) one tap with an eight-second Undo hold, as the sends have (H-68).

## Decision

**Decided 2026-10-25 (Aaron Buxbaum, on the decision card in the visual review thread): one tap with an eight-second Undo hold (H-68).** Option (c).

## What ships

Cash and Card machine stay one tap. The tap holds the payment on the server for eight seconds (a `held_sends` row of kind `counter_payment`, the send hold of ADR 20260906-before-you-ask), and the row reads "Recording $340.00 cash" with Undo where the buttons stood. Undo deletes the hold: the order is untouched and nothing is recorded or logged. When the hold runs out the payment is recorded through the same writers as before, with the activity line naming who tapped it. Navigating away inside the hold commits it: the page tells the server as it goes (closed, hidden, or a navigation inside the app) and the payment is recorded then; the hourly sweep is only the fallback for a screen that could not say so. Every path records the tap's own time as the payment's time. An Undo the hold outran says "Too late to undo" with what was recorded. A hold that finds the order no longer open records nothing and says so in the shop's log. A reload inside the hold shows it still draining. A second tap on the same order inside the hold is the same hold, so the order is paid once. The room charge, which asks for a room, keeps its form and confirm.

## Unblocks / follow-up

Closes #3030.

Part of the [human decision log](README.md#decision-register).
