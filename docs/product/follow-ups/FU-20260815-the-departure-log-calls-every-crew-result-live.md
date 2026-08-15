# FU-20260815-the-departure-log-calls-every-crew-result-live — Read `source` for crew roll call instead of hard-coding "live"

- **Status:** Open
- **Raised:** 2026-08-15 — `security-reviewer` on the offline roll-call change (ADR
  20260815-offline-can-unsay-a-missing-diver). Pre-existing since H-46; outside that change's paths.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/incident-export.ts`, `src/db/export.ts`

## What I noticed

`src/db/incident-export.ts` builds the departure log — the document a shop hands an insurer or an
authority — and stamps every crew roll-call row:

```ts
// Crew events have no offline path; the live manifest is their one writer.
source: "live" as const,
```

That comment stopped being true with H-46 (2026-08-14). `roll_call_crew_events` carries a `source`
column, and `src/app/api/offline-manifests/sync/route.ts` writes crew events with
`source: "offline"` — a captain offshore counting crew with the radio off is exactly the case H-46
exists for. So the evidentiary document asserts, of every crew result, that a human recorded it on a
live connected screen, when some of them were recorded on a saved copy and reconciled later. The
diver half of the same document reads the column correctly.

Smaller sibling in the same family: the crew CSV header in `src/db/export.ts` omits `source` and
`client_event_id`, which the diver CSV includes — so a shop cannot tell an offline crew result from
a live one in its own export either.

## Why it isn't already done

Both files were outside the paths the change that surfaced this owned, and the export file header is
a published data-portability contract: adding two columns to `roll_call_crew_events.csv` is a
deliberate act with a test to update (`src/db/export.test.ts`'s schema-coverage test), not a
drive-by.

## Proposed change

- `src/db/incident-export.ts`: read `event.source` for crew rows exactly as the diver rows do, and
  delete the comment. Add a case to `src/db/incident-export.test.ts` covering an offline-sourced
  crew event so the constant cannot come back.
- `src/db/export.ts`: add `source` and `client_event_id` to the `roll_call_crew_events.csv` header
  and rows, matching the diver file.

**Not proposed:** dropping `source` from either document. Whether a head count was taken on a live
screen or on a saved copy is a fact about the evidence, and the offline path already records the
snapshot it was taken against.

## Prompt

```text
DiveDay's departure log (src/db/incident-export.ts) hard-codes `source: "live"` for every crew
roll-call row, with a comment saying crew events have no offline path. That has been false since
H-46 (2026-08-14): src/app/api/offline-manifests/sync/route.ts writes crew events with
source: "offline", and roll_call_crew_events carries the column. The document a shop hands an
authority therefore asserts something about its own evidence that is not true.

Read docs/product/follow-ups/FU-20260815-the-departure-log-calls-every-crew-result-live.md first,
then the crew branch of src/db/incident-export.ts (around lines 110-125) beside the diver branch
above it, which reads the column correctly.

Done means: the crew rows read `event.source`, the comment is gone, a test in
src/db/incident-export.test.ts covers an offline-sourced crew event, and the
roll_call_crew_events.csv header in src/db/export.ts carries `source` and `client_event_id` like the
diver file does (src/db/export.test.ts's schema-coverage test will want updating with it).

Run pnpm test src/db/incident-export.test.ts src/db/export.test.ts --reporter=dot and pnpm check.
Delete docs/product/follow-ups/FU-20260815-the-departure-log-calls-every-crew-result-live.md as part
of the change.
```
