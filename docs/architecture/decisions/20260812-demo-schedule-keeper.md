# 20260812-demo-schedule-keeper — Keep the canonical demo's schedule from aging out

- **Status:** Accepted
- **Date:** 2026-08-12

Amends [20260724-per-visitor-demo-shops](20260724-per-visitor-demo-shops.md), which retired the
canonical `blue-mantis` demo to "the deterministic test fixture … public visitors no longer land on
it; the fleet still does." That stopped being true when the homepage grew a diver-facing preview:
`scheduleAttributionHref(DEMO_SHOP_SLUG, "home-diver-moment")` sends every visitor who clicks "See a
diver's booking page" straight to `/s/blue-mantis`. Public visitors do land on the canonical demo —
on its **diver** half, without signing in — and this ADR accepts that and gives the fixture the
upkeep a public surface needs.

## Context

Every date in the demo is anchored to the instant it was seeded (`src/db/seed-clock.ts`): one boat
sails today, the board runs about two months out, cards expire relative to the same moment. That
anchoring is deliberate and load-bearing — it is what lets the e2e fleet freeze one clock and get a
pixel-identical shop on every run.

The seed runs **once**. `isDemoShopSeeded` short-circuits the bootstrap on every cold start after the
first (`src/db/client.ts`), which is correct: re-running it would wipe a live demo on every deploy.
Nothing else has ever moved those dates.

So the canonical demo has a shelf life of roughly two months. Past it, the last seeded departure has
sailed, `upcomingScheduleRange` returns nothing, and `/s/blue-mantis` renders "No trips on the books
yet" — the empty state written for a real shop that has not scheduled anything. A visitor clicking a
marketing link that promises "see what your divers see" is shown a dive shop with no dives.

The staff half of the demo never showed this, which is why it went unnoticed: "Try the live demo"
mints a **fresh** shop per visitor and seeds it at click time (ADR 20260724), so it is always full.
Only the canonical fixture ages — and it is the one a marketing page points the public at.

## Decision

A daily pass, `GET /api/cron/demo-refresh` (`45 3 * * *` in `vercel.json`), calling
`refreshCanonicalDemoSchedule` (`src/db/demo-refresh.ts`):

- **Measure the runway** — days between now and the furthest-out upcoming departure. One indexed
  aggregate; on most nights the pass writes nothing at all.
- **Restore below `DEMO_SCHEDULE_MIN_RUNWAY_DAYS` (21)**, via the existing `resetDemoSchedule` with
  `{ history: true }` — the same operation the in-demo "Reset demo shop" button and the e2e fixture
  already run, wrapped in one transaction so a failure leaves an aging board rather than a half-wiped
  shop. The stable half (shop, staff, their logins, the backup destination) is untouched by
  construction, so demo sign-ins survive a restore.
- **Only ever the canonical demo**, matched on `isDemo` as well as its slug — the same guard
  `/api/test/reset` makes, so a repointed `DEMO_SHOP_SLUG` could never aim this at a real tenant.
- **Same fail-closed posture as every other scheduled route**: `CRON_SECRET` configured and presented
  as a bearer token, or 503/401 and no write. Its own Sentry monitor (`diveday-demo-refresh`), and
  `cron_demo_refresh.pass_failed` joins the `CronPassFailures` signal in `infra/lib/observability.ts`.

Three weeks of runway, not "is the board empty?" and not "is there a boat today?". Empty is too late —
by then the schedule a visitor came to look at is already gone. A boat today is true only on the day
of a restore, so it would wipe and rebuild a shared, publicly bookable shop every night for a board no
diver has a complaint about. Twenty-one days restores the demo while it still reads as a working dive
shop, and with a daily check the restore lands the day the board crosses that line.

### 2026-08-12 amendment — a second, much smaller pass for *today*

The runway threshold keeps the **diver's** half of the demo stocked, and that is all it keeps. A diver
reads what is coming up, so three weeks of board is a healthy demo to them; staff read **today**, and
between restores — roughly forty days out of every six-week cycle — nothing sails today, so
`/shop/blue-mantis`'s Today queue, its manifests and its close-out all render an empty day in
production (FU-20260812-canonical-demo-has-no-today-between-restores). The seed states the invariant
this breaks in `demoTodayDepartureStart`'s own comment: *today always has a board*.

