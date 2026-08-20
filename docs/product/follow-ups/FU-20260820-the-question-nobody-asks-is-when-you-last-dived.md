# FU-20260820-the-question-nobody-asks-is-when-you-last-dived — Currency, not rung, is what catches people

- **Status:** Open
- **Raised:** 2026-08-20 — the `dive-domain-expert` review of ADR 20260820-attested-at-booking-verified-at-boarding
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/components/DiveDeclarationFields.tsx`, `src/lib/readiness.ts`, `src/db/schema.ts`, `docs/product/glossary.md`

## What I noticed

The booking form now asks a diver what rung they hold and believes them. The reviewer's judgement on
the policy was that it is the right model and matches what real shops do — with one gap worth more
than everything the gate does catch:

> The claim that will hurt a Florida shop is not an inflated rung, it's an honest "Advanced Open
> Water" from 1998 with no dive since 2013.

Nothing on any form asks when the diver last dived. The only currency signal in the product is the
shop's own refresher-due date (`certifications.expires_at`), which exists solely on a card the shop
already holds — so it says nothing about a new customer, which is exactly the population the sale
gate now judges on their own words. That diver clears the sale, clears every readiness check the
moment a staffer sights their card, and arrives expecting a 30 m wreck.

## Why it isn't already done

The change that raised it was about *which* gate reads *which* rows. Currency is a new question with
its own modelling: it is not a card, it does not expire, and it is a self-report about behaviour
rather than about a credential — so it does not belong in `certifications` and probably belongs on
the booking or the person. It also needs a product answer about what the shop *does* with it, since
"last dived 2013" is a refresher conversation, not a refusal.

## Proposed change

Ask it where the level is asked ("When did you last dive?" — a coarse band, not a date: this season /
within a year / one to five years / longer / never), record it beside the declaration, and surface it
to staff on the prep list and the diver's record in the same warning tone a self-declared card gets.

Gate nothing on it. A shop seeing "Advanced Open Water · last dived 5+ years ago" beside a name is
the entire value; a refusal would be the product deciding a refresher question a divemaster should
have.

Not proposing: a dive-count field, a logbook, or anything that reads as verification. The answer is
worth exactly as much as the person's honesty and should be presented that way.

## Prompt

```text
Read docs/architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md, then this
file. This is a new question on a public form, so it needs an ADR of its own before code.

Add a coarse "when did you last dive?" band to src/components/DiveDeclarationFields.tsx beside the
level question, thread it through src/lib/dive-declaration.ts, and record it against the booking or
the person — decide which in the ADR, and do not put it in `certifications`: it is not a card.

Surface it to staff wherever a self-declared level renders (the prep list, the diver record, the
roster), in the same tone. Gate nothing on it.

Copy in both locales in the same change. Delete
docs/product/follow-ups/FU-20260820-the-question-nobody-asks-is-when-you-last-dived.md when it lands.
```
