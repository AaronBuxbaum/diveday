# day

The shop's day as staff live it: the home queue and close-out, what changed since you looked,
and the clock every "what time is it here" question reads.

## Owns

- `today/`: the work queue, the departures board and the evening close-out (its own README).
- Small pieces a substrate module or the queue needs: `today-job.ts`, `today-urgency.ts`,
  `today-catch-up.ts`, `today-catch-up-token.ts`, `today-catch-up-retention-fixture.ts`.
- `how-it-went/`: the owner's short account of one departure (glossary, "How it went").
- `staff-home.ts`, `shop-clock.ts` (one frozen value per request), `lost-items/`.
- `world.ts`: the shop's day as the one-day simulation and route coverage walk it.

## Does not own

The open head counts (`src/features/boarding/roll-call-gaps.ts`), the readiness pass (`src/features/boarding/blockers.ts`),
and every module Today reads; it sits above them.

## Invariants

- Nothing in `src/lib`, `src/db` or `src/i18n` imports Today; what they need is a small file below it.
- The earlier departure's problems come first and severity ranks only within one departure;
  undated work sorts last; identical blockers on one boat collapse into one batch action; a diver
  who is already clear produces no action; an action is never a dead end.
- Closing the day is a recorded act, never a gate (ADR 20260804-day-closeout).
- Time is read through the clock, never `new Date()`.
