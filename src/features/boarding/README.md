# boarding

Getting the right people on the boat: the diver's ready page, check-in at the counter, the
manifest and roll call, offline copies of it, and the reasons someone cannot board.

## Owns

- Readiness on the day: `ready.ts`, `blockers.ts` (the shared readiness pass), `readiness-link-rescue.ts`,
  `carried-preparation.ts`, `running-late.ts`, `turn-away.ts`, `no-show.ts`.
- The counter and the dock: `check-in/`, `dock-day-page.ts`, `dock-rider.ts`, `deck-counts/`,
  `arrival-card-document.ts`, `print-pass.ts`, `wallet-pass/`.
- The roster and roll call: `roster-facts.ts`, `roster-filters.ts`, `roll-call-gaps.ts` (the one
  detector of open head counts), `roll-call-alerts/`, `standing-sailed-roll-call.ts`.
- Offline manifests: `offline-manifest-snapshots/`.
- The public safety record's four counts: `safety-record.ts` (shown only when the owner turns it on).

## Does not own

Readiness itself (`src/lib/readiness.ts`), admission at booking time (`src/lib/trip-admission.ts`),
seating a diver (`bookings`), and the day's queue (`src/features/day/today/`).

## Invariants

- Every active booking appears on the manifest, incomplete or blocked included; readiness is never
  recomputed differently in the manifest; a boarding change is explicit, time-stamped and
  auditable; departure and every after-dive checkpoint keep their own roll-call state.
- A buddy team is two or more, a diver is on one team per departure at most, and a team feeds no
  readiness, admission, capacity or checkpoint input.
- An offline copy is encrypted, freshness-labelled, expiring and never an editable roster; every
  seat tap writes an event and an idempotent repeat writes nothing; sync replays by
  `client_event_id` and rechecks live readiness. Roll-call statements merge by tap-observed
  evidence and actual conflicts need explicit crew reconciliation; clocks never establish
  observation.
- Safety-critical: changes here get failure-path tests and a `dive-domain-expert` review.
