# FU-20260815-an-offline-retraction-is-not-a-compare-and-set — Make an offline `cleared` name the result it is undoing

- **Status:** Open
- **Raised:** 2026-08-15 — `security-reviewer` on the change that added `cleared` to the offline
  roll-call vocabulary (ADR 20260815-offline-can-unsay-a-missing-diver). Mitigated on the device in
  that change; the server-side gap is this entry.
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/lib/offline-manifests.ts`, `src/lib/offline-manifest-store.ts`,
  `src/app/api/offline-manifests/sync/route.ts`, `src/db/manifests.ts`,
  `src/components/OfflineManifestView.tsx`

## What I noticed

A device can now queue `cleared` — a retraction that returns a roll-call row to *awaiting*. The only
thing standing between a queued retraction and the server's current state is
`if (newest.occurredAt > occurredAt) return { ok: false, reason: "newer_event_exists" }`
(`src/db/manifests.ts`, both writers). That is a timestamp comparison, not a compare-and-set against
the event being retracted, and `appendOfflineRollCall` stamps `occurredAt` at tap time — so a
retraction tapped *now* beats anything recorded before now.

The sequence that goes wrong, with no malice and no bug in any single step:

1. 09:50 — device B records diver X **not back aboard** after dive 1. The missing-diver alarm.
2. 10:00 — device A, offline, holding a snapshot saved at 09:00 that still shows X as its own
   earlier mark. A crew member taps to undo it.
3. 10:05 — sync. `newest.occurredAt` (09:50) is not `>` 10:00, so the retraction applies. X reads
   **awaiting**: B's alarm is gone, and `src/db/today.ts` drops X from its `notBackAboard` count
   with it.

**Not a regression** — before `cleared` existed, that same re-tap queued `boarded`, which overwrote
B's mark *and closed the count*, which is worse. But the whole point of a retraction is that it is
the honest, narrow act, and right now it is the widest one on the surface.

The device-side mitigation already shipped: `OfflineRollCallResult.local` means the control only
offers a retraction over a statement **this device queued**, and a row whose mark came off the
snapshot says "Recorded on another device or on the live manifest — undo it there, not here."
That covers the case above. What it does not cover: a device that queued a mark, synced it, and
retracts it an hour later, by which time a second device has changed the row.

## Why it isn't already done

It needs a new field on the queued event, which widens `appendOfflineRollCall`'s input `Pick<…>` in
`src/lib/offline-manifest-store.ts` — outside the paths the change that raised this owned. It is
also a write-path change on the safety spine and deserves its own review rather than riding along
with three other decisions.

## Proposed change

Carry the identity of the result being retracted and make the writers compare-and-set:

- `OfflineRollCallEvent` gains an optional `retractsClientEventId` (additive; **no**
  `OFFLINE_MANIFEST_RECORD_VERSION` bump — a bump is a purge of every unsynced roll call, see that
  constant's docblock). `OfflineRollCallResult` already knows whether the reading is local; carry
  the event id through it so `OfflineManifestView` can name it.
- `appendOfflineRollCall` widens its `Pick<…>` to accept it; the sync route's zod schema accepts it
  and passes it through.
- `recordRollCall`/`recordCrewRollCall`: for `source === "offline" && status === "cleared"`, select
  the newest event's `client_event_id` alongside its `occurred_at` in the lookup they already do,
  and refuse with `newer_event_exists` unless it matches. An offline retraction naming nothing is
  refused outright once the device has been updated to send it — decide explicitly whether to keep
  accepting one for a transition window, and for how long (a device in a dry bag is the reason that
  question is not rhetorical).
- Tests: a retraction that still matches applies; one whose target has been superseded by another
  device is rejected and leaves the alarm standing; and the device marks it `rejected`, where
  `explicitResultAt`'s asymmetry already keeps the alarm on screen.

**Not proposed:** relaxing `newest.occurredAt > occurredAt` to `>=`. The equal case is deliberate —
an offline batch's second tap shares the first's timestamp under a coarse or frozen clock and must
still apply (`src/app/api/offline-manifests/sync/route.test.ts`, "applies a same-timestamp batch in
queue order").

## Prompt

```text
DiveDay's offline manifest can queue `cleared`, a retraction that returns a roll-call row to
awaiting. It is a blind newest-wins write: the only guard is `newest.occurredAt > occurredAt` in
recordRollCall/recordCrewRollCall (src/db/manifests.ts), which is a timestamp comparison, not a
compare-and-set against the result being retracted. So a device holding a stale copy can erase a
"did not come back from a dive" mark another device recorded.

Read docs/product/follow-ups/FU-20260815-an-offline-retraction-is-not-a-compare-and-set.md first,
then ADR 20260815-offline-can-unsay-a-missing-diver, the `source === "offline"` branches of both
writers in src/db/manifests.ts, and OfflineRollCallEvent + OfflineRollCallResult in
src/lib/offline-manifests.ts (note `local`, the device-side mitigation already in place).

Make the retraction name its target: add an optional `retractsClientEventId` to the queued event
(additive — do NOT bump OFFLINE_MANIFEST_RECORD_VERSION, which purges every unsynced roll call),
widen appendOfflineRollCall's input Pick in src/lib/offline-manifest-store.ts and the sync route's
zod schema, and have both writers apply an offline `cleared` only when the newest event at that
subject and checkpoint still carries that client event id.

Two constraints that make this non-obvious: `newest.occurredAt > occurredAt` must stay STRICT (an
offline batch's second tap shares the first's timestamp under the frozen e2e clock and must still
apply), and a retraction whose target has been superseded must be REFUSED rather than dropped
silently — the device marks it rejected and the alarm stays on screen, which is what ADR
20260815-a-rejected-correction-may-not-silence-a-missing-diver is for.

This is a safety surface and a write path: get a dive-domain-expert review and a security-reviewer.
Run pnpm check and pnpm e2e e2e/manifest.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260815-an-offline-retraction-is-not-a-compare-and-set.md as part of the
change.
```
