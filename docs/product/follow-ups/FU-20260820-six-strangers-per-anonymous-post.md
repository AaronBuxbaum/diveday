# FU-20260820-six-strangers-per-anonymous-post — Decide what the per-diver declaration does to the blast radius, and to "diver's word"

- **Status:** Open
- **Raised:** 2026-08-20 — `security-reviewer` (F2, F5, F7) and `dive-domain-expert` (finding 4) on the per-diver booking declaration
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/s/[shopSlug]/trips/[id]/actions.ts`, `src/db/bookings.ts`, `src/db/self-declared-cards.ts`, `src/lib/rate-limit.ts`, `docs/product/glossary.md`

## What I noticed

The booking form now asks each diver in a party what they hold, instead of asking
the booker once. That is the right shape — a party of four is four different
cards, and the old form screened one seat in four. Two consequences came with it
that nobody has decided on.

**1. One anonymous POST can now write onto six people's records instead of one.**
Every party member's email is free text the poster types, and each one resolves
through `findOrCreatePerson` onto a real `people` row. `RATE_LIMITS.booking` is
`perHour(10)` and unchanged, so the budget went from 10 claims/hr/IP to 60. The
existing controls still hold and are why this is a question rather than an
incident: each write costs a genuinely committed, roster-visible seat; the
anti-displacement rule drops the claim outright when the shop holds real evidence
of any kind; and H-13 skips the member whose name disagrees with the row it
resolved to. ADR 20260820 accepted this exposure explicitly — at one claim per
submission.

**2. "Diver's word" is now sometimes the organizer's word.** Every staff surface
renders a self-declared row as *"— diver's word, no card"*, and the glossary
defines a self-declared certification as "a level a **diver typed about
themselves**". For seats 2–6 that is false: Priya typed it about her kids. It
matters at the desk rather than in the abstract — a staffer uses that phrase to
decide how hard to push, and "the person in front of me said it" and "their mum
said it three weeks ago" are different situations with the same label. The two
wait lists write the same column for a genuinely self-reporting joiner, so the
phrase is true there and false here with nothing distinguishing them.

Related, cheap, and separable: **a deadlock vector** (F5). Previously at most one
`people` row lock per party; now up to six, taken in submitted order and held to
commit. Two parties on *different* trips naming the same two divers in opposite
order can deadlock; Postgres aborts one with `40P01`, which is not a
`PartyBookingError` and so surfaces as an unhandled server-action error rather
than a booking refusal.

## Why it isn't already done

The first is a product call about an accepted risk that just got six times
bigger, and the ADR that accepted it did so at the old size. The second is a
domain-vocabulary call with a schema consequence. Neither is an agent's to make.

Options for the blast radius, cheapest first:

1. **Leave it.** The seat cost is the real control and it is unchanged; a claim
   that costs a committed booking is not a spray attack.
2. **Scale the rate limit** by the number of declarations a submission carries, or
   add a second bucket keyed on that count.
3. **Honour a declaration only for the seat whose email the submitter is actually
   using** (index 0 — the one that gets the confirmation mail), and hold the other
   five as booking-scoped facts rather than person-scoped ones. This also answers
   the "diver's word" problem outright, at the cost of the thing the change was
   for.

For the vocabulary: either record **who stated it** (a `declared_by_person_id`, or
a "stated at booking" provenance distinct from "self-declared"), or change the
phrase for seats past the lead to something asserting no speaker — "stated at
booking, no card".

## Proposed change

Put both to the owner as H- rows rather than picking. My recommendation is option
2 for the blast radius (cheap, keeps the feature) and the `declared_by_person_id`
column for the vocabulary, because the staff-facing phrase is a provenance claim
and the fix is to make it true rather than to soften it.

Do the deadlock fix regardless of either answer — hoist `persistDeclaration` out
of the seat loop into one pass sorted by resolved person id at the end of the
transaction. That is a bug fix, not a decision.

And pin the invariant nothing currently asserts (F7): **a party refused at member
N leaves no certification row and no `no_certification_declared_at` stamp for
members 0..N-1.** It holds today only because `persistDeclaration` shares the
party transaction, and it is what stands between an anonymous poster and writing
onto five strangers' records at zero seat cost (post six members, make the sixth
an email already booked on that departure, collect `already_booked`, rollback).

## Prompt

```text
Read docs/architecture/decisions/20260820-attested-at-booking-verified-at-boarding.md
(especially Consequence 2 and the amendment) and src/db/self-declared-cards.ts
first.

The booking form now collects one certification declaration per party member
instead of one per submission, so a single anonymous POST can write a claim onto
up to six people's records. Three separable pieces of work:

1. BUG, do it regardless: `persistDeclaration` is called per seat inside
   `createBookingParty`'s transaction, so a party takes up to six `people` row
   locks in submitted order. Two parties on different trips naming the same divers
   in opposite order deadlock; Postgres raises 40P01, which is not a
   PartyBookingError and escapes the `.catch` as an unhandled server-action error.
   Hoist the declaration writes into one pass at the end of the transaction,
   sorted by resolved person id.

2. TEST, do it regardless: add a failure-path test to src/db/bookings.test.ts
   proving a party refused at member N writes NO certifications row and NO
   people.no_certification_declared_at stamp for members 0..N-1. Drive it through
   `already_booked` on the last member.

3. DECISIONS, do not pick these yourself — write them up as H- rows in
   docs/product/human-decisions.md: (a) whether the rate limit should scale with
   the declaration count now that one POST carries up to six, and (b) whether a
   declaration made by the party organizer about somebody else should keep being
   rendered as "diver's word" on every staff surface, or gain a
   `declared_by_person_id` / distinct provenance.

Done when: pnpm check is green, the new test fails if you revert the transaction
boundary, and the two H- rows exist. Delete
docs/product/follow-ups/FU-20260820-six-strangers-per-anonymous-post.md as part of
the change.
```
