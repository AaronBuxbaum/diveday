# 20260902-crew-requests-and-blackouts — The crew get a voice on the staffing week, and it informs rather than gates

- **Status:** Accepted
- **Date:** 2026-09-02
- **Extends:** [20260806-staffing-is-the-shift-roster](20260806-staffing-is-the-shift-roster.md)

## Context

Staffing shipped as the **owner's shift roster**. ADR 20260806 settled what the page is — who is
working, which departure has nobody, and one link to the surface that can actually crew it — and
every write on it is the owner's. Nobody on the crew can say *"I want that one"* or *"I am away that
week"*.

That is a whole product elsewhere. DiveCrewPro launched in March 2026 at $49/month with exactly one
idea: pros see the upcoming classes they are eligible to teach, tap **request**, and the owner
approves in one click; pros keep blackout dates that refuse a request and flag an assignment when a
class moves. Its pitch is "the end of spreadsheets to manage your pros' class assignments", and the
owner-sentiment sweep in `docs/product/assessments/competitive-landscape-20260901.md` records
instructor scheduling and pay as a recurring pain across five distinct sources, with the Business of
Diving survey quoting *"too many instructors at our shop, it dilutes the number of available
students"* (issue #1235).

The reason this is a decision rather than a feature is that it adds a **second actor writing to the
week**. Until now the staffing week had one author. A crew member writing to it raises three
questions the shift roster never had to answer: what may they write, what does a blackout *do*, and
what happens when the owner says yes.

## Decision

**The crew get two writes of their own — a blackout and a request — and both inform rather than
gate. An approval assigns nobody; it runs the ordinary assignment mutation.**

### 1. Two small tables, both shop-scoped and soft-deleted

`crew_availability_blocks` (person, an inclusive range of **calendar dates**, an optional note) and
`crew_assignment_requests` (trip, person, `requested_at`, and a nullable `decision` with its author
and moment). Both carry `deleted_at`, like every table holding something a user can delete (ADR
20260820-every-delete-is-soft).

Two shapes are load-bearing:

- **A blackout is calendar dates, not instants.** "I am away the week of the 14th" has no clock in
  it. Storing a timestamp would make the range shift under a reader in another zone, and the week's
  own columns are already calendar dates (`src/lib/staffing-week.ts`).
- **A decided request is kept, not deleted.** "I asked and was turned down" is the fact the crew
  member came back to check, and a shop declining the same person three Saturdays running should be
  able to see that it did. Deleting is *withdrawing*, and only the asker may do it.

### 2. A blackout does exactly two things, and no third

1. It **refuses a request** the crew member themselves makes for a departure it covers. Being told
   at the moment of asking is cheaper than an owner discovering it a week later.
2. It puts a **warning word** beside an assignment that overlaps it.

It does **not** remove anyone from a boat, and it does not refuse an assignment the owner makes. The
owner crews the shop; a shorthanded Saturday with somebody's holiday on it is a conversation, and a
roster that silently dropped a name would be worse than one that says something. This is the same
line ADR 20260804-buddy-teams draws for the split-team alert and ADR 20260806 draws for a crew gap:
**inform, never gate.**

### 3. Approving runs `changeTripCrew`, and writes no assignment of its own

`decideCrewAssignmentRequest` stamps the decision and hands its caller the trip and the person. The
assignment itself goes through `changeTripCrew` (`src/db/trips-crew.ts`), where the agency training
ratio, the course rules and the roll-call-history guard already live.

If the decision wrote a `trip_assignments` row directly it would be a **second, weaker path onto a
boat** — the exact shape ADR 20260803-not-ready-is-a-view and ADR 20260804-day-closeout's "no second
detector" refuse. A request is a request; the roster is still the one thing that crews a departure.

### 4. Who may write what

- A crew member writes **their own rows**: their blackouts, their requests, their withdrawals.
  Nobody asks on somebody else's behalf — a request is a statement about what *you* want to work,
  so roster rights buy nothing there.
- Somebody who can **manage the roster** may record a blackout for anyone (a phone call on a
  Sunday) and is the only one who may **answer** a request. That second half is checked twice, and
  never through the "yourself, always" branch: a crew member approving their own ask is precisely
  what this table exists to prevent.
- Every check is a live database read of the actor's roles, not a session claim — the same
  discipline `activeStaffAttestorId` applies to a paper waiver. A person removed from the shop this
  morning must not be able to book themselves onto Saturday's boat this afternoon.

## Consequences

- The staffing week grows a second reader: it draws a crew member's own blackouts as quiet chips,
  and pending requests in the gap's day beside the departure they are for.
- `src/lib/crew-requests.ts` is the pure half — `blockCoversMeetings`, `overlappingBlocks`,
  `crewRequestRefusal` — and the surface evaluates the same rule the write does, so the affordance
  is never offered for something the transaction will turn down.
- A departure is placed by **the days it meets**, not by `starts_at`: a Thursday-to-Saturday course
  overlaps a Friday blackout. That is `staffing-week.ts`'s existing rule, and this reuses it rather
  than deriving a second one.
- **Not built, deliberately:** pay, commissions, a second scheduling surface, and any notion of
  *qualification*. Whether a divemaster may teach an Open Water course is the course-ratio module's
  question and is answered when the assignment runs, not when the request is made.

## Alternatives considered

**A blackout that removes the person from the boat.** The strongest reading of "I am away", and the
one DiveCrewPro's pitch implies. Rejected because it makes the crew's own statement able to
*uncrew* a departure the owner has already committed to, silently and at a distance — a Saturday
charter losing its second divemaster on the Thursday somebody books a holiday. The shop is the one
holding the liability for who is in the water; a warning word gives it the fact and leaves the
decision where it belongs.

**A blackout that refuses the owner's assignment, not just the crew member's request.** Softer than
removal, and still wrong: a shop knows things the roster does not (the person offered to come in, the
range was typed a month ago and no longer holds), and a validation error at the moment of crewing
would send the owner to delete a blackout that is not theirs before they can staff their own boat.

**Approving writes the assignment here.** Fewer moving parts, one transaction, and it was the first
shape drafted. Rejected because `changeTripCrew` carries the agency training ratio, the course rules
and the roll-call guard, and an approval path that skipped them would be a second way onto a
departure with a *weaker* set of checks than the one an owner uses. The rule this repository keeps
returning to — no second detector, no parallel table — applies just as well to no second assigner.

**Qualification on the request.** DiveCrewPro shows pros only the classes they are "eligible to
teach", and the issue's own words are "any course session or departure they are qualified for".
Deliberately not built: eligibility is the course-ratio module's judgement and it is already made,
correctly and with the trip's own facts, when the assignment runs. Duplicating it at request time
would be a second, staler answer to the same question — and a crew member asking for something they
turn out not to be qualified for costs one honest "no" from the owner, which is a conversation the
shop was going to have anyway.

**One table with a nullable `trip_id`** — a blackout as a request with no departure. Tempting for
the symmetry, and rejected on reading: the two rows answer different questions, carry different
columns (one has a date range, the other a decision), have different owners for their writes, and
would need a check constraint per column to keep the halves from bleeding. Two small tables cost one
extra migration and nothing else.
