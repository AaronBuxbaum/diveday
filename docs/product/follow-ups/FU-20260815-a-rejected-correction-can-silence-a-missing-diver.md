# FU-20260815-a-rejected-correction-can-silence-a-missing-diver — A rejected offline correction demotes a recorded "not back aboard" to "awaiting"

- **Status:** Open
- **Raised:** 2026-08-15 — `dive-domain-expert` review of the offline roll-call tie-break
  (`fix/offline-roll-call-tie-break`). Pre-existing; that change made the tie case reachable and so
  surfaced it. It signed off the tie rule and raised this separately.
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/lib/offline-manifests.ts`, `src/lib/offline-manifests.test.ts`,
  `src/components/OfflineManifestView.tsx`

## What I noticed

Both device readers, when the latest queued attempt for a subject is `rejected`, fall back to the
**snapshot** — never to an earlier *non-rejected* local event. The sequence that goes wrong:

1. Crew mark a diver **not back aboard** after dive 1. The event applies.
2. Crew queue a correction to **boarded**. The server **rejects** it (another device wrote first,
   readiness changed, the booking moved).
3. The reader takes the latest attempt — the rejected correction — and falls through to the
   snapshot. At an after-dive checkpoint the snapshot usually holds nothing for that diver.
4. The row reads **awaiting**.

In the glossary's terms that demotes a **missing diver** — the loudest row the product has — to an
**unfinished head count**, the clerical one, on the device the crew are holding, at the moment it
matters most. It does not *close* the checkpoint, which is the part that is still safe. It takes
the alarm off the screen.

The documented reason for the snapshot fallback is sound and must survive any fix: falling through
to an older local event on rejection would re-assert exactly the stale optimism reconciliation
exists to overrule (a correction from "boarded" to "not_boarded" gets rejected, and the diver keeps
reading "Boarded"). The bug is that the rule is applied **symmetrically** to both directions when
the two directions are not equally dangerous.

## Why it isn't already done

It is pre-existing, it is a genuine design change on a safety surface rather than a defect with an
obvious patch, and the change that found it was scoped to the ordering question. Bolting an
asymmetry onto the rejected-fallback path in the same diff would have put two separate safety
arguments in one review.

There is also a real risk of over-correcting. The existing regression test — "falls back to the
saved result, not a superseded local event, when the latest crew attempt was rejected" — is
protecting something true, and a careless fix re-breaks it.

## Proposed change

Make the fallback **asymmetric** rather than abandoning it: a rejected event may never *downgrade*
a "not back aboard" that some non-rejected source states. Concretely, when the latest attempt is
rejected, take the strongest of `{snapshot value, latest non-rejected local event}` rather than the
snapshot alone — where "strongest" means `not_boarded` outranks `boarded` outranks absence, at an
after-dive checkpoint.

Both readers, one shared helper, exactly as `latestQueuedAttempt` already is. A test for each: an
applied `not_boarded`, then a rejected `boarded`, and the row still reads not back aboard.

Note the shape of the decision: at `departure`, `not_boarded` means "did not get on the boat", which
is administrative. At `after_dive_N` it means "did not return from a dive". Whether the asymmetry
should apply at both checkpoints, or only after a dive, is the question worth deciding deliberately
rather than assuming.

**Not proposed:** removing the snapshot fallback, or falling through to any older local event
regardless of direction. That is the stale-optimism bug the current code is deliberately avoiding.

## Prompt

```text
On DiveDay's offline manifest, a REJECTED correction can take a recorded "not back aboard" off the
screen and replace it with "awaiting" -- demoting the loudest row the product has to a clerical one,
on the device a crew is holding.

Read docs/product/follow-ups/FU-20260815-a-rejected-correction-can-silence-a-missing-diver.md first,
then `latestOfflineRollCall` and `latestOfflineCrewRollCall` in src/lib/offline-manifests.ts --
specifically the `syncStatus !== "rejected"` branch and the snapshot fallback under it -- and the
existing test "falls back to the saved result, not a superseded local event, when the latest crew
attempt was rejected".

The constraint that makes this non-obvious: that existing test is protecting something TRUE. Falling
through to an older local event on rejection re-asserts exactly the stale optimism reconciliation
exists to overrule. The fix is to make the rule asymmetric, not to remove it: a rejected event may
never DOWNGRADE a "not back aboard" that a non-rejected source states, while it must still never
resurrect a superseded "boarded". Take the strongest of {snapshot, latest non-rejected local event}.

Decide deliberately whether the asymmetry applies at `departure` too or only after a numbered dive.
At departure "not boarded" means they never got on the boat; after a dive it means they did not come
back. Those are not the same claim and may not want the same rule.

Apply it in both readers through one shared helper, the way `latestQueuedAttempt` already is -- the
two halves of one head count must not disagree. Test each: an applied not_boarded, then a rejected
boarded, and the row still reads not back aboard.

This is a safety surface: get a dive-domain-expert review. Run pnpm check and
pnpm e2e e2e/manifest.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260815-a-rejected-correction-can-silence-a-missing-diver.md as part of
the change.
```
