# 20260804-buddy-teams — Buddy teams of any size, crew included, with an append-only pairing trail

- **Status:** Accepted
- **Date:** 2026-08-04

Supersedes [20260804-buddy-pairs](20260804-buddy-pairs.md), whose "a pair is exactly two bookings"
rule and delete-on-unpair storage this decision replaces.

## Context

[20260804-buddy-pairs](20260804-buddy-pairs.md) shipped buddy pairing on the manifest with three
constraints that operators have since contradicted:

1. **A pair is exactly two.** Real boats dive in threes and fours, and a divemaster commonly leads a
   group rather than buddying one person. The original ADR's answer to a trio — "pair the strongest
   two, buddy the third with a divemaster" — was unrecordable in the very model that recommended it.
2. **Both members hold a booking.** Crew hold no booking (see the glossary's **Crew roll-call event**),
   so a diver deliberately placed with a divemaster printed on the incident export identically to a
   diver nobody paired. On the one document where the difference matters, "accompanied" and
   "unaccompanied" read the same.
3. **Unpair deletes both rows.** The original ADR declined an append-only history on the grounds
   that "the roll-call events are the audit trail". That holds for the live product and fails on the
   incident export: roll-call events say nothing about who was paired with whom, so buddy was the
   only fact on an authority-facing document with no corresponding timeline entry. A pairing could
   be rewritten or erased after an incident with no mark — and cancelling the missing diver's
   booking removed the pairing pointing at them as a side effect.

**Not every shop does buddies at all.** That is a normal boat, not a gap, and it constrains the
design as hard as the cases above: nothing here may make an unrecorded team look like a finding.

## Decision

**A buddy team has two or more members, and a member is either a booking or a crew person.**

- `buddy_pair_members` keeps its table name (its history is already applied) and becomes team
  membership: `booking_id` and `crew_person_id` are both nullable with a check constraint that
  exactly one is set. The existing unique index on `booking_id` stands — **a diver is still in at
  most one team per departure**, which is the invariant that makes the manifest unambiguous.
- **A crew member may appear in more than one team.** A divemaster leading three separate buddy
  groups is one person accountable to several, which is how guided diving actually runs. Crew
  therefore get no uniqueness constraint, and the "at most one team" rule is a statement about
  divers only.
- **Two is not special.** Nothing enforces a maximum. A team of one is refused — a team needs
  someone to be a team with — and the UI never offers it.

**Pairing and unpairing are recorded, not just applied.** A new append-only `buddy_team_events`
table carries one row per act: the team, the action (`formed` / `dissolved` / `member_added` /
`member_removed`), who recorded it, when, and **the member names as they stood at that moment**.
Names are denormalised deliberately: the trail's whole job is to survive the membership rows being
deleted, so it cannot resolve them by id afterwards. The incident export renders these in the
roll-call timeline it already has, which carries corrections without laundering them.

**Nothing here becomes a gate.** Team membership still informs and never acts: it does not touch
readiness, admission, capacity, or roll-call completeness, and a split team raises attention on the
live manifest only. The incident export continues to state the recorded pairing and its provenance
and to compute no verdict about it.

## Alternatives considered

- **Keep pairs of two and add a separate "guided by crew" flag.** Two concepts where operators have
  one, and it still cannot express a trio of divers with no crew in it.
- **Rename the table to `buddy_team_members`.** Honest, but a rename migration on applied history
  buys a clearer physical name and nothing else; the domain word is already "team" everywhere a
  human reads it (the manifest panel has said "Buddy teams" since the first slice).
- **Soft-delete membership (`dissolved_at`) instead of an event table.** Smaller, but records only
  the latest dissolve and forces an is-live filter into every reader. It also cannot represent a
  member joining or leaving a team that still exists, which teams of N make ordinary.
- **Unique constraint on crew membership too.** Would forbid the guided-group model this ADR exists
  to allow.

## Consequences

- `buddyAlertFor` stops being a two-body question. A team is **split** when at least one member is
  recorded back aboard and at least one is not — the same fail-closed reading as before, generalised.
- The manifest, offline snapshot, CSV export, and incident export all carry a team's members as a
  list rather than a single buddy. The offline snapshot stays name-only, so divergence remains
  impossible to compute off the boat rather than merely unimplemented.
- The incident export gains pairing events in its timeline, closing the one fact on that document
  that had no audit trail.
- A seat cancelled after departure still removes that member from the live manifest's team — the
  live alert must never accuse someone who is not aboard — but the **event trail retains them**, so
  the incident document can still say who was paired with whom before the cancellation.
- Shops that record no teams are unchanged and unremarked: the roster column says a blank is not a
  claim that anyone dived alone.
