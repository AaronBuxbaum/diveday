# 20260828-a-missing-diver-gets-a-sentence — The roll-call note returns, on the alarm and its retraction only

- **Status:** Accepted
- **Date:** 2026-08-28
- **Amends:** issue #1058, which deleted the roll-call note outright

## Context

Issue #1058 deleted the roll-call note field end to end in 2026-08 — the component, the draft
store, `updateLatestRollCallNote`, the schema keys, and both `note` columns. The reasoning held on
its own terms: the field had no consumer under `src/`, its draft plumbing could only ever return
null, and the offline viewer still offered a box whose sentence went nowhere. A free-text field
hanging off every roll-call tap is noise, and the tree is smaller without it.

A `dive-domain-expert` review of the merged change found what went with it.

**A roll call can now record *that* a diver did not come back, and never *what happened to them*.**
Nothing else in the tree carries that sentence:

- The **departure log** timeline (`src/db/incident-export.ts`, rendered at
  `/shop/[shopSlug]/trips/[id]/log`) carries timestamp, checkpoint, subject, outcome and recorder.
  Seven fields, none of them prose.
- **Close-out** (`day_closeouts`) has a machine snapshot, an actor and a timestamp. Its only free
  text is `recapShoutout`, which is diver-facing marketing copy **emailed to every diver on that
  boat**. Writing "surfaced 200 m north, picked up by *Reef Runner*" there mails it to the roster.
- The manifest's **private staff note** is the closest survivor and fails on four counts: it is
  `print:hidden` so it never rides the sheet that goes ashore, it does not appear in the departure
  log, it is therefore outside that document's integrity hash, and it is a server action — so it
  cannot be written offline, which is precisely where a boat is when a diver does not surface. The
  glossary also says a staff note "is **never evidence**", so the product's own vocabulary rules it
  out for this.

The inversion that settled it: `pre_departure_check_events.note` still exists, rides the offline
queue, and prints on the departure log. A shop could write prose about "Life jackets counted" and
not about a diver who did not come back from dive one.

The cost is not hypothetical. The first questions from DAN, a coastguard, an insurer or the shop's
own counsel are *what did you observe, when, and who says so*. The two most common real outcomes —
"surfaced 200 m north, recovered by *Reef Runner* at 14:31" and "left early, signed out with
Marisol at the dock" — are both benign, and both were becoming an unexplained red row on a
tamper-evident document. An unexplained missing-diver mark reads far worse than an explained one.

## Decision

**The note comes back, and only where a person is unaccounted for.**

1. **After-dive checkpoints only.** `rollCallNoteAllowed` (`src/lib/roll-call.ts`) is the one rule,
   and it is `checkpoint !== "departure"`. At the dock `not_boarded` means "never left", which is
   a clerical fact that has never needed a sentence. After a dive it means "did not come back",
   which is the only state in the product that does. Both writers apply the predicate, so a note
   arriving on a departure event is dropped rather than trusted — the append-only safety trail
   takes no free text a surface never offered.

2. **On the event, never edited afterwards.** `updateLatestRollCallNote` stays deleted. The note
   rides the same form submit as the tap that states the alarm, so there is no draft to mirror, no
   second save to lose, and no way to rewrite what a crew recorded. That was the whole apparatus
   #1058 was right to remove; what it also removed was the sentence.

3. **One box per row, on whichever control is about to say something new.** While nothing is
   recorded, the exception control carries it — that control is about to state "not back aboard".
   Once the alarm stands, "Mark back aboard" renders beside it and takes the box over: that is the
   positive sighting worth describing, while the exception control's remaining job is `cleared`,
   which means "nobody said it" — a mis-tap, with nothing to observe. Never on an ordinary boarded
   tap: the common case, where everybody came back, stays a single tap with nothing to type. Two
   boxes asking one question, side by side on an alarmed row, is what the rule avoids.

4. **It rides the offline queue, prints, and reads back.** A diver who did not surface is the case
   where the boat is offshore, so the note is part of the queued offline event, not a server action
   layered on top. It renders in the departure log's timeline, inside the document the integrity
   hash covers. The snapshot carries it too, so the dock copy can *show* a sentence already on the
   record rather than offering an empty box on an alarmed row — writing without reading is how one
   observation becomes two. That addition is additive and optional, so no
   `OFFLINE_MANIFEST_RECORD_VERSION` bump is owed: a bump is a **purge** of every roll call a
   captain has queued and not synced. Where nobody wrote a sentence the key is absent rather than
   null, so a snapshot and a result with nothing to say are byte-for-byte what they were before the
   field existed.

## Alternatives considered

- **Keep the deletion; add a per-departure narrative to the hashed departure log.** More faithful
  to "the log is the record", and it would let a divemaster write the day up in one place. Rejected
  for now because it leaves the offline hole open — the narrative would be a server action, written
  ashore, hours after the observation it describes — and because it attaches the sentence to the
  departure rather than to the person it is about.

- **Leave the gap and file it.** Defensible while DiveDay is pre-pilot, and rejected because "There
  is no legacy. Delete it." governs dead code, not a promise about a safety record. H-02's
  retention and erasure commitments are explicitly not relaxed by pre-pilot status, and this is the
  same kind of obligation.

5. **It is erasable, and it leaves the shop.** The note is free text about a person, on a row that
   legitimately survives an erasure — the boarding fact is a safety record, the sentence about the
   diver is not — so `anonymize.ts` nulls it for the erased person's own bookings and, since a crew
   member is a person too, for the crew events about them. It rides the shop's CSV export like every
   other column, and stays out of the per-diver bundle for the reason that bundle already gives:
   free text on this table can name a *different* diver.

## Consequences

- Two columns return by migration, having been dropped days earlier. The erasure sweep and the
  export column come back with them, which is the half of a restore that is easy to forget: H-02's
  erasure promise is explicitly one of the things pre-pilot status does not relax. That churn is the honest cost
  of the round trip and is preferable to a shop discovering the gap on the day it matters.
- `rollCallNoteAllowed` is now the single place the rule lives. A surface that wants to offer the
  field elsewhere has to change the predicate, which is a decision, not a prop.
- The glossary's **Roll-call event** entry states the narrowed rule; it had been left describing
  the deleted field, and then briefly describing a record that carried no free text at all.
