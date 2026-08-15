# FU-20260815-a-refused-retraction-is-a-signal-nobody-counts — Count the two offline-retraction outcomes nothing can currently see

- **Status:** Open
- **Raised:** 2026-08-15 — raised independently by both the `security-reviewer` and the
  `dive-domain-expert` on the change that made an offline retraction a compare-and-set (ADR
  20260815-an-offline-retraction-names-its-target).
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/db/manifests.ts`, `src/lib/log.ts`, `infra/lib/observability.ts`,
  `docs/engineering/cloudwatch-observability-runbook.md`, `src/db/schema.ts`

## What I noticed

Two facts about the offline roll-call write path are produced and then thrown away, and both are
facts somebody will want later.

**1. `retraction_superseded` is claimed as an observability signal and is not one.** When a boat
tablet's `cleared` names a statement the server has moved past, `recordRollCall`/`recordCrewRollCall`
refuse it with that reason, the sync route returns it per event, and
`syncOfflineManifest` stores it on the device as `rejectionReason`. The device now *reads* it (it
decides whether a row goes back to awaiting), which is exactly right — but nothing anywhere calls
`log()` on that path, and there is no `$.event` code, so no metric filter counts it and no alarm can
ever mention it. The ADR's own revisit trigger is "if crews report retractions failing on rows
nothing else touched", which asks a crew to report a refusal DiveDay cannot see and has no support
channel for. On a two-device boat a burst of these means two crew are working the same rows from
different pictures — worth knowing about.

**2. Nothing counts a *bare* retraction, so the transition can never end.** An offline `cleared`
carrying no `retractsClientEventId` was queued by a build predating the field, and it deliberately
keeps the old blind newest-wins behaviour, permanently and with no expiry date (ADR decision 3 —
that argument is sound, the devices a window would cut off are by construction the ones not
listening). But because nothing counts them, "how much of this traffic is left?" is unanswerable,
and a rule that could safely be tightened once the answer is zero will instead stay open forever on
the strength of nobody having measured it.

Related and smaller: `retracts_client_event_id` is validated, used for the compare-and-set, and
never stored (`src/db/manifests.ts`, both inserts; `src/db/schema.ts` `rollCallEvents` /
`rollCallCrewEvents` carry only `clientEventId`). The *target* of an applied named retraction is
derivable from the trail — the compare-and-set guarantees it is the row immediately before it at
that subject and checkpoint — so the departure log an insurer reads is not missing the fact anyone
would look for. What is unrecoverable from the trail is the same provenance question as (2): was
this `cleared` checked, or blind?

## Why it isn't already done

The change that raised it owned `src/db/manifests.ts`, `src/lib/offline-manifests.ts`, the sync route
and `OfflineManifestView`. The signal registry is `infra/lib/observability.ts` — a different path,
under concurrent edit at the time, and one where "add a graph at a call site" is explicitly the wrong
move (AGENTS.md: add a signal to the registry, never at the call site). The column would also be the
first schema change on the roll-call tables since H-46 and pulls in a migration plus whatever reads
those rows.

There is a real judgement call inside it, which is why this is a `risk` and not a `cleanup`: **does
the append-only safety trail need to record that a retraction was compare-and-set checked?** An
insurer reading a departure log a year from now sees a `cleared` and, under the current schema,
cannot tell a checked retraction from a blind one. My reading is that the derivable target covers
the question anybody actually asks and a counter covers the operational one — but that is a call
about a legal-evidence surface, and it should be made deliberately rather than inherited from what
was convenient.

## Proposed change

1. **Count both outcomes.** In `src/db/manifests.ts`, on the two offline refusal paths, log through
   `src/lib/log.ts` with an `$.event` code (one for the refusal, one for a `cleared` arriving with no
   `retractsClientEventId`), carrying shop and trip but **no** person, booking, or note — this is the
   surface where a log line about a named diver would be the leak. Register both in
   `infra/lib/observability.ts` as metric filters, expanded in §13 of `infra/lib/infra-stack.ts`, and
   document them in `docs/engineering/cloudwatch-observability-runbook.md`. No alarm on either at
   first; they are counters to read, and the bare-retraction one is a counter whose *target is zero*.
2. **Decide, and write down, whether the trail needs the provenance.** If yes: a nullable
   `retracts_client_event_id uuid` on both `roll_call_events` and `roll_call_crew_events` (additive,
   so it passes `scripts/check-migrations.mjs`), written only on offline `cleared` rows, plus a line
   in the departure log's rendering. If no: one paragraph in ADR
   20260815-an-offline-retraction-names-its-target's Consequences replacing the one that currently
   defers to this entry.

**Not proposed:** rendering the reason to the crew as a sentence. The row already says the right
thing in words ("Recorded on another device or on the live manifest — undo it there, not here"), and
a reason code shown raw on a boat screen is the `src/lib`-returns-codes rule broken in the worst
place. **Also not proposed:** using the counters to reintroduce a deadline for bare retractions — the
counter exists so the decision can be revisited on evidence, and the evidence has to say zero.

## Prompt

```text
DiveDay's offline roll-call sync refuses a retraction whose target the server has moved past
(reason `retraction_superseded`, see ADR 20260815-an-offline-retraction-names-its-target and
`offlineRetractionSuperseded` in src/db/manifests.ts). That refusal is real and the device acts on
it, but nothing counts it: there is no `log()` call and no `$.event` code on either offline refusal
path, so the ADR's "revisit if crews report retractions failing" trigger asks crews to report
something DiveDay cannot see. The same is true of a *bare* retraction — one arriving with no
`retractsClientEventId`, which keeps the old blind newest-wins behaviour forever by design, and
whose remaining volume is therefore unmeasurable.

Read first: docs/product/follow-ups/FU-20260815-a-refused-retraction-is-a-signal-nobody-counts.md,
then ADR 20260815-an-offline-retraction-names-its-target, then the `source === "offline"` branches
of recordRollCall/recordCrewRollCall in src/db/manifests.ts, then
docs/engineering/cloudwatch-observability-runbook.md and the registry in infra/lib/observability.ts.

Add two counted signals — a refused retraction, and a retraction that named nothing — through
src/lib/log.ts with `$.event` codes, registered in infra/lib/observability.ts and expanded in §13
of infra/lib/infra-stack.ts, documented in the runbook. Carry shop and trip only: NO person id,
booking id, name, or note reaches a log line on this path. No alarms yet; these are counters, and
the bare-retraction one is a counter whose target is zero.

Then make the call the follow-up frames and write it down either way: does the append-only roll-call
trail need to record that a retraction was compare-and-set checked (a nullable
`retracts_client_event_id` on roll_call_events and roll_call_crew_events, additive, written on
offline `cleared` rows), or is the derivable target enough? If enough, replace the deferring
paragraph in that ADR's Consequences with the reasoning.

Constraints: infra/ is ASCII-only (scripts/check-infra-ascii.mjs). An `$.event` code is a contract a
test reads out of src/ — renaming one silently stops a metric filter counting. If you add the
column, run `pnpm db:generate` and `pnpm check:migrations`.

Run pnpm check, plus `pnpm test src/db/manifests.test.ts --reporter=dot` and `pnpm test infra`.
Delete docs/product/follow-ups/FU-20260815-a-refused-retraction-is-a-signal-nobody-counts.md as part
of the change.
```
