# 20260824-pre-departure-safety-check — A shop-authored safety line, tapped once before the boat leaves, informs never gates

- **Status:** Accepted
- **Date:** 2026-08-24
- **Issue:** [686](https://github.com/AaronBuxbaum/diveday/issues/686)

## Context

DiveDay models the crew's competence (roles, trip assignments, in-water ratios), the divers'
evidence (cards, waivers, medical), the gear's service clocks (hydro, VIP, O2-clean, regulator
service — `gear_service_events`), and boarding down to a per-person append-only roll call with an
offline path for when the signal drops. It has never asked whether the boat's emergency equipment
is aboard before it leaves — an uninspected US passenger vessel carries a legally specified set
(life jackets per person, a fire extinguisher, visual distress signals, a sound device), every
agency's operational standard has a pre-departure check, and DiveDay will hold a departure because
a diver's specialty card was never confirmed while having no opinion at all about the second thing.

The asymmetry is the finding, not the feature: the pieces of a pre-departure check already exist in
this app's shape (`gear_service_events`'s "newest row per kind, informs never gates" stance, roll
call's per-departure append-only record with a recorder and a timestamp, the manifest as the screen
a crew has open at the rail) — nothing had assembled them.

## Decision

**A shop-defined ordered checklist, ticked once per departure, that blocks nothing.**

- `pre_departure_checklist_items` (shop-authored, ordered by `sort_order`, soft-deletable) and
  `pre_departure_check_events` (append-only, one row per tap, newest-per-item wins) — modeled
  directly on `gear_items`/`gear_service_events`'s shape, not on roll call's, because the safety
  stakes differ: a checklist item is never the record of a diver who did not come back from a dive.
- **DiveDay authors no checklist content.** The required set differs by flag state, vessel class
  and jurisdiction; a hard-coded US list rendered to a shop in Cozumel would be worse than no list.
  The demo shop ships five realistic lines (`seedPreDepartureChecklist`) so the shape reads on
  first look, and nothing else is DiveDay's words.
- **Informs, never gates.** Nothing here may block a departure page from rendering, a trip from
  sailing, or any other surface's own logic. Whether it *should* gate is a real, live question —
  recorded as H-51 in `docs/product/human-decisions.md`, not decided by this table's shape or by an
  engineer's default.
- **Two states only: `checked` and `cleared`.** `cleared` is the undo — a re-tap of an already-
  checked item retracts it, mirroring roll call's own undo grammar, so an accidental tap leaves a
  correction in the trail rather than a claim nobody can take back. There is deliberately no third
  "flagged missing" state: the issue describes one tap per item, not a second alarm vocabulary.
- **Checkpoint-independent.** Roll call happens once per dive; this happens once before the boat
  leaves. It renders above the checkpoint switch on both the live manifest and the offline copy,
  visible regardless of which checkpoint is selected.

### The offline design is additive, not a discriminated union

`OfflineRollCallEvent`'s own doc comment states the rule this follows: events already sitting in a
captain's IndexedDB were written to today's shape, and a discriminated union keyed on some new
`kind` tag would make every one of them fail to parse the moment the app adds a second event type.
So `OfflineChecklistEvent` is a **second, sibling array** on `OfflineManifestEnvelope`
(`checklistEvents`, beside `events`), not a widened roll-call event and not a union of the two. It
rides the *same* queue, IndexedDB store, manifest lock, and sync round trip — one POST to
`/api/offline-manifests/sync` now carries both arrays, and the client merges results from one flat
`results` list keyed by `clientEventId` (roll-call and checklist ids never collide, both being
`crypto.randomUUID()`). Nothing about `OfflineRollCallEvent`'s own shape changes, so
`OFFLINE_MANIFEST_RECORD_VERSION` does not bump — a bump would purge every roll-call event a
captain has queued and not synced, for a change that never touches that array.

### Deliberately simpler than roll call's offline reconciliation

`explicitResultAt`/`latestQueuedAttempt` in `offline-manifests.ts` carry real complexity — a
checkpoint dimension, a carried-forward default, and a "rescue an alarm from a rejection" asymmetry
that exists specifically to protect the missing-diver alarm from a stale device silently silencing
it. None of that applies here:

- No checkpoint, so no carry-forward chain to rebuild.
- No alarm to rescue — a rejected offline write falling back to the snapshot's last-known state is
  safe in either direction, because nothing recorded on this table is ever the loudest thing the
  app has to say.
- `canRecordOfflineChecklistCheck` is a single membership check ("does this snapshot know this
  item?"), unlike roll call's status-branching `canRecordOfflineStatus`/`canRecordOfflineCrewStatus`
  — both `checked` and `cleared` are always allowed once the item is known, since neither is a
  boarding claim.

What *is* kept, because the risk it guards against is real regardless of stakes: a `cleared` names
the `clientEventId` it retracts (`retractsClientEventId`), and the server refuses a retraction whose
named target is no longer the newest standing (`recordPreDepartureCheck`, mirroring
`offlineRetractionSuperseded`) — otherwise a device holding a stale copy could unsay a check a
different device made since.

### Where it lands

- **Settings**: `/shop/[shopSlug]/settings/safety-checklist`, a door row beside dive-sites and
  waivers (the same shape for "a shop maintains a list"), gated by the same
  `canPersonManageShopSettings` that gates the whole settings hub. Two plain buttons swap a row with
  its neighbor and write the whole order back (`reorderChecklistItems`) — not a drag library, for a
  list this short.
- **Manifest**: `PreDepartureCheckList` (live, server-action-driven) and a matching section in
  `OfflineManifestView` (offline, queue-driven) — opt-in by presence, the same rule the gear
  register follows: a shop with no items renders nothing, not an empty card.
- **Departure log**: a new `preDepartureCheck` section on the hashed incident-export document, one
  row per item with an explicit `checked`/not-checked state — absence is stated, never blank, the
  same rule every other field on that document follows, extended to a shop with no checklist at all
  (states so, rather than the section silently not appearing).

## Alternatives considered

**Folding the checklist into `gear_service_events`.** Rejected: that table is a unit's own care
history keyed to `gear_item_id`; a pre-departure line is not about any physical unit DiveDay tracks
(most shops have no gear register at all — it is opt-in by presence) and has no service clock.

**A generic "custom checklist" framework other features could reuse.** Rejected as premature. This
is the first checklist DiveDay has; building an abstraction for a second one that does not exist
yet is exactly the kind of speculative generality this codebase avoids.

**Widening `OfflineRollCallEvent` with an optional `checklistItemId` field instead of a second
array.** Rejected on the same grounds the type's own doc comment already gives for the diver/crew
subject split: a device holding queued roll-call events has no `checklistItemId` field and never
will, so a reader would have to treat its absence as meaningful for two entirely different reasons
(no crew id vs. no checklist id) — a second array keeps the two vocabularies from ever needing to
agree on what an absent field means.

## Consequences

- A shop can define its own pre-departure line, a crew can tap it offline and have it sync, and it
  renders on the departure log with explicit absences — the "Done when" bar the issue set.
- H-51 stays open until an owner decides whether an unchecked item should gate a departure. Nothing
  here changes if that decision goes either way: the writer, the events table, and the UI's tap
  targets are unaffected: only whether a refusal is *possible* upstream of them would change.
- The next feature that wants a shop-authored ordered list (checklist or otherwise) has a template
  to copy — `pre_departure_checklist_items`'s shape, `canPersonManageShopSettings`-gated CRUD, and
  the swap-and-rewrite reorder pattern — without inheriting anything checklist-specific.
