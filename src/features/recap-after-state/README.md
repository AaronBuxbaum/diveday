# recap-after-state

What a diver sees after the boat is home: the dive record, the photos, the review and tip asks,
and the next departure worth booking. One assembler, `buildAfterStateProps`, read by the bearer
pages `/ready/[token]` (once the day is done) and `/recap/[token]`, and rendered by
`src/app/ready/[token]/_components/AfterState.tsx`.

Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).

## Owns

- The `AfterStateProps` shape and the one function that fills it.
- Which reads the after-state makes: the recap, the review, the tip presets, the recap pulse, the
  booking handoff link and the next public departure.

## Does not own

- The reads themselves, which stay in `src/db/` (`recap.ts`, `reviews.ts`, `tips.ts`,
  `recap-pulses.ts`, `booking-handoff.ts`, `next-dive.ts`, the `trips` barrel).
- The bearer-token check, which each page makes before it calls in here.
- The words: every sentence comes from the diver bundle through the translator the page passes.

## Public surface

`./index.ts`: `buildAfterStateProps` and the `AfterStateProps` type. Deep imports are a
`pnpm check:architecture` failure.

## May import

`@/lib/**`, `@/db/**`, `@/i18n/**`, and other feature modules' `index.ts`. Never `@/app/**`.

## Why a feature module

It was `src/lib/recap-after-state.ts`: a page loader reading seven `src/db` modules from the
framework-free domain layer, which `check:architecture` now refuses (`src/lib` takes only types from
`src/db`). It composes reads and copy for two routes, which is what this layer is for.
