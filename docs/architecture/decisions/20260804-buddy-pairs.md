# 20260804-buddy-pairs — Model buddy teams as booking pairs that inform roll call and never gate it

- **Status:** Superseded by [20260804-buddy-teams](20260804-buddy-teams.md)
- **Date:** 2026-08-04

## Context

Divers dive in pairs, and the state a real deck watches for is **one buddy back aboard while the
other is not** — the roll call was a flat list that could not say it (brainstorm, Safety And
Trust). The constraints come from the existing roll-call spine: `rollCallCompleteness`
(src/lib/manifests.ts) is the single definition of "this checkpoint is closed" and must not grow a
new input; the offline snapshot deliberately cannot know who came back (its `awaiting` comes from
device-local events, and its refusal to infer is a design position — ADRs
20260802/20260803-crew-roll-call); and this is a safety-critical surface, so the code must be
boring and every invariant DB-enforced where possible.

## Decision

1. **A pair is two roster entries — bookings — of one departure**, in one table,
   `buddy_pair_members`: one row per member, two rows per pair sharing a writer-generated
   `pair_id`. The unique index on `booking_id` is the authority that a diver is in at most one
   pair; it holds under concurrency, where a two-booking-columns-per-row shape cannot (a booking
   can sit in column A of one row and column B of another and satisfy both column uniques).
   `pairBuddies` (src/db/buddy-pairs.ts) is the only writer and inserts both members in one
   transaction; a lost race surfaces as the same `already_paired` refusal the pre-check gives.

2. **Pairs are exactly two.** A trio is two pairs' worth of a decision the shop makes — pair the
   strongest two and the third with a divemaster, or run two overlapping pairs on paper. DiveDay
   does not model a team of three, and the glossary says so (**Buddy pair**).

3. **Pairing is explicit, and so is unpairing.** Pairing an already-paired diver is refused
   (`already_paired`), never silently re-paired; self-pairing, a booking from another trip or
   shop, a cancelled seat, and a non-staff recorder are all refused server-side inside the
   transaction. Unpair deletes both member rows together — pairs are an operational grouping, not
   safety history; the roll-call events remain the append-only record of who was aboard. A pair
   whose seat is later cancelled stays listed (marked) and dissolvable, but contributes nothing to
   the manifest: a cancelled seat is nobody.

4. **The divergence is derived, per checkpoint, in the one manifest derivation.**
   `buddyAlertFor` (src/lib/manifests.ts) renders on the diver who is back: `separated_dock` at
   departure (heads-up, warning tone), `separated_after_dive` after a dive (the deck's signal,
   danger tone), and nothing for a buddy recorded ashore from the dock — a buddy who never left is
   accounted for on land. Words resolve through `src/i18n/buddy-labels.ts`; codes, never inline
   sentences.

5. **The alert informs and never acts.** It does not touch `rollCallCompleteness`, readiness,
   admission, or capacity; it blocks no boarding, auto-escalates nothing, and messages no one.
   (Today already chases the underlying head-count gap on its own terms; this feature adds the
   pair-shaped reading on the manifest, not a second escalation channel.)

6. **Offline displays pairs and computes nothing.** The snapshot carries `buddyFullName` — a name
   only, deliberately no booking id, so the divergence derivation is impossible offline rather
   than merely unimplemented; the panel states, in its established neutral register, that the
   split-pair read lives on the live roll call. The field is additive and optional, so
   `OFFLINE_MANIFEST_RECORD_VERSION` is not bumped (a bump is a purge; absence just shows no
   buddy).

## Alternatives considered

- **One row per pair with `booking_a_id`/`booking_b_id`** — cannot enforce one-pair-per-booking
  across columns with btree uniques; the race lands exactly on the safety surface.
- **Pairing people instead of bookings** — a buddy team is a decision about *this* boat; a
  standing person-level pairing would leak across trips and shops.
- **Modeling trios/teams of N** — explicitly declined (decision 2); it complicates the one signal
  ("your buddy is not back") into group arithmetic nobody on a deck does.
- **Letting divergence feed `rollCallCompleteness` or Today** — the completeness function is the
  fail-closed spine and takes no advisory inputs; an unclosed checkpoint already escalates.
- **Append-only pair history** — the roll-call events are the audit trail; pair rows carry
  `paired_by_person_id`/`created_at`, and exporting the standing pairs (`buddy_pairs.csv`) covers
  portability without a second event stream.

## Consequences

The manifest can now say the one sentence a deck actually asks for, and the seed demos it (two
paired teams on the reef boat, odd remainder unpaired). Costs committed to: a new table on the
booking spine (reset paths must delete it before bookings), one more panel on the manifest, and a
name-only field on every future snapshot. Escape hatch: if real shops need teams of three or
standing buddy preferences, that is a new decision superseding decision 2 — the membership-row
shape already admits N members per `pair_id`, so the migration is a constraint change plus new
derivation rules, not a new table.
