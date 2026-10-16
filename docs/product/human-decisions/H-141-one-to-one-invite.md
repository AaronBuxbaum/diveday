# H-141: May staff invite one past diver to a named departure?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May staff invite one past diver to a named departure?** Inviting a past diver back reads as marketing, which [H-09](H-09-channel-sends-booking-waiver-notifications.md) holds. Raised by the fifth-loop ideas, decision 4.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** A one-to-one invite to a past diver, sent by staff for a named departure, is service mail allowed now: one at a time, staff-chosen, a named date, the 30-day throttle. Extends H-09; the general marketing question stays with H-09.

## Unblocks / follow-up

Built by layer r5-6: a departure's Invite section suggests up to six past divers of its site
(sailed here, opted in, an email on file, not contacted with an invite in 30 days), each with its own
Invite; the course page's "Next steps" ladder invites one diver at a time to the next course's
soonest session. Both send the existing direct trip invitation, with its unsubscribe, and both refuse
a diver invited inside the 30 days on the server (`src/lib/invite-suggestions.ts`,
`src/db/invite-suggestions.ts`).

Part of the [human decision log](README.md#decision-register).
