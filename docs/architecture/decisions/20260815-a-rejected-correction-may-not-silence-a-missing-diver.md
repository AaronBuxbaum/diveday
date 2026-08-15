# 20260815-a-rejected-correction-may-not-silence-a-missing-diver — A rejected offline correction may raise the alarm, never lower it

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

The offline manifest reads a subject's result at a checkpoint from the device's own queued events
first and the saved snapshot behind them. When the latest queued attempt has been **rejected** by
the server, both readers fell back to the snapshot — never to an earlier non-rejected local event.
That rule is protecting something true: falling through to an older local event would re-assert the
stale optimism reconciliation exists to overrule (a "boarded" corrected to "not_boarded", the
correction rejected, and the diver still reading *Boarded* on the captain's screen).

It was applied symmetrically to two directions that are not equally dangerous. Crew mark a diver
**not back aboard** after dive 1; they queue a correction to boarded; the server rejects it (another
device wrote first, the booking moved, readiness changed). At an after-dive checkpoint the snapshot
usually holds nothing for that diver, so the row read **awaiting** — demoting the loudest row the
product has to a clerical gap, on the device the crew is holding, at the moment it matters most. It
never closed the checkpoint (`notBackAboard > 0` keeps it open regardless); it took the alarm off
the screen.

Raised by a `dive-domain-expert` review of the offline roll-call tie-break, filed as
FU-20260815-a-rejected-correction-can-silence-a-missing-diver.

## Decision

On a rejected latest attempt, the reader takes the **strongest** of {snapshot value, latest
non-rejected local event}, where only a stated *not back aboard* is eligible to win. Concretely, in
`explicitResultAt` (`src/lib/offline-manifests.ts`), shared by the diver and crew readers:

1. The snapshot is still the default on a rejection.
2. A local non-rejected event survives it **only** when `isNotBackAboard(checkpoint, …)` is true of
   it and the snapshot does not already say the same. A local `boarded`, or a local retraction,
   never survives a rejection — that is the optimism the server refused.
3. And only while it is **not older than what the snapshot states**. A stated "did not come back"
   outranks a *silence*, never a later sighting: on a two-device boat the second crew member
   records the diver back aboard on the live manifest, the next auto-save brings that home, and a
   rejection here must not re-raise an alarm two newer server statements have settled
   (dive-domain review, 2026-08-15).

**The asymmetry applies after a numbered dive and not at `departure`, and it is expressed through
`isNotBackAboard` rather than a checkpoint test of its own.** The two checkpoints carry different
claims: at `departure` `not_boarded` means *never got on the boat* — benign, genuinely accounted
for, and carried forward to every later checkpoint — while after a dive it means *did not return*.
There is no alarm at the dock for a rejection to silence, so there is nothing to weigh against the
stale-optimism rule; and `departure` is the one checkpoint where boarding is gated on readiness, so
a server refusal there is most likely to be a fact about the diver that this device cannot see.
Reading the scope off `isNotBackAboard` means the rule cannot drift from the one predicate that
already defines "somebody is missing" (DOM-H3).

## Alternatives considered

- **Rank `not_boarded` > `boarded` > absence outright** (as the follow-up first proposed) — that
  ranking also promotes a superseded `boarded` over the snapshot's silence, which is exactly the
  regression the existing test protects against. Alarm-only is the narrower, monotone rule.
- **Drop the snapshot fallback and always use the latest non-rejected local event** — the
  stale-optimism bug, restored.
- **Apply the asymmetry at every checkpoint** — buys nothing at the dock (no alarm exists there)
  and costs the readiness-refusal case, where the server knows more than the device.
- **Ignore rejections entirely on the device** — the screen would then disagree with what the
  server will say on the next sync, which is the class of bug this whole area keeps producing.
- **Let an *applied* local event survive a rejection** (dive-domain review, 2026-08-15). At
  `departure` this would re-assert a dock `not_boarded` the server accepted, so the row reads
  "not boarded · carried" rather than awaiting. Rejected on purpose: "ashore" is an
  **accounted-for** state — it closes the departure count and carries forward to every later
  checkpoint, which is the direction that stops people being looked for. Awaiting is the
  fail-open answer, and the rejection is precisely the signal that this device's picture is
  incomplete. The alarm direction is rescued because it can only ever hold a count *open*.

## Consequences

A rejected correction can now leave a row reading "not back aboard" that the server does not agree
with. That is the direction chosen deliberately: the checkpoint stays open and the crew keep
looking, rather than a checkpoint quietly reading as a clerical gap. The pending/rejected counts in
the header still say a correction needs attention, and the live manifest remains the authority.

Revisit if crews report chasing divers the server has already accounted for — the fix would then be
to surface *why* the correction was rejected on the row, not to restore the symmetric fallback.
Reverting is one function (`explicitResultAt`) and its tests.
