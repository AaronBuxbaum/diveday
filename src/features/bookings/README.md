# bookings

How a diver gets a seat and keeps or gives it back: availability, requests, seating, moves,
buddies, the wait list and cancellations.

## Owns

- Seating: `seat-diver.ts` (every staff door that seats a diver), `seat-claims/`, `seat-ladder.ts`,
  `seat-already-held.ts`, `seat-sailed.ts`, `seat-sold-alerts.ts`, `seats-given-up.ts`,
  `party-seat-anchor.ts`, `new-booking-page.ts`, `first-booking.ts`.
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
- Admission is weaker than readiness: nothing here refuses a diver readiness would clear.
- Codes and deals both resolve in `bookSpot`, and Stripe owns the arithmetic.
