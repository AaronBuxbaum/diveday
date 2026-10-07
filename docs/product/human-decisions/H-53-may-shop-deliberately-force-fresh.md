# H-53: May a shop deliberately force a fresh signing round on its current waiver text?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**May a shop deliberately force a fresh signing round on its current waiver text?** Raised by a `dive-domain-expert` pass over PR #739 (issue #720): re-saving a waiver with identical text now publishes nothing, closing an *accidental* republication that would have invalidated every standing signature. What is left is the *deliberate* case — the insurer or post-incident scenario, where counsel says get fresh signatures on the current text. There is no control for that today, and a shop that wants one finds the workaround in about ninety seconds: type a space, publish. That writes an invisible, untracked edit to a legal instrument and a version number asserting a change that did not happen. Sits beside H-01/H-03; the answer changes what a shop can tell an insurer.

## Minimum outcome to record

A yes/no on building a "require everyone to sign again" act that supersedes standing signatures without publishing a version, or an accepted no with the workaround left undocumented.

## Unblocks / follow-up

**Decided 2026-08-22 (Aaron Buxbaum): no.** DiveDay does not build a "require everyone to sign again" act — the 365-day validity window already delivers most of what a shop means by a fresh signing round, and a second superseding mechanism is not worth the surface. The space-and-publish workaround stays undocumented by this decision; if a reviewer later thinks the `unchanged` banner needs a sentence about it, that is a separate, smaller call. Note the deliberate **asymmetry with the sibling decision on issue #738** (answered yes, not yet recorded as its own row here): a shop may declare an edit *non-material* and keep standing signatures, but has no lever to invalidate standing signatures early — both directions of the same question now have a recorded answer.

Part of the [human decision log](README.md#decision-register).
