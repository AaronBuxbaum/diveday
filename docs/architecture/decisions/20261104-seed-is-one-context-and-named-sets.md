# 20261104-seed-is-one-context-and-named-sets — Seed the demo from one typed context, in named sets

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

ADR 20260803-seed-scenario-modules split the demo seed into `seed-<scenario>.ts` modules behind one
orchestrator, each step returning what later steps read. It named its own revisit signal: per-step
context objects growing past a handful of fields. By November the orchestrator threaded about ten
values (divers, courses, sites, trips, bookings, the wreck, the waiver template, the crew ids)
into hand-assembled argument objects, and `history` was a boolean read in eleven places and passed
into three modules (issue #2760). Order is still the fixture: the shared `nextCreatedAt` tick and
the e2e baselines depend on it.

## Decision

- **One context.** `src/db/seed-schedule.ts` builds a typed `SeedContext` once, in `seedTheBoard`
  (staff, divers, catalog, sites, trips, bookings, shop facts), and every later step reads it
  (`c.bookings.wreck`, `c.staff.instructor`). Step modules keep their own signatures and write
  through their own code; only the orchestrator knows the context.
- **Named sets, not a flag.** A step is in the `demo` set or the `history` set. A shape names its
  sets (`SEED_SHAPES`: `lean` = demo, `history` = demo + history), and every caller names a shape:
  `seedDemo(db, shape)`, `resetDemoSchedule(db, shopId, shape)`, `createDemoShop(db, { shape })`
  (default `history`, the visitor's mint). No step module takes a history argument; a module with
  a history half is two steps (`seedFrontDeskLists`, `seedFrontDesk`).
- **The day is an ordered list.** `THE_DAY` holds every step after the board, in order, each with
  its prose comment. A new scenario is a new module and one entry where its reads are satisfied.
- **Kept from 20260803:** one clock and one counter (`seed-clock.ts`); a new scenario is a new
  module; byte-identical output is proven by fingerprinting the seeded database, not by review.

This change was proven with that harness: canonical `history` shop, a `lean` and a default mint, a
`history` reset, and the `lean` template, dumped with ids and seals masked and rows sorted. The
output matched the old code, except two course-form signature dates in the visitor mint that differ
between runs of the old code too.

## Alternatives considered

- **Fact registry shared with test facts** (the issue's full shape) — rejected; it couples what
  every demo visitor receives to test convenience, and `src/db/facts/` stays test-only.
- **Each module takes the whole context** — rejected; modules would depend on every field, and
  their tests would have to build one.
- **Keep the flag** — rejected; it is the status quo the revisit signal named.

## Consequences

- A reader sees which steps a lean shop skips by the word in front of each entry.
- Adding a shape (for example a `year` band) is one line in `SEED_SHAPES` and a set name.
- The context is built before any day step runs, so a step that needs a value from another day step
  must move it into the board, which is the friction 20260803 intended.
- Revisit if steps start reading context fields they do not need, or the board grows past the
  scenarios every step reads.
