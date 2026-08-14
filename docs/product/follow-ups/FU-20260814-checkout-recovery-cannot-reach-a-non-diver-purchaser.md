# FU-20260814-checkout-recovery-cannot-reach-a-non-diver-purchaser — Decide whether a shop can suppress an email address that has no diver behind it

- **Status:** Open
- **Raised:** 2026-08-14 — branch `claude/decision-workflow-options-2n06b1`, classifying
  abandoned-checkout recovery as commercial (ADR 20260814-checkout-recovery-is-commercial).
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/schema.ts`, `src/db/courtesy-email.ts`, `src/db/checkout-recovery.ts`,
  `src/app/unsubscribe/`

## What I noticed

The abandoned-checkout nudge now honours the courtesy-email opt-out and carries an unsubscribe link.
Both are resolved through `people`, by matching `booking_checkouts.customer_email` within the shop.

When that address answers to nobody, the send is refused — counted as `unaddressable` in the run
summary and left pending. That is the correct behaviour under the classification (a commercial mail
with no working way out of it should not go), but it means a real, if narrow, case now gets nothing:

**A parent books two seats for their children and pays with their own address.** The two divers have
`people` rows; the purchaser may not. They start a checkout, get distracted, and never finish. Before
this change they received a nudge. Now they receive nothing, and the shop loses a booking it would
have recovered.

I could not measure how often that happens. Both current callers of `startBookingCheckout` pass an
address that belongs to a person — `/ready/[token]` passes `ctx.data.person.email` outright, and the
public trip form passes the submitter's, who is normally one of the party — so my honest guess is
"rarely, today". It gets more likely the moment anything lets one person pay for a party they are not
in, which is an ordinary thing for a dive shop to want.

## Why it isn't already done

It needs a new table, and the branch it came up on was a consent fix. Building a suppression list in
passing would have meant deciding its erasure, export, and staff-visibility rules with no attention
on them — and those are the parts that matter, because the whole point of the table is that it holds
an email address belonging to someone with no other record in the system.

There is also a genuine question underneath, which is why this is filed as one rather than as a task:
**should DiveDay hold an address for someone who is not a diver, purely to remember that they said
stop?** A suppression list is a privacy improvement and a privacy cost at the same time. The
`no_email → no send` behaviour shipped today is the conservative reading, and it may simply be the
right permanent answer.

## Proposed change

If the answer is that the case is worth serving:

1. A shop-scoped `email_suppressions` table — shop, lowercased address, when, and which mechanism
   suppressed it. Not a person FK; that is the whole point.
2. `findCourtesyEmailRecipientByAddress` (`src/db/courtesy-email.ts`) gains a sibling that resolves
   an address to "suppressed or not" when no person answers, and the unsubscribe token path gains an
   address-keyed arm that writes into that table.
3. `src/db/checkout-recovery.ts`'s `unaddressable` branch becomes a send with an address-keyed
   unsubscribe link, and the counter stays for the case where even that cannot be built (no
   `publicAppUrl`).
4. Erasure and export have to answer for it: `src/db/anonymize.ts` already fuzzy-matches
   `booking_checkouts.customer_email` (there is a log event for it), so decide explicitly whether an
   erasure clears a suppression — I would say **no**, because a suppression is the person's own
   instruction and forgetting it would start emailing them again, which is the opposite of what
   erasure is for. State that in the ADR rather than leaving it to be inferred.

If the answer is that it is not worth serving, the change is one paragraph: record on H-09 that
DiveDay does not hold addresses with no person behind them, and that the recovery nudge is therefore
only ever sent to someone the shop already has a record for. Then this file is deleted with nothing
built, which is a perfectly good outcome.

## Prompt

```text
Decide whether DiveDay should keep an email suppression list for addresses with no diver behind
them, and implement whichever answer.

Read first:
  - docs/product/follow-ups/FU-20260814-checkout-recovery-cannot-reach-a-non-diver-purchaser.md
    (this file)
  - docs/architecture/decisions/20260814-checkout-recovery-is-commercial.md — in particular its
    "A shop-scoped email suppression list" alternative, which is this question
  - src/db/checkout-recovery.ts — the `unaddressable` branch
  - src/db/courtesy-email.ts — findCourtesyEmailRecipientByAddress and the person-keyed token path
  - src/db/anonymize.ts — how erasure already treats booking_checkouts.customer_email
  - the H-09 row in docs/product/human-decisions.md

The question is a privacy trade in both directions: a suppression list means holding an address for
somebody who is not a diver, purely to remember that they asked to be left alone. Refusing to hold it
is the conservative reading and may be the right permanent answer — in which case the deliverable is
one recorded decision on H-09 and no code at all. Do not treat "build the table" as the default
outcome.

If you do build it: it is shop-scoped and address-keyed with no person FK, the unsubscribe token path
gains an address-keyed arm, and you must state explicitly whether erasing a diver clears their
suppression (I would say no — forgetting an opt-out starts the emails again). Cover it in
src/db/export.ts and src/db/anonymize.ts in the same change, and get a security-reviewer pass, since
it is a new table holding personal data.

Run pnpm check plus pnpm test src/db/checkout-recovery.test.ts src/db/courtesy-email.test.ts
--reporter=dot.

Delete docs/product/follow-ups/FU-20260814-checkout-recovery-cannot-reach-a-non-diver-purchaser.md as
part of the change.
```
