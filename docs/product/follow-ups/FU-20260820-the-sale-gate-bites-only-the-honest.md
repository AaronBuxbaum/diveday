# FU-20260820-the-sale-gate-bites-only-the-honest — Decide what to do about the incentive gradient the booking gate now has

- **Status:** Open
- **Raised:** 2026-08-20 — the `dive-domain-expert` review of ADR 20260820-attested-at-booking-verified-at-boarding
- **Kind:** question
- **Effort:** M
- **Touches:** `src/components/DiveDeclarationFields.tsx`, `src/app/s/[shopSlug]/trips/[id]/actions.ts`, `src/lib/trip-admission.ts`, `docs/product/human-decisions.md`

## What I noticed

On a gated charter the certification question now sorts three answers like this:

- **"Advanced Open Water"** (true or not) — admitted.
- **"Rather not say"** — the select's default, and the field is marked optional — admitted.
- **"Open Water"**, said honestly by somebody who holds exactly that — **refused**, by a message
  that names the rung the trip wants.

So the only diver the gate stops is the one who answered truthfully and short, and the refusal hands
them the answer to give on the next submission — which then *persists* an inflated self-declared card
onto their record, where it flows into the deal list, blow-out offers and the seat-claim gate.

The ADR accepts self-attestation with open eyes, and that part is sound: this gate was never what
keeps anyone out of the water. But "can be talked past" and "punishes only honesty" are different
claims, and only the first one was decided.

A second, quieter version of the same shape: a diver who picks **"I'm not certified yet"** is now
recorded but still admitted onto a trip requiring a level. That is deliberate — a diver must not be
able to talk themselves out of a seat a staffer could have cleared them for, which
`self-declared-cards.test.ts` has pinned since the answer existed — but it does mean the product
hears "I have no card", says nothing, and takes the money.

## Why it isn't already done

Every option is a product call with a real cost on the other side, and the person whose business it
is has not made it. Making the question **required on a gated trip** removes the free "Rather not
say" path but adds a mandatory field to the highest-converting form in the product. Refusing a
declared-uncertified diver contradicts a tested rule and would be the first time a diver's own words
cost them a seat. Replacing the refusal with a *confirmation step* ("this boat needs Advanced —
continue?") keeps the sale and drops the gate to advice, which may be the honest description of what
it already is.

## Proposed change

Put the three options to the owner as an H- row rather than picking one:

1. **Leave it.** The gradient is the price of a gate that informs rather than enforces, and the
   population that lies to a booking form is small.
2. **Require the answer when the trip states a requirement.** Closes the "Rather not say" path;
   costs a required field.
3. **Replace the refusal with a stated-requirement confirmation.** No refusal, no gradient, and the
   diver still cannot say they were not told. This is the option that matches what the gate actually
   is now.

Whichever is chosen, the *"I'm not certified yet"* half should be answered in the same breath, since
it is the same question asked from the other end.

Do **not** implement any of them as a drive-by: each changes what a public form does to a sale.

## Prompt

```text
Read docs/architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md and its
2026-08-20 amendment first, then this file.

Ask Aaron which of the three options he wants for the booking form's certification question on a
gated trip: leave the gradient, require the answer, or replace the refusal with a confirmation step.
Ask about the "I'm not certified yet" answer in the same message — it is recorded today but never
refuses, and that is a tested rule, not an oversight.

Once he answers, add an H- row to docs/product/human-decisions.md recording the decision and its
reasoning, then implement it. If the answer is option 3, the refusal path in
src/app/s/[shopSlug]/trips/[id]/actions.ts stops being a refusal and `bookSpot`'s trip_prerequisite
arm may no longer belong on the public path at all — check H-30 before changing it, because that row
decided the refusal stays.

Delete docs/product/follow-ups/FU-20260820-the-sale-gate-bites-only-the-honest.md in the same commit.
```
