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
- **Rows already over the limit keep working.** They sail and their manifest says so, the fleet row says so in danger ink, and the next save of the row must fix it.
- Capacity and the certificate count the same people: everyone aboard who is not crew (`boatSafetyNotices` counts passengers crew excluded), so they compare directly.

Built in `boatSeatsRefusal` (`src/lib/boat-safety.ts`) and `tripDetailsPatch` (`src/lib/trip-details.ts`); recorded as an amendment on [20260804-boat-resource-model](../../architecture/decisions/20260804-boat-resource-model.md).

## Unblocks / follow-up

Nothing in the booking transaction reads the certificate: it holds to the departure's own `capacity`, which every door above now keeps at or under the certificate.

Part of the [human decision log](README.md#decision-register).
