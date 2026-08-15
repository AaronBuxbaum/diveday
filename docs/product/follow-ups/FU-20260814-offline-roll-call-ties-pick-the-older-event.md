# FU-20260814-offline-roll-call-ties-pick-the-older-event — Decide what "newest wins" means when two offline results share one timestamp

- **Status:** Open
- **Raised:** 2026-08-14 — building the offline crew roll call (H-46, closing
  FU-20260812-offline-roll-call-copy-overstates-the-crew-half). Found by an e2e failure, not by
  reasoning: the frozen test clock made two taps share an `occurredAt` and the *first* one won.
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/lib/offline-manifests.ts`, `src/lib/offline-manifests.test.ts`,
  `src/db/manifests.ts`

## What I noticed

Both device-side readers pick "the latest attempt" for a subject at a checkpoint by sorting the
queued events on `occurredAt` alone:

```ts
events
  .filter((event) => event.bookingId === bookingId && event.checkpoint === checkpoint)
  .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]
```

`latestOfflineCrewRollCall` right below it does the same thing with `crewPersonId`. `Array.sort` is
stable, so when two events carry the *identical* `occurredAt` string the comparator returns 0 for
every pair and `[0]` is whichever event was **pushed first** — the older tap, not the newer one.

The case a person would see: a captain taps "Mark not back aboard" for a crew member, realises
immediately it was the wrong row, and taps "Mark aboard" within the same millisecond-resolution
timestamp. The row keeps reading **Not back aboard** until the two events reach the server, which
orders them correctly and disagrees with the screen the captain is holding.

This is **pre-existing on the diver path** — `latestOfflineRollCall` has always had it — and the
crew half inherits it by mirroring, deliberately. It is not a regression from that change.

Two things bound how bad it is today, and neither is a guarantee:

- `occurredAt` is `nowDate().toISOString()`, millisecond resolution. Two deliberate taps a
  millisecond apart is not a human rate, so in production this is close to unreachable.
- The e2e fleet **freezes the clock** (`src/test/frozen-clock.ts`), so in every test every offline
  event for one subject shares one timestamp and the tie is the *normal* case, not the edge. That
  is how this surfaced: an unscoped `.first()` in `e2e/manifest.spec.ts` queued two results for one
  crew member and the display kept the first.

## Why it isn't already done

Two reasons, and the second is the one that matters.

It is outside the change I was given: that change's invariant I4 says to mirror `recordRollCall`'s
offline branch rather than invent a crew variant, and the same logic applies to the readers beside
it. Fixing the tie in `latestOfflineCrewRollCall` alone would make the two halves of one head count
disagree about ordering, which is worse than the tie.

More importantly, **the right tie-break is a judgement call I should not make quietly on a safety
surface.** Three candidates, and they are not equivalent:

1. **Insertion order** — break the tie on the event's position in `envelope.events`, which is
   append-only, so "last pushed" is genuinely the last tap on this device. Correct for one device,
   and says nothing across devices.
2. **A monotonic sequence on the event** — a counter or a higher-resolution stamp written at
   `appendOfflineRollCall`. Correct, and additive (the same widening trick this change used, so no
   `OFFLINE_MANIFEST_RECORD_VERSION` bump), but events already in a captain's IndexedDB would carry
   none and would need a defined ordering against ones that do.
3. **Leave it and make the server the only authority** — argue the display may be briefly wrong and
   reconciliation fixes it. That is the current behaviour, unstated.

The server side has the same shape and is not obviously the same answer: `recordRollCall` and
`recordCrewRollCall` both refuse an offline event only when `newest.occurredAt > occurredAt`, so an
event with an *equal* timestamp is accepted and, being appended later, wins. The device and the
server therefore already break this tie in **opposite directions** — the device keeps the older,
the server keeps the newer. Whichever way this is settled, it should be settled the same way in
both, and that is the part worth a human's attention rather than a drive-by.

## Proposed change

Pick one rule, apply it in all four places, and assert it.

Recommended: **option 1 for the device, matching the server.** Break the tie on insertion order so
the later-queued event wins, which is what the server already does with equal timestamps, and it
needs no new field and no version bump:

- In `latestOfflineRollCall` and `latestOfflineCrewRollCall` (`src/lib/offline-manifests.ts`),
  replace the `.sort(...)[0]` with a reduce that keeps a later-indexed event when the comparison is
  a tie — or sort on `[occurredAt, index]` — so the two functions stay line-for-line diffable.
- Add a test to `src/lib/offline-manifests.test.ts` for each: two events, one subject, one
  checkpoint, identical `occurredAt`, opposite statuses; the later-queued one is what renders.
- State the rule in a comment where the sort is, naming the server's equal-timestamp behaviour it
  matches, so the next reader does not have to re-derive that the two agree.

**Not proposed:** do not "fix" this by making the e2e clock advance. The frozen clock is what makes
the visual baselines pixel-stable (AGENTS.md's clock rule), and the tie it exposes is real code
behaviour, not a test artefact. Nor should the crew reader be fixed on its own — see above.

## Prompt

```text
On DiveDay's offline manifest, two queued roll-call results for the same person at the same
checkpoint that share an identical `occurredAt` are ordered by JS sort stability, so the **older**
tap is what renders. The server, given an equal timestamp, keeps the **newer**. The device and the
server break the same tie in opposite directions and nothing says so.

Read docs/product/follow-ups/FU-20260814-offline-roll-call-ties-pick-the-older-event.md first, then
`latestOfflineRollCall` and `latestOfflineCrewRollCall` in src/lib/offline-manifests.ts and the
`source === "offline"` branches of `recordRollCall` / `recordCrewRollCall` in src/db/manifests.ts.

Decide one tie-break rule and apply it in both device readers so they stay diffable side by side —
the recommendation in the entry is insertion order (later-queued wins), which matches the server and
needs no new field on `OfflineRollCallEvent` and therefore no OFFLINE_MANIFEST_RECORD_VERSION bump.
A bump is a purge: it discards every roll call a captain has queued offline and not synced, so do
not take an approach that needs one without saying why.

Done is: both readers agree, a test in src/lib/offline-manifests.test.ts pins the tie for a diver
and for a crew member (identical occurredAt, opposite statuses, later-queued one renders), and a
comment at the sort names the server behaviour it matches. This is a safety surface — the screen
says who came back from a dive — so get a dive-domain-expert review.

Run pnpm check and pnpm e2e e2e/manifest.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260814-offline-roll-call-ties-pick-the-older-event.md as part of the
change.
```
