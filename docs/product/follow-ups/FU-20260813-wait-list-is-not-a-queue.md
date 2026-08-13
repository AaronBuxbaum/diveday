# FU-20260813-wait-list-is-not-a-queue — Decide whether the wait list is a queue the diver holds a place in, or a list of leads the shop works

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/follow-up-decisions-xgj9o3`, a sweep of the codebase for
  policy questions the product currently answers by accident rather than by decision.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/db/waitlist.ts`, `src/db/schema.ts`, `src/db/today.ts`,
  `src/app/s/[shopSlug]/trips/[id]/page.tsx`

## What I noticed

The wait list has no order, and the code that describes it assumes one.

`trip_waitlist_entries` (`src/db/schema.ts`) carries a `createdAt` and an `invitedAt` and no position
of any kind. When a seat frees, nothing computes who is next: a staff member looks at the roster and
taps invite on whoever they choose, and `recordWaitlistInvite` stamps the row. The order divers
joined in is recoverable from `createdAt`, but nothing reads it that way outside the CSV export, and
no rule anywhere says it should be honoured.

Meanwhile two separate docblocks in `src/db/waitlist.ts` describe the future feature as *"auto-invite
**position 1** on a cancellation, with an expiring window"* — language that takes a queue for granted.
There is no position 1. There is a set of rows with timestamps.

The gap that matters is what the diver was told. A diver who joins a wait list on a full charter has
a very specific expectation, and it is the ordinary one everybody brings to the phrase: *I am in
line, and if someone drops out, the people ahead of me get asked first.* DiveDay does not say
otherwise on the public trip page, and it does not implement it. So the shop's most loyal regular can
be invited ahead of someone who joined three weeks earlier, and the earlier diver has no way to know
it happened — the invite is a private email, and the list is a staff surface.

Neither behaviour is wrong. What is wrong is that the product has not chosen, so the diver's
expectation and the shop's discretion are both live at once and only one of them can be satisfied.

Worth triaging alongside `FU-20260813-list-joiners-declare-nothing.md`, which is a different question
about the same list — that one asks what a joiner should be *asked* when they sign up, this one asks
what order they are worked in. They are independent (either can land first), but the answers
interact: a shop is far more comfortable honouring a strict queue if it knows in advance that
everybody in it can actually dive the trip.

## Why it isn't already done

The *mechanism* is already blocked on something else, and the *policy* was never the thing that was
blocked — which is how it got lost.

Both docblocks say stage 2 (auto-invite) is blocked on the H-09 notification-policy decision, and
that is accurate as far as sending goes: an automatic invite is an automatic send, and H-09 owns
consent and cadence. But H-09 has nothing to say about whether a wait list is ordered. That question
does not need a notification decision to answer, and answering it would tell the eventual stage-2
build what "position 1" is supposed to mean — which right now is undefined.

It is also genuinely two-sided. **A queue** is fairer, matches what divers already assume, and is the
kind of promise that is easy to keep and cheap to display. **A lead list** is what many shops
actually want: when one seat frees on a two-tank charter and the person at the top is an unpaid,
unwaivered first-timer while number four is a carded regular who can be at the dock in an hour, the
shop wants number four. That is not favouritism, it is the boat leaving on time. The composed
readiness gates make that scenario concrete rather than hypothetical.

**Recommendation: a queue with stated exceptions.** Order by `createdAt`, show the diver their
position, and let staff invite out of order deliberately — with the skip recorded, the way every
other consequential staff act in this codebase appends to a trail. That satisfies the expectation
without taking the shop's judgement away.

## Proposed change

Answer first; the two answers diverge immediately.

**If "queue" (recommended):**

- Ordering is `createdAt` ascending. No new column is needed — the data is already there; what is
  missing is anything that reads it as an order.
- The public trip page tells the diver where they stand when they join and on the confirmation, in
  both locale bundles. This is the whole point of choosing "queue"; a queue nobody can see is a lead
  list with extra steps.
- The staff roster shows the list in order and marks who is next.
- Inviting out of order stays possible and becomes a recorded act with a reason, following the
  pattern `buddy_team_events` and the roll-call trails already set.
- Write the ordering rule down where the stage-2 build will find it, so "position 1" has a
  definition before anything automates against it.

**If "lead list":** then the two docblocks in `src/db/waitlist.ts` must stop saying "position 1", the
public copy must set the honest expectation ("we'll be in touch if a seat opens" rather than anything
implying a line), and the eventual stage 2 needs a different design than the one those comments
assume.

Do **not** build the auto-invite in the same change. That is stage 2, it is genuinely blocked on
H-09, and bundling it would put a consent decision inside a fairness one. This change decides the
order and shows it; sending automatically stays where it is.

## Prompt

```text
Decide whether a DiveDay trip wait list is an ordered queue or an unordered list of leads, then make
the product say the same thing consistently.

Read first:
  - docs/product/follow-ups/FU-20260813-wait-list-is-not-a-queue.md (the full write-up)
  - src/db/waitlist.ts — note the two docblocks describing "auto-invite position 1" as though a queue
    exists, and recordWaitlistInvite, which stamps whichever row staff chose
  - the tripWaitlistEntries table in src/db/schema.ts — createdAt and invitedAt, and no position
  - src/app/s/[shopSlug]/trips/[id]/page.tsx — what a diver is told when they join
  - the H-09 row in docs/product/human-decisions.md

Two constraints:

  1. Do NOT build the auto-invite in this change. That is stage 2, it is genuinely blocked on H-09's
     notification-consent decision, and bundling it puts a consent question inside a fairness one.
     This change decides the ORDER and displays it; automatic sending stays where it is.
  2. No new column is needed for ordering — createdAt already carries it. What is missing is anything
     that reads it as an order and anything that tells the diver. Resist adding a position column.

If the recommendation is taken (a queue with recorded exceptions), done means: the staff roster and
the public join confirmation both reflect createdAt order; the diver is told their position in BOTH
locales under src/i18n/locales/; inviting out of order is still possible but appends a recorded event
with a reason, following the pattern already set by the buddy-team and roll-call trails; and the
ordering rule is written down where a later stage-2 build will find it.

Tests travel with it: unit tests for the ordering and the out-of-order record in src/db/waitlist.ts's
test file, and an e2e spec covering a diver joining a full trip and a staffer working the list.
Run pnpm check, then the focused tests with --reporter=dot.

Delete docs/product/follow-ups/FU-20260813-wait-list-is-not-a-queue.md as part of the change.
```
