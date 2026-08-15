# FU-20260815-a-dev-pglite-ages-and-nothing-keeps-it — Give a developer's local demo the keeper passes production gets

- **Status:** Open
- **Raised:** 2026-08-15 — while closing FU-20260813-reviews-and-tips-look-unseeded, which turned
  out to be the canonical demo aging out from under its seed
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/db/client.ts`, `src/db/demo-refresh.ts`, `src/db/seed-recent-recaps.ts`,
  `package.json`

## What I noticed

Every date in the demo shop is anchored to the instant the database was seeded, and that seed runs
**once** — `seedIfEmpty` short-circuits every start after it (`src/db/client.ts`). Production has
three keeper passes that hold the demo's story true as the calendar moves past that instant: the
restore, `ensureDemoSailsToday`, and now `seedRecentRecaps` (all driven by
`/api/cron/demo-refresh`).

Nothing runs any of them locally. A developer's `.pglite` is seeded on the day they first ran
`pnpm dev` and then simply drifts, so a week or two in:

- `/shop/blue-mantis` shows an empty day, because the boat that sailed "today" sailed a fortnight
  ago (the production symptom `ensureDemoSailsToday` exists to fix);
- `/shop/blue-mantis/reports` shows **Tips $0** beside 26 trips and 107 bookings, because every
  seeded tip and review fell behind the current month (the symptom `seedRecentRecaps` now fixes);
- the fix for both is folklore — `pnpm db:reset` — which nothing tells you and which throws away
  whatever you were poking at.

I reproduced the reports half by hand: aging the dev database 20 days and reloading
`/shop/blue-mantis/reports` reads exactly as "reviews and tips are not seeded", which is how that
report reached the register in the first place. So the cost is not cosmetic — it sends sessions
looking for bugs in query scoping that are not there.

## Why it isn't already done

Outside the scope I was given (the reports page, its queries, and the seed modules), and it is a
design call rather than a patch: "run the keepers on dev boot" is one line in the wrong place if
the answer is really "dev should re-seed", and the two have very different feels — a keeper leaves
your poking intact and quietly moves one trip, a re-seed is honest but wipes the booking you just
made. There is also a third option (leave it, and just *tell* the developer), which is cheap and
might be enough.

## Proposed change

Pick one, in `src/db/client.ts`'s cold-start path, guarded to PGlite-only so it can never reach a
real deployment:

1. **Run the keepers on dev boot.** After `seedIfEmpty`, call `refreshCanonicalDemoSchedule` —
   which already fires the restore only when the board has run down, nudges a boat onto today, and
   recaps the month. Cheapest, matches production exactly, and a `pnpm dev` restart is the natural
   moment to do it.
2. **Report, don't act.** Log a one-line warning on boot when the demo's newest departure or newest
   settled tip is older than `now`, naming `pnpm db:reset`. No behaviour change, no surprise.

Not proposing that `pnpm dev` re-seed unconditionally: the demo playground is where a developer's
own scratch bookings live, and wiping them on every restart is worse than the drift.

## Prompt

```text
Read src/db/demo-refresh.ts's module docstring (the three keeper passes and why each exists),
src/db/seed-recent-recaps.ts, and the `seedIfEmpty` / cold-start path in src/db/client.ts. The
problem: every date in the demo is anchored to the instant the database was seeded, that seed runs
exactly once, and only production's /api/cron/demo-refresh ever moves them again. So a developer's
.pglite drifts — a fortnight in, /shop/blue-mantis has no boat today and /shop/blue-mantis/reports
reads "Tips $0" beside a full trips table, which has already sent one session hunting for a
query-scoping bug that did not exist. Decide between running refreshCanonicalDemoSchedule on dev
cold start (guarded to PGlite, never a configured DATABASE_URL) and simply logging a staleness
warning that names `pnpm db:reset`. Do NOT make `pnpm dev` re-seed unconditionally: the playground
holds whatever the developer was poking at. Done when a dev database seeded weeks ago shows a boat
today and a non-zero Tips figure for the current month after one `pnpm dev` restart (or, under
option 2, says so on the console), with a focused unit test on whichever path you add and `pnpm
check` green. Delete docs/product/follow-ups/FU-20260815-a-dev-pglite-ages-and-nothing-keeps-it.md
as part of the change.
```
