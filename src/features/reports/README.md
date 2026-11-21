# reports

What the shop and its founder learn from the numbers: monthly reports, the Monday read, the
weekly digest, demand, and the year in review.

## Owns

- The monthly report: `reporting/`, `report-lines/` (its money lines), `reports-page.ts`.
- Summaries: `monday-read.ts`, `monday-summary.ts` (a prompt module), `weekly-digest/`,
  `shop-year.ts`, `year-card.ts` (a bitmap card).
- Signals: `demand.ts`, `funnel.ts`, `lead-time.ts`, `season-scale.ts`, `founder-metrics.ts`.
- The owner's stats tab (`owner-stats.ts`): repeat divers, the course funnel, medical review time, waivers by departure and by the day before, over the last 12 months.

## Does not own

The money itself (`money`), the queries under each line (`src/db/`), and the words (the bundles).

## Invariants

- `owner-stats.ts` is informational: plain aggregates, never a gate, never a message to a diver. A figure with nothing behind it reads a dash, not a zero percent.

- `demand.ts` is deliberately conservative: the departure must be full and the wait list must hold
  at least two people or a quarter of another boat.
- `year-card.ts` is composited into a standalone bitmap, so its palette is exempt from the token
  guard (`scripts/check-tokens.mjs`).