So `ensureDemoSailsToday` runs beside the runway check, on the same tick and behind the same `isDemo`
guard: when nothing sails on the shop's own calendar day, move the **nearest upcoming non-series
departure** onto today's `demoTodayDepartureStart` slot, preserving its duration, and touch nothing
else. One `UPDATE` of one row. A departure that has already sailed and come home counts as today's
board — the day is not blank, and the shop home reads an ended departure as work (its close-out
handoff keys on exactly that).

Not by lowering `DEMO_SCHEDULE_MIN_RUNWAY_DAYS`: that reseeds a few thousand rows of a publicly
bookable shop, wiping whatever a visitor did, to fix one missing row.

Series instances are excluded. A moved one keeps its `series_occurrence_date` precisely so the nightly
roll does not re-fill the date it left (ADR 20260810-open-ended-recurring-trips), so dragging one onto
today would punch a permanent hole in a cadence staff can see. The demo seeds no series today; the
guard is there so that stays safe if it ever does.

**The trade-off, stated up front:** the roster, waivers and crew attached to the moved trip travel with
it, so today's board shows a departure whose story was written for a different day. That is the price
of not wiping the shop, and it is cheap against an empty day — a demo with a full boat on it teaches
what DiveDay does, and one with nothing on it teaches nothing.

## Alternatives considered

- **Point the homepage link at a freshly minted demo instead** (reuse `enterDemoAction`'s
  `role: "diver"` path, which already mints and redirects to the public schedule). Truest to ADR
  20260724, and rejected on cost at the door: it turns a crawlable `<a href>` into a POST, mints a
  whole seeded shop for a preview click, and is per-IP rate-limited — so a visitor who has already
  tried the staff demo gets bounced to `/sign-in?error=1` from a marketing page. It also fixes only
  this one link; every other door into `/s/blue-mantis` — a URL somebody shared, the embed widget,
  a screenshot for a pitch — stays broken.
- **Re-seed on every cold start**, dropping the `isDemoShopSeeded` short-circuit. Wipes a demo
  mid-visit on any deploy or scale-out, and undoes a deliberate cold-start optimization.
- **Shift the existing rows forward instead of re-seeding** (`starts_at + interval`). Cheap, and it
  would keep visitors' bookings — but only the trips would move. Certifications, the trailing quarter
  of history, waiver dates and the "today" boat would all drift out of step with the board, which is
  the coherence the anchored seed exists to provide.
- **Detect the empty board on read and re-seed lazily.** A destructive write on a GET render, on the
  request of whichever visitor happened to arrive first.
- **Leave it, and soften the empty state.** The link's promise is a booking page with departures on
  it; better wording for "no departures" does not keep the promise.

## Consequences

- The canonical demo is now a **restored** fixture, not an immortal one: roughly every six weeks its
  playground is deleted and re-seeded. Anything a visitor did on `/s/blue-mantis` — including a real
  booking against the demo shop — goes with it. That was always the contract of a demo shop
  (`resetDemoAction` does the same on demand); it is now on a timer.
- Pinned singletons keep working: `DEMO_RECAP_BOOKING_ID` is re-pinned by every reseed of this shop.
- The first pass after this ships restores immediately, since any database older than about two
  months already has zero runway.
- With `CRON_SECRET` unconfigured (a fork, a preview deployment), nothing runs and the demo ages
  exactly as it does today — the failure mode is the current behavior, not a worse one.
- The e2e fleet is unaffected: it seeds fresh and resets per test, so no pass ever fires under it.
- The canonical demo's **staff** surfaces are kept current too, as of the 2026-08-12 amendment above,
  which is what makes them safe to point a prospect, a support session or a pitch screenshot at. The
  cost is one moved trip per day at most, logged as `todayDeparture` on the existing
  `cron_demo_refresh.pass_complete` line — no second cron, and no second Sentry monitor. A run of
  `no_candidate` there means the board is healthy but every upcoming departure is a series instance the
  nudge refuses to move.
