# Pilot-recruiting kit

The four things the founder carries into Phase 1: the leave-behind, the list of who to call, the
script for the first call, and the run sheet for the boat day. Written 2026-08-02 against the
Phase-0 state, for review action item 24 in the archived
[comprehensive-review-20260802.md](../archive/comprehensive-review-20260802.md) — now tracked as
[human-decisions.md](../human-decisions.md) H-31/H-32.

Everything in here is **preparation**. Not one line of it can be completed by an agent: the calls,
the entity, the attorney, and the boat day are the founder's, and this kit exists only so that the
next one of those costs an hour instead of a week. Progress on any of them is recorded in
[human-decisions.md](../human-decisions.md), never here — and `pnpm gates` prints how long each of
those rows has sat.

## What's in it

| Artifact | For | Where its outcome is recorded |
| --- | --- | --- |
| [Design-partner one-pager](../stakeholders/design-partner-one-pager.md) | The leave-behind: what DiveDay is, the offer, the three shop profiles, what happens next | Pilot commitments → V-04 and [rollout.md](../rollout.md) |
| [Florida call list](florida-call-list.md) | **A template.** Research criteria, columns, and how to source ten candidate shops | The filled list stays out of this repo; a booked conversation is the output |
| [First-call script](first-call-script.md) | Call one: discovery designed to disconfirm, not a pitch | A written call note per conversation; anything that changes the product goes to [story-backlog.md](../features/story-backlog.md) |
| [V-02 field-test run sheet](v-02-field-test-run-sheet.md) | The printable checklist for the boat day — "the single most important pre-pilot task" | V-02 in the [verification queue](../human-decisions.md#human-verification-queue) |

The stakeholder playbooks stay the authority on *who and how* for each conversation
([commercial-and-industry.md](../stakeholders/commercial-and-industry.md) for pilots,
[dive-operations.md](../stakeholders/dive-operations.md) for the boat day). This kit is the paper
that goes in the bag; it never carries status.

## What is deliberately blank, and why

**The call list has no shops in it.** Ten plausible-looking shop names with phone numbers would be
acted on — dialled, emailed, counted as pipeline — and there is no honest way for a session in this
repo to produce them. So [florida-call-list.md](florida-call-list.md) ships the qualification
criteria, the columns, the disqualifiers, and the exact public directories to work from, and the
rows stay empty until a human has actually looked a shop up.

The same rule governs the rest of the kit: the first-call script asks questions and does not
supply the answers, and the run sheet has blanks for observations rather than expected findings
written in advance.

## The claims boundary (read before editing anything here)

DiveDay has zero customers. Nothing in this kit may imply otherwise — no install base, no "shops
typically…", no usage patterns, no testimonials, no counts. The
[claims policy](../marketing.md#claims-policy-hard-rules) governs private collateral exactly as it
governs the public pages, and this is not hypothetical: the review flagged published copy
("most shops review… and import in one sitting") as fabricated usage proof. Advice and descriptions
of shipped behavior only.

Two more that bind every page here:

- **Never write the price as a figure.** It renders from `earlyAccessPrice` in
  `src/lib/marketing.ts`; say the live number out loud from the pricing page, never from paper.
- **Never improvise a commitment.** What is authorized today is in
  [rollout.md's offer](../rollout.md#the-offer-write-it-down-say-it-the-same-way-every-time) and
  H-12; anything a shop asks for beyond it gets written down and taken back, not agreed to in the
  room.
