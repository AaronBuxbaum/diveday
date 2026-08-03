# 20260803-seed-scenario-modules — Split the demo seed into scenario modules behind one orchestrator

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

`src/db/seed.ts` had grown to 4,650 lines and was the repository's top merge-conflict magnet —
named as such in the 2026-08-02 comprehensive review (ARCH-3). Every parallel session that adds a
feature also adds demo data for it, so every parallel session edits this one file, usually in the
middle of it. Two sessions appending a scenario land in the same region and conflict on work that
has nothing in common.

The file resisted the obvious fixes for a real reason: **the seed's output is a fixture that other
things are pinned to.** The e2e fleet freezes one instant (`DIVEDAY_CLOCK`) so that the seeded shop
renders pixel-identically, and the visual-regression baselines are keyed to those exact pixels.
Unit tests assert on named divers landing on named boats. So the seed is not merely code that
happens to be long — it is code where *insertion order is data*, and any decomposition has to
leave the bytes untouched.

Three things make the order load-bearing, and all three are easy to break by accident:

1. **Positional indexing.** The rosters, payments, and manifests index into the diver list by
   position (`customers[3]` is a specific person to four other scenarios).
2. **A shared tick counter.** `nextCreatedAt()` hands out strictly increasing `created_at` stamps
   so that rows in one multi-row INSERT do not tie on the transaction-start instant — Postgres
   does not promise a stable order for ties, so without it the render order of a roster drifts
   between runs.
3. **The frozen clock.** Every date is derived from `nowMs()`/`nowDate()`, never a direct
   wall-clock read, which is what lets the harness pin the whole shop to one instant.

## Decision

`src/db/seed.ts` stays the module every caller imports and becomes an **orchestrator**: it holds
`seedIfEmpty`, `seedDemo`, `createDemoShop`, `resetDemoSchedule`, and a `seedDemoSchedule` that is
now a short, readable sequence of named steps. Each step is a `src/db/seed-<scenario>.ts` module
named for the shop story it seeds, not for the tables it writes:

| Module | The shop story it seeds |
| --- | --- |
| `seed-clock.ts` | every date in the demo, anchored to the frozen clock |
| `seed-images.ts` | the bundled imagery sites and recaps point at |
| `seed-cast.ts` | the divers on file, in the order the rosters index into |
| `seed-divers.ts` | those divers' rows and the certification evidence on them |
| `seed-catalog.ts` | what the shop teaches: courses, page content, certification paths |
| `seed-dive-sites.ts` | where it dives, and the field guide on each site |
| `seed-trips.ts` | the board: departures, meeting windows, requirements, crew, conditions |
| `seed-bookings.ts` | who is booked, and the payments, waivers, recaps and promos that follow |
| `seed-more-trips.ts` | the rest of the month beyond today's three headline boats |
| `seed-nitrox.ts` | EANx cards and the per-dive gas the wreck charter gates on |
| `seed-rental-fit.ts` | divers' saved sizes, so the gear locker has something to pull |
| `seed-front-desk.ts` | the desk's own day: walk-ins, wait lists, inquiries, tips |
| `seed-history.ts` | the trailing quarter that gives owner reporting something to report |
| `seed-demo-lifecycle.ts` | minting, reaping, and capping throwaway demo shops |

Three rules keep the fixture intact:

1. **The orchestrator owns the order.** Steps are called from `seedDemoSchedule` in the order they
   were written in, and each returns exactly what the later steps read (the divers, the courses,
   the sites, the trips, the bookings). Nothing reaches sideways into a sibling module.
2. **One clock, one counter.** `seed-clock.ts` is the single home for `at`, `dateAt`,
   `birthDateTurning`, `hoursFromNow`, `demoTodayDepartureStart`, and the `nextCreatedAt` tick.
   The counter is module state on purpose: one counter for the whole seed, so its stamps stay
   unique *across* scenarios, not just within one.
3. **A new scenario is a new module.** Adding demo data means a new `seed-*.ts` and one line in the
   orchestrator — not rows wedged into an existing scenario. That is the whole point: two sessions
   adding two scenarios now touch two different files plus one line each.

The public surface of `@/db/seed` is unchanged. The lifecycle helpers and `DEMO_RECAP_BOOKING_ID`
are re-exported from `seed.ts`, so no importer moved.

## Verification

The decomposition was verified by **fingerprinting the seeded database**, not by reading the diff.
A harness ran `seedDemo(db, { history: true })` under a frozen `DIVEDAY_CLOCK`, dumped every row of
every table, canonicalised the parts that are legitimately non-deterministic (random primary keys
renumbered in first-appearance order so foreign-key structure is still compared; bcrypt hashes and
`defaultNow()` columns masked), and compared before and after. The method was validated by first
proving two independent runs of the *unchanged* code produce an identical 2.8 MB fingerprint, then
showing the decomposed code produces that same fingerprint byte for byte.

That harness is not committed — it is a one-shot proof, and the standing guard is the existing
seed/visual coverage. Anyone making a comparable change to the seed should rebuild it rather than
trust a code review.

## Alternatives considered

- **Leave it as one file** — rejected; it is the status quo whose cost the review measured, and it
  grows with every feature.
- **A `src/db/seed/` directory with an `index.ts`** — rejected. `src/db/seed.ts` and `src/db/seed/`
  would both answer `@/db/seed`, and which one wins is a module-resolution detail rather than
  something a reader can see. Flat `seed-*.ts` siblings sort together in a directory listing and
  leave the entry point unambiguous.
- **A feature module (`src/features/demo-seed/`)** — rejected for now. The seed is not a product
  capability with its own routes and rows; it is fixture data for every capability, and it writes
  to nearly every table in `src/db/schema.ts`. Revisit if the demo grows behaviour of its own.
- **Splitting by table** (`seed-people.ts`, `seed-bookings.ts`, …) — rejected. It reads as a
  faithful decomposition and is the wrong one: it cuts across the story, so adding "a course with a
  wait list" would still touch four files, and it hides the ordering dependency instead of naming
  it.
- **A declarative fixture format (YAML/JSON) interpreted by a small loader** — rejected. The seed's
  value is in its prose: the comments explaining *why* one diver has no emergency contact and one
  waiver request quietly never went out are the documentation of what each surface must handle. A
  data format would strip that, and the derived values (clock-anchored dates, positional rosters)
  would need an expression language to survive.

## Consequences

- Two sessions adding two scenarios touch two different files and one orchestrator line each. The
  conflict surface for the common case drops from "somewhere in 4,650 lines" to "one line".
- `seedDemoSchedule` is readable end to end for the first time: it names the shop's story in
  sequence instead of burying it in 1,800 lines.
- The orchestrator's step list is now the thing to review carefully. Reordering it silently changes
  the fixture, so the file says so at the top and each step's contract is its return value.
- The step boundaries are where the data flows, which means a future scenario that needs something
  from the *middle* of a step has to either take a return value or be a new step. That friction is
  intended.
- **Revisit if** the per-step context objects start growing past a handful of fields. That would be
  the signal that the seams are in the wrong place, not that they should be removed.
