# H-107: Does the boat's certificate passenger limit refuse seats, or only inform?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**May DiveDay refuse to sell a seat above a boat's certificate passenger limit?** Until now `boats.certified_passengers` only informed: the fleet row said "14 seats on sale; the certificate allows 12", and the manifest carried a danger line once the people booked passed it. The one capacity block was a departure's seats against the boat's own `capacity` (ADR 20260804-boat-resource-model).

## Minimum outcome to record

Whether the certificate refuses; which saves it refuses; and what happens to a boat or departure already over it.

## Outcome

**Decided 2026-10-09 (Aaron Buxbaum, approved in the project thread):** the certificate refuses. It reverses "informs, never gates" for this one fact; the papers and the safety kit still only inform.

- Saving a boat whose seats on sale are above its certificate is refused with a field error on that row, and so is lowering the certificate under the seats.
- Lowering the certificate under the seats an upcoming departure on that boat still sells is refused the same way, naming how many departures.
- Adding a departure in the schedule builder and editing one refuse seats above the assigned boat's certificate, beside the existing refusal above the boat's own capacity.
- **Rows already over the limit keep their row, never their extra seats.** They sail and their manifest says so, the fleet row says so in danger ink, and the next save of the row must fix it — but the seats above the certificate are never sold.
- **The point of sale is the ceiling.** The booking transaction sells at most the lower of the departure's `capacity` and its boat's certificate, read under the trip-row lock (`sellableCapacity`, `src/db/trips-queries.ts`); a roster undo, a no-show undo and the wait list measure the same number. A copied departure and every date a series rolls forward start at the certificate, and "apply to the rest of the series" skips a date on a hull certified for fewer.
- Capacity and the certificate count the same people: everyone aboard who is not crew (`boatSafetyNotices` counts passengers crew excluded), so they compare directly.

Built in `boatSeatsRefusal` and `sellableSeats` (`src/lib/boat-safety.ts`), `tripDetailsPatch` (`src/lib/trip-details.ts`) and `sellableCapacity` (`src/db/trips-queries.ts`); recorded as an amendment on [20260804-boat-resource-model](../../architecture/decisions/20260804-boat-resource-model.md).

## Unblocks / follow-up

The booking transaction reads the certificate: every seat-granting door lands on `createBookingRecord`, `restoreBooking` or `undoBookingNoShow`, and each caps the departure's `capacity` at the certificate under the trip-row lock, so a departure that still states more — written before H-107, copied, rolled, reinstated, or moved to a smaller hull — sells only up to the certificate. A total-persons limit (crew included) is not built.

Part of the [human decision log](README.md#decision-register).
