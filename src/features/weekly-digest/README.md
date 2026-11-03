# weekly-digest

The Monday email: last week's bookings, money and reviews, this week's boats and waivers, and the
Today rows that are already overdue. One email per staff login that wants it, sent once a week.

Module shape: [20260730-feature-module-contracts](../../../docs/architecture/decisions/20260730-feature-module-contracts.md).

## Owns

- The email's facts (`readWeeklyDigestFacts`), its preview, and the send pass the cron route runs.

## Does not own

- Who receives it, each staffer's on/off choice and the opt-out link: `src/db/weekly-digest.ts`,
  because the unsubscribe page (`src/db/unsubscribe.ts`) reads them from below.
- What goes in it and how it is graded: `src/lib/weekly-digest.ts`. The words:
  `src/lib/notifications/weekly-digest-email.ts`.
- Today's queue, which it reads through `@/features/today`.

## Public surface

Everything importable from outside is re-exported by `./index.ts`.

## May import

`@/lib/**`, `@/db/**`, and other feature modules' `index.ts` (`@/features/today`). Never `@/app/**`.

## Invariants

- **Every number comes off a reader another surface already trusts**, so the email can never say
  something the app contradicts. The overdue count is Today's own queue, read twice off one readiness
  pass: with the owner-only rows for Reports' gate holders, without them for everyone else.
