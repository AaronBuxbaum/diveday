# bookings

How a diver gets a seat and keeps or gives it back: availability, requests, seating, moves,
buddies, the wait list and cancellations.

## Owns

- Seating: `seat-diver.ts` (every staff door that seats a diver), `seat-confirmation-text.ts`
  (the ready link by text to a seated diver with a phone), `paste-list/` (a trip's passenger list
  pasted onto one departure, each person their own seat), `seat-claims/`, `seat-ladder.ts`,
  `seat-already-held.ts`, `seat-sailed.ts`, `seat-sold-alerts.ts`, `seats-given-up.ts`,
  `party-seat-anchor.ts`, `party-reached.ts` (who a just-seated party's links reached, carried to
  its waivers landing), `new-booking-page.ts`, `first-booking.ts`.
- What is open: `availability/`, `open-seats/`, `worth-a-look.ts`, `your-days.ts`.
- Requests and quotes: `booking-request.ts`, `requests-page/`, `request-advisor.ts`, `charter-quote.ts`.
- Moves and cancellations: `move-offer.ts`, `move-preflight/`, `move-ask-alerts.ts`,
  `sailed-rebooking.ts`, `self-cancel-settle.ts`, `booking-cancelled-notice.ts`, `booking-handoff/`.
- Buddies and the wait list: `buddy-links.ts`, `buddy-referrals.ts`, `buddy-tokens.ts`,
  `interest-replies.ts`, `interest-reply.ts`, `interest-roll.ts`, `find-my-booking.ts`.

## Does not own

The booking transaction and capacity (`src/db/bookings.ts`), admission (`src/lib/trip-admission.ts`),
payment for the seat (`money`) and the trip itself (`trips`).

## Invariants

- A cancelled or past trip accepts no booking.
- Every staff door that seats a diver goes through `seatDiver`.
- A staff-seated diver hears about the seat on every contact on file (email, and a text when
  their number can take one), once, never retried; `reached` says which.
- A pasted list seats each person on a booking of their own; a name on file never stops the
  list, and a record is chosen only from what that row's preview offered.
- Admission is weaker than readiness: nothing here refuses a diver readiness would clear.
- Codes and deals both resolve in `bookSpot`, and Stripe owns the arithmetic.
