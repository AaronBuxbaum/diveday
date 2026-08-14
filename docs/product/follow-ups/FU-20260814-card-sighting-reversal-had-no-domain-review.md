# FU-20260814-card-sighting-reversal-had-no-domain-review — Get a dive-domain-expert to read the imported-card confirm as it now stands

- **Status:** Open
- **Raised:** 2026-08-14 — branch `claude/decision-workflow-options-2n06b1`, implementing the owner's
  revision of H-24 (ADR 20260814-one-tap-imported-card-confirm).
- **Kind:** risk
- **Effort:** S
- **Touches:** `src/db/readiness.ts`, `src/db/nitrox.ts`,
  `docs/architecture/decisions/20260814-one-tap-imported-card-confirm.md`,
  `docs/product/human-decisions.md`

## What I noticed

The card-sighting attestation is gone from the imported specialty and nitrox confirms, on the
product owner's explicit instruction, and it went out **without a `dive-domain-expert` pass**.

That agent's review is what put the attestation there in the first place. H-24's original decision
records it as a `dive-domain-expert` finding: a one-tap confirm that opens a depth gate or authorizes
an enriched-air fill while asserting nothing is where the imported-card posture leaks. AGENTS.md's
hard rules name cert gating as a safety-critical surface that "gets boring code, failure-path and
adversarial tests, and a `dive-domain-expert` review". This change loosens exactly that surface and
had none.

The session that made the change could not spawn one — subagents were disabled for it — so this is a
gap in process, not a judgement that the review was unnecessary.

To be precise about what is and is not at stake, because the ADR's summary is easy to over-read:

- **The gate did not move.** An imported card still clears nothing until a staffer confirms it, per
  card, by hand. There is still no bulk confirm. `needsImportConfirm` still holds the blocker and the
  readiness tests still prove the gate stays shut before the tap.
- **What was lost is the record.** The trail keeps `reviewed_at` and who did it, but no longer
  distinguishes "someone saw the card" from "someone tapped a button".

## Why it isn't already done

The owner made the call with the trade-off stated in front of them — the option they picked was
labelled as the one I advised against, and they picked it anyway, which is their call to make. The
implementation follows it faithfully. What is missing is the second opinion on the *resulting* state,
which is worth having on its own terms rather than as a re-litigation of the decision.

I would not treat this as a question of whether to undo the change. Treat it as: given that every
imported card now confirms on one tap, is there anything a dive professional would want added
elsewhere — a queue of cards awaiting confirmation, a different default for nitrox specifically, a
prompt at the point of *boarding* rather than at the point of confirming?

## Proposed change

Run a `dive-domain-expert` review scoped to the current state of the imported-card confirm, and
record its answer as an amendment to ADR 20260814-one-tap-imported-card-confirm. Give it:

- `src/db/readiness.ts`'s `reviewSpecialtyCertification`, `src/db/nitrox.ts`'s
  `reviewNitroxCertification`, and `needsImportConfirm` in the divers `_components/shared.ts`.
- Both ADRs — 20260725-imported-card-sighting for the original reasoning, and the 2026-08-14 one for
  what replaced it.
- The H-24 row in `docs/product/human-decisions.md`, including its revision.

The question to put to it is *not* "should the attestation come back" — the owner answered that. It
is "with the attestation gone, is the per-card confirm still doing enough, and if not, what would you
add that is not a checkbox?" 20260725 itself suggests one candidate: a review surface listing every
card awaiting a sighting, which it named as the right answer to friction rather than a bulk tap.

If the review's answer is that the attestation is genuinely load-bearing for nitrox specifically —
a fill is the one outcome here that is chemical rather than procedural — that is worth putting back
to the owner as a narrower question than the one they were asked.

## Prompt

```text
Get a dive-domain-expert review of DiveDay's imported-certification-card confirm as it currently
stands, and record the outcome.

Read first:
  - docs/product/follow-ups/FU-20260814-card-sighting-reversal-had-no-domain-review.md (this file)
  - docs/architecture/decisions/20260814-one-tap-imported-card-confirm.md — what changed and why
  - docs/architecture/decisions/20260725-imported-card-sighting.md — the original reasoning, now
    superseded in part
  - src/db/readiness.ts (reviewSpecialtyCertification) and src/db/nitrox.ts
    (reviewNitroxCertification)
  - the H-24 row in docs/product/human-decisions.md

Context that stops this being a re-litigation: the product owner deliberately dropped the
card-sighting attestation on 2026-08-14, with the trade-off stated, to make the level, specialty and
nitrox confirms behave alike. Do not propose simply reinstating it. The gate itself is unchanged —
an imported card still clears nothing until a staffer confirms it per card, and there is still no
bulk confirm.

The question for the reviewer: with the attestation gone, is the per-card confirm doing enough, and
if not, what belongs there instead of a checkbox? 20260725 named one candidate itself — a surface
listing every card awaiting confirmation. Ask specifically whether nitrox deserves a different answer
from the recreational specialties, since a fill is the one outcome here that is chemical rather than
procedural.

Done means: the review has happened, and its answer is written into
docs/architecture/decisions/20260814-one-tap-imported-card-confirm.md as a dated amendment — including
"nothing further needed", if that is the answer. If the review recommends something the owner would
have to approve, put it in docs/product/human-decisions.md as a new question rather than building it.

Delete docs/product/follow-ups/FU-20260814-card-sighting-reversal-had-no-domain-review.md as part of
the change.
```
