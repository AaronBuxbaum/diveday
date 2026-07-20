# 20260720-today-work-queue — Today is a work queue, not a dashboard

- **Status:** Accepted for the current staff web app
- **Date:** 2026-07-20

## Context

[20260719-shop-owner-workspace](20260719-shop-owner-workspace.md) established Today as the first of
three primary workspaces and described its content as "upcoming trips, delivery issues, and
workspaces that need attention now". In practice that produced a page that was mostly a mirror:

- Four summary tiles (upcoming trips, open seats, at capacity, follow-ups) that no one can act on.
- A **Workspaces** card grid pointing at Divers, Schedule, and Gear — all of which are already
  single clicks away in the persistent nav, which now carries Gear as a primary tab.
- A **Next departures** list that restates the Schedule page.

The genuinely operational content — which divers will be turned away at the dock, and which boat
they are holding up — was reduced to a single "blocked" count on one trip. Staff had to open each
trip roster in turn to find out who was actually a problem.

## Decision

Today answers two questions, in that order, and nothing else:

1. **Can the boats leaving today sail?** A "Sailing today" board listing only departures in the
   shop's own timezone, each with ready/blocked/boarded counts and a direct manifest link. A
   departure three weeks out is a Schedule question.
2. **Who needs me before they do?** A ranked work queue over the next seven days.

Rules that define the queue, encoded in [`src/lib/today.ts`](../../../src/lib/today.ts):

- **Every row is an action.** A row carries a subject, why it is timely, what is wrong in staff
  language, and a verb-labelled link to the one surface that fixes it. Card evidence resolves to
  the person record; waiver, payment, and requirement work resolves to the trip roster row (which
  now carries a `booking-<id>` anchor so the link lands on the right diver).
- **One row per job, not per fact.** A diver with three blockers is one row headlined by the
  hardest one. Several divers on the same boat with the same blocker collapse into one row
  ("9 divers · Send waivers"). Without this, one busy departure buries every other boat.
- **Chronological, then severity.** The 07:00 boat's problems outrank the 14:00 boat's. Severity
  ranks by how long a fix takes to land — evidence that must come from a diver or a physician
  outranks anything staff can settle at the dock — and only breaks ties inside one departure.
- **Nothing that is one click away.** No workspace tiles, no schedule mirror, no vanity counts.

Signals beyond readiness earn a place only if they are timely *and* not obvious elsewhere:
unpacked rental requests, kit whose service falls due before the boat it is packed on sails,
instructor-less course sessions, a freed seat on a wait-listed trip, and failed booking emails.

The seeded demo shop now sails one trip today, so the departure board is never empty in a demo.

## Alternatives considered

- **Keep the tiles and add a blocked-divers list below** — rejected: the tiles set the page's
  altitude. Anything above the work reads as more important than the work.
- **One row per blocker** — rejected: correct, and unusable. Nine divers missing waivers on one
  boat produced nine identical rows and pushed a genuine medical-review flag off the screen.
- **Show the whole upcoming schedule with inline readiness** — rejected: that is the Schedule
  page's job. Today should shrink to nothing on a clear day, which a schedule never does.
- **A separate "attention" route** — rejected: it would compete with Today rather than replace it,
  and the workspace ADR's rule is to replace a destination, not add a peer.

## Consequences

Today shrinks to an empty state on a clear day, which is the intended reward rather than a gap; the
empty state is one of the few places `--accent` is spent. Readiness stays a per-trip roll-up, so the
queue bounds itself to twenty departures inside a seven-day horizon — a shop busier than that is
served by Schedule.

The queue is derived entirely from existing source-of-truth models and adds no new state, so it can
never disagree with a roster or a manifest. Any future operational signal must clear the same bar
before it earns a row: actionable now, or timely and not otherwise visible in one click.

This supersedes the Today description in
[20260719-shop-owner-workspace](20260719-shop-owner-workspace.md); the three-workspace navigation
and the More grouping in that record still stand.
