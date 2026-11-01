# H-20261014-ask-to-move: What may a diver past the free-cancellation window do besides cancel?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**What may a diver past the free-cancellation window do besides cancel?** A diver past the window, sick or delayed, saw only the button that cancels and forfeits what they paid. Raised by the fourth UX review (2026-10-14), section 5, decision 5.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** A diver past the free-cancellation window gets "Ask to move", a request that lands in the Inbox against the seat, with the shop's phone; staff decide. Moving a paid seat stays staff-side.

- Built by layer r4-1 (fourth review item 6): `/ready` shows "Can't make this date? Ask {shop} to move you to another one, or call {phone}." above the cancel, with an optional note, only on a paid seat past the window that the diver may still release. The ask is an Inbox row on the `page` channel naming its booking (`inbound_messages.booking_id`), one per booking and departure, never a reply target. Staff move the seat from the roster ([20261013-staff-move-a-seat](../../architecture/decisions/20261013-staff-move-a-seat.md)).

- Approved refinement (#2864): a standing request shows the diver’s note, its sent time in the
  shop’s timezone and a waiting-for-shop state on refresh. The booking stays on its current date
  until staff move it. Answering or deleting the request removes the receipt; a moved, cancelled or
  held seat never presents an old request as pending for a different departure. Staff reply text
  stays private. A form for the old departure is refused if staff move the seat before it is filed.
  Renewing a handled request creates a fresh Inbox identity, preserving the previous message and
  replies. Older Done/Reopen forms and delayed replies cannot clear the new request, even when
  both requests have the same sent time (#2915).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
