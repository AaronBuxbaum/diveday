# H-100: Must a held seat split into a new diver carry an age answer?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Must a held seat split into a new diver carry an age answer?** "Different person" on a held seat creates a new record, and outside a course with a minimum age its date of birth was optional. A record with no date reads as an adult to the minimum-age gate and the guardian co-signature rule (H-08, H-21), and the usual held seat is a minor booked with a parent's email (issue #2143).

## Minimum outcome to record

Whether to require a date at every split, a date or an "18 or older" answer, or nothing.

## Outcome

**Decided 2026-10-07 (Aaron Buxbaum, on the decision card in the project thread): a date or an 18+ tick.** `splitBookingIdentity` refuses (`age_unstated`) unless the staffer gives a date of birth or ticks "They're 18 or older" on any departure; a course with a minimum age still needs the date itself. The tick is filed on the new record with who gave it (`people.adult_attested_at`, `adult_attested_by_person_id`), shown on the diver record's date field, exported, merged as a pair and erased. A date, once on file, is what the age gate and the guardian rule measure, and typing one (or merging onto one) drops the staffer's answer, so clearing that date later cannot bring the adult claim back; with neither, the record reads as an adult, as a blank date does elsewhere.

## Unblocks / follow-up

Whether clearing a date on the diver record should itself ask for a date or the tick (#2167).

Part of the [human decision log](README.md#decision-register).
