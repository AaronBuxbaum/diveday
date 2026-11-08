# today

The shop home's work queue ("Needs you"), its day spine, the departures board on it, and the
evening close-out. Today reads every other module: readiness, roll call, crew, gear, payments,
messages, reviews, the forecast. That is why it sits above them as a feature instead of in
`src/db` and `src/lib`.

Decision records: [20260720-today-work-queue](../../../docs/architecture/decisions/20260720-today-work-queue.md),
[20260804-day-closeout](../../../docs/architecture/decisions/20260804-day-closeout.md).
Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).

## Owns

- `today-reader.ts`: the queue's reads (`getTodayWork`, the departures, the blocked-diver badge),
  and the `today-*-rows.ts` siblings that each push one family of rows.
- `today.ts`: the framework-free half. It ranks the evidence into actions and states what each
  row is; it never queries.
- `closeout-reader.ts` and `closeout.ts`: the evening's reads and the day's closing state.
- `past-day-notes.ts`: what a past day's page says about its stations.
- `shop-home.ts`: the shop home's surface reader (`getShopHome`), its waves of reads in one call,
  and `day-money.ts`, the evening's takings and the reader's crew tips behind it.
- `day-print-page.ts`: the day's print packet reader (`getDayPrintPage`): its departures and load-out.

## Does not own

These sit below Today because a substrate module needs them, and nothing in `src/db` or `src/lib`
may import a feature:

- **Which head counts are open**: `src/features/roll-call-gaps/store.ts` (`listRollCallGaps`), read by Today,
  the close-out, the schedule board, the stale-count alert and the post-trip recap. One detector,
  so they cannot disagree. Its codes are `src/lib/roll-call-gaps.ts`.
- **The blocker-to-fix rule**: `blockerDestination` in `src/lib/blockers.ts`, shared with the
  counter and the palette. The shared readiness pass is `src/features/blockers/store.ts`.
- **Small primitives**: `src/lib/today-kinds.ts` (kinds, audience, severity), `src/features/today-urgency/rules.ts`,
  `src/features/today-job/rules.ts`, `src/features/seat-sailed/rules.ts`, `src/lib/shop-day.ts`, `src/lib/closeout-kinds.ts`.
- **What changed since you last looked**: `src/features/today-catch-up/store.ts`, a read-mark store.
- **The words**: `src/i18n/today-labels.ts`, `src/i18n/closeout-labels.ts` and `src/i18n/load-out-labels.ts`.

## Public surface

Everything importable from outside is re-exported by `./index.ts`. Deep imports are a
`pnpm check:architecture` failure.

## May import

`@/lib/**`, `@/db/**` (the trips modules through `@/db/trips`), and other feature modules'
`index.ts`. Never `@/app/**`. Nothing in `src/db`, `src/lib`, `src/i18n` or another feature's
internals may import Today; the weekly digest (`src/features/weekly-digest`) reads it through this
index.

## Invariants

- **One detector** (ADR 20260804-day-closeout): Today, the close-out and the board read the same
  roll-call gaps, never a second opinion of them.
- **Closing the day is a recorded act, never a gate.**
- **Codes, not sentences**: the readers return codes and `Copy`; the page words them.
