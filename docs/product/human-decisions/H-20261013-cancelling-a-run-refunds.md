# H-20261013-cancelling-a-run-refunds: Does cancelling every upcoming date of a run refund each seat in full?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**When staff press "Cancel every upcoming date" on a repeating trip, does each paid seat go back in full, or under each date's own cancellation window?** The first decision text said "refund under each date's window"; the build reused the blow-out cascade, which refunds in full.

## Minimum outcome to record

Full refund or window refund for a shop-called run.

## Outcome

**Chosen and implemented (Aaron Buxbaum, 2026-10-13, on issue #2452):** every date is refunded in full. A diver whose date the shop removed is owed their money, the same as for a weather call or a minimum-head-count cancellation (ADR 20260813-shop-cancellation-refunds-itself). A cancellation window answers "may this diver cancel free?", which a diver who did nothing is never asked. The shop absorbs the card fees.

`cancelFutureSeriesTrips` (`src/db/trips-series.ts`) sends each date through `callDayBlowout` with cause `run_ended`, and `src/db/trips-series.test.ts` pins the full refund.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
