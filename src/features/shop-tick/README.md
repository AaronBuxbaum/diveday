# shop-tick

Every shop cadence, once an hour: the scans `/api/cron/shop-tick` runs (issue #2715). Each is a
promise a fixed UTC hour cannot keep across zones, decided per shop in the shop's own day: the
minimum-head-count decision, pre-trip reminders, held sends, gear service reminders, recaps, crew
notices, the stale roll-call alert, the missing-diver alert's retry, the desk's trailing ping and the seat-sold email.
The demo shops' boats at sea come home first, so no alert reads a demo boat as overdue. The minimum-head-count decision runs next, so no reminder goes out for a departure the same tick cancels. The other scans then run side by side.

A `?scan=<name>` rerun runs only those scans and never checks in to the hourly monitor. An unknown name is a 400 before anything runs.

Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).

## Owns

- The list of scans (`SHOP_TICK_SCANS`) and their order.
- Isolation: a scan that throws is reported under its own `cron_scan` tag, logged as
  `cron_shop_tick.scan_failed` with its name, and answered as `null`.
- Whether the tick did its work (`shopTickIsHealthy`): every scan answered and no filed
  missing-diver report is still untold.
- The minimum-seats sweep's refund and mail loop (`sweepMinimumSeats`).

## Does not own

- The scans' reads and sends, which stay in `src/db/`: `src/db/reminders.ts`, `src/db/recap.ts`,
  `src/db/crew-notices.ts`, `src/db/roll-call-alerts.ts`, `src/db/missing-diver-alerts.ts`,
  `src/db/desk-pings.ts`, `src/db/seat-sold-alerts.ts`, `src/db/held-sends.ts`,
  `src/db/work-order-follow-up.ts`, `src/db/trips-minimum.ts` and `src/db/seed-boat-at-sea.ts`.
- The cron frame (the bearer gate, the Sentry monitor, the 503), which is `cronRoute`
  (`src/lib/cron-route.ts`), and the schedule, `SHOP_TICK_CRONTAB` (`src/lib/cron-schedule.ts`).
- Platform cadences that are not about a shop's day: retention, backups, integrations, the daily
  retry drain.

## Public surface

`./index.ts`: `runShopTick`, `shopTickIsHealthy`, `SHOP_TICK_SCANS`, `isShopTickScan`,
`sweepMinimumSeats` and their types. Deep imports are a `pnpm check:architecture` failure.

## May import

`@/lib/**`, `@/db/**`, and other feature modules' `index.ts`. Never `@/app/**`.
