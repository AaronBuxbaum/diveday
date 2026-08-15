# FU-20260815-offline-cannot-unsay-missing-without-claiming-aboard — Offline has no "cleared", so undoing a mis-tapped "not back aboard" means asserting the person is on the boat

- **Status:** Open
- **Raised:** 2026-08-15 — `dive-domain-expert` review of the offline roll-call tie-break
  (`fix/offline-roll-call-tie-break`). Pre-existing. The review named this as the place the
  "hard to undo" asymmetry actually belongs, having argued it does *not* belong in the tie-break.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/lib/offline-manifests.ts`, `src/components/OfflineManifestView.tsx`,
  `src/i18n/locales/en-US/staff/`, `src/i18n/locales/es-ES/staff/`,
  `src/app/api/offline-manifests/sync/route.ts`

## What I noticed

The live manifest's controls (`RollCallControls.tsx`) can emit **three** things: `boarded`,
`not_boarded`, and `cleared` — the undo, which returns a row to *awaiting*. The offline event
vocabulary has only two: `OfflineRollCallEvent["status"]` is `"boarded" | "not_boarded"`.

Two consequences at the rail, and the first is the sharp one:

- **The two surfaces degrade differently on a mis-tap.** Online, tapping an already-active "Not back
  aboard" sends `cleared`: the row returns to awaiting and the count stays open and chased.
  Offline, the only neighbouring control queues **`boarded`** — a positive claim that this person is
  back on the boat — with no confirmation step, from buttons that stack full-width and adjacent on a
  phone. One errant thumb, on a wet screen on a rolling boat, converts the app's loudest alarm into
  green.
- **The honest correction is unavailable.** "I didn't mean to say she's missing" and "I have eyes on
  her, she's aboard" are different statements. Offline can only make the second one, so the record
  shows a positive sighting that nobody actually made.

## Why it isn't already done

Pre-existing, and outside the ordering change that surfaced it. It is also genuinely two decisions
wearing one coat, which is why this is a question rather than a task:

1. Should the offline vocabulary grow `cleared`, so a retraction can be *recorded* as a retraction?
   That widens `OfflineRollCallEvent`, the sync route's schema, and both recorders — and needs care
   about whether it is additive enough to avoid an `OFFLINE_MANIFEST_RECORD_VERSION` bump, which is
   a purge that discards every roll call a captain has queued and not synced.
2. Should asserting `boarded` over an active *not back aboard* require a confirming second tap?
   That is a UX call about the one screen where a confirmation dialog might genuinely be worth its
   friction, and the product's instinct everywhere else is to avoid them.

They are separable. (2) is much cheaper and closes the dangerous half.

## Proposed change

Smallest first, and (2) above is the one worth doing even alone:

1. **Confirm before asserting aboard over a missing mark.** At an after-dive checkpoint, when a row
   currently reads *not back aboard*, require a second tap naming the person — "Confirm Maya is
   aboard" — before queuing `boarded`. Names the person deliberately: a generic "Are you sure?" is
   the kind of dialog people learn to dismiss.
2. **Consider adding `cleared` to the offline vocabulary**, so the retraction is recorded as one
   rather than as a sighting that never happened. Decide the version-bump question explicitly: if it
   cannot be made additive, it is probably not worth a purge on its own.

**Not proposed:** making a "not back aboard" mark permanent or hard to reverse. The review was
direct about this — crews mis-tap constantly (wet hands, sun glare, a rolling boat, the row above
the one you meant), and if a false missing-diver mark is sticky, the crew stops using the control
and the loudest row in the product becomes the one nobody dares tap. The events are append-only and
both statements survive in the departure log either way; what is at issue is only what the *screen*
says, and how easily a thumb can change it.

## Prompt

```text
On DiveDay's offline manifest, the only way to undo a mis-tapped "not back aboard" is to tap
"Mark aboard" -- a positive claim that the person is back on the boat -- with no confirmation, from
a full-width button directly beneath it. The live manifest has a third option offline lacks:
`cleared`, which returns the row to awaiting.

Read docs/product/follow-ups/FU-20260815-offline-cannot-unsay-missing-without-claiming-aboard.md
first, then:
  - src/components/OfflineManifestView.tsx -- the diver and crew control rows
  - src/app/shop/[shopSlug]/trips/[id]/manifest/_components/RollCallControls.tsx -- the live
    controls, which DO emit `cleared`, and how they decide when to
  - src/lib/offline-manifests.ts -- OfflineRollCallEvent["status"], and the
    OFFLINE_MANIFEST_RECORD_VERSION docblock, which explains why a bump is a PURGE of queued roll
    call and is almost never worth paying

Do the confirmation step first; it is separable and closes the dangerous half. At an after-dive
checkpoint, when a row currently reads "not back aboard", asserting `boarded` should take a
confirming second tap that NAMES the person ("Confirm Maya is aboard") -- a generic "Are you sure?"
is the kind of dialog people learn to dismiss without reading.

Then decide, separately, whether `cleared` should join the offline vocabulary so a retraction is
recorded as a retraction rather than as a sighting nobody made. If that cannot be done additively
without an OFFLINE_MANIFEST_RECORD_VERSION bump, say so and probably do not do it -- a bump
discards every roll call a captain has queued offline and not synced.

Do NOT make a "not back aboard" mark sticky or hard to reverse. Crews mis-tap constantly, and an
alarm that cannot be retracted is an alarm crews stop raising.

Every string goes in src/i18n/locales/<locale>/staff/, both en-US and es-ES, in the same change
(pnpm check:locale); read src/i18n/locales/es-ES/README.md before writing Spanish. This is a safety
surface -- get a dive-domain-expert review. Run pnpm check and
pnpm e2e e2e/manifest.spec.ts --reporter=line, and re-shoot any affected visual capture. Delete
docs/product/follow-ups/FU-20260815-offline-cannot-unsay-missing-without-claiming-aboard.md as part
of the change.
```
