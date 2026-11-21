# crew-and-boats

The shop's people on the water and its hulls: who works which day, who is away, the boats and
what is wrong with them.

## Owns

- Crew: `crew-schedule.ts`, `crew-week.ts`, `crew-sheet/`, `crew-away.ts`, `crew-away-diver.ts`,
  `crew-languages.ts`, `staffing/`, `staffing-week/`, `team-settings-page.ts`,
  `invite-suggestions/`, `calendar-sync/` (the staff calendar feed).
- Boats: `boats/`, `boats-page.ts`, `boat-day/`, `boat-snags.ts`, `boat-work/`.

## Does not own

Staff accounts and roles (`accounts`), capacity on a departure (`trips`) and the roll call
(`boarding`).

## Invariants

- A boat is an optional label and `trips.boat_id` reserves nothing; capacity stays on the trip
  (`max_passengers` is the ceiling, `default_capacity` a prefill); a buyout withdraws the sale,
  never locks; a boat migration is expand-only.
- A calendar feed is a read-only iCalendar document at a token-bearing URL, issued, rotated and
  revoked as a `capabilities` purpose (ADR 20260730-calendar-feed-subscriptions).
