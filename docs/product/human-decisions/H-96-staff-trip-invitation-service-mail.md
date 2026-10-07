# H-96: Is a staff trip invitation service mail or commercial mail?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Is a staff trip invitation service mail or commercial mail?** Staff invite one diver to one departure in two ways: answering a diver who asked the shop for a date, and inviting a diver already on the shop's records who asked for nothing (`createDirectTripInvitationAction`). Both went out as one `trip_invitation` kind with no unsubscribe and no postal footer, the one message a reader of the SES case could take for undisclosed marketing (issue #1953).

## Minimum outcome to record

Service or commercial, and whether the answer is the same for both senders.

## Outcome

**Decided 2026-10-06 (Aaron Buxbaum, in the project thread): option (b), split by sender.** A reply to a diver's own date request stays service mail (`trip_invitation`): the diver asked, so it carries no unsubscribe and still reaches someone who turned off courtesy email. A cold invitation staff send is commercial mail (`direct_trip_invitation`): it carries the one-click courtesy unsubscribe and the shop's postal footer, and it is not sent to a diver whose `people.courtesy_email_opt_out_at` is set; the staffer is told the invitation was recorded but not emailed. The opt-out is the existing courtesy-email switch, so no new column. Recorded in ADR [20260902-sender-standards-for-ses](../../architecture/decisions/20260902-sender-standards-for-ses.md)'s 2026-10-06 amendment, which now names the test for commercial mail rather than the field.

## Unblocks / follow-up

The courtesy unsubscribe line now reads "Stop optional emails from {shop}" on every courtesy kind.

Part of the [human decision log](README.md#decision-register).
