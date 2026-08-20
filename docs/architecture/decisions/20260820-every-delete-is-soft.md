# 20260820-every-delete-is-soft — Delete is reversible underneath and says "delete" on top

- **Status:** Accepted — extends [20260719-crud-archive-semantics](20260719-crud-archive-semantics.md)
  to every entity, and reverses the vocabulary half of it
- **Date:** 2026-08-20

## Context

[20260719-crud-archive-semantics](20260719-crud-archive-semantics.md) established soft removal for
six entities — divers, certification cards, dive sites, courses, gear, trips — and asked the UI to
"explain what history is preserved". Two things followed from that, and both are wrong.

The first is coverage. A rule that names six entities is a rule about six entities: `deleteTrip`
(`src/db/trips-schedule.ts`) hard-deletes a departure and five child tables, guarded only by a
refusal when a roster, wait list, or roll-call evidence exists. Every entity added since decided its
own answer, and the answer drifted.

The second is what a shop reads. The vocabulary landed on the screen: 49 strings across the diver
roster, the dive-site library, and staff settings say **Archive**, **Unarchive**, **Archived**,
**Archiving…** — plus a sentence beside each one explaining which history survives. That is our
storage decision leaking into a shop's afternoon. The person clicking it wants the diver gone from
their lists. "Archive" makes them stop and work out whether that is the same thing as deleting, and
the explanatory sentence makes them read a paragraph to find out. Reversibility is a promise we keep
for them, not a concept they should have to hold.

Against that sits erasure, which is genuinely different: [20260802-diver-data-erasure](20260802-diver-data-erasure.md)
destroys a person's identifying and medical data for good, because a legal obligation says we must
be able to. A reader who confuses those two loses data permanently.

## Decision

**Every deletion is soft.** A user pointing at a thing and asking for it gone sets a `deleted_at`
timestamp; the row stays and history holds. This is the default for every entity, not a list — a new
table carrying anything a user can delete gets `deleted_at` and a live-rows-only partial index, and
active-workspace reads filter it. The column is `deleted_at`; `archived_at` is not a second spelling
of it.

**The word is "Delete."** Never Archive, Unarchive, Deactivate, Retire, Hide, or "soft delete" in
anything a person reads — button, confirm, toast, notice, list filter, or empty state. A staff-facing
list of deleted records is "Deleted" and its action is "Restore". No sentence explains what was
preserved: under [copy-restraint](../../design/principles.md) a caption that reassures the reader
about an outcome they did not doubt earns nothing.

**Two exceptions, and only two.**

1. **Legal erasure.** Where an obligation requires actual destruction, the destructive path stays,
   stays separate from `deleted_at`, and stays one-way (`people.anonymized_at` and the
   `people_anonymized_stays_removed` check constraint). This is the one case where the distinction
   *is* expressed, because the reader is choosing between two different outcomes and one of them
   cannot be undone: erasure copy names what it destroys and says there is no undo. It never becomes
   the primary action, and it never borrows the word "delete" on its own.
2. **Machinery nobody pointed at.** Rows a user never named as a thing: the bounded retention prune
   of append-only tables (H-02's windows), child rows rewritten wholesale when their parent is saved
   (`trip_dives`, `trip_schedule_days` — a replace, not a deletion), single-use tokens consumed on
   use, and seed or test teardown. These are not deletions of anything a shop can see.

This does not touch **"There is no legacy. Delete it."** That rule governs the *tree* — a table
nothing writes gets dropped, a code path nothing reaches gets deleted, and a destructive migration
still carries its `-- diveday:allow-destructive` line. This one governs *rows at runtime*. Dropping a
dead table and soft-deleting a diver are both still right.

## Consequences

Every active-workspace query filters `deleted_at is null`, and a uniqueness constraint over
user-supplied identifiers goes partial on the live rows so a name or email frees up when its record
is deleted — with the restore path refusing a collision rather than resurrecting a duplicate
(`restoreDiver`). A shop is never one mis-tap from losing a season of history, and support never
needs a database restore to undo one.

Two migrations of existing tree follow, neither of them done here: `deleteTrip` becomes a soft
delete, and the 49 archive-vocabulary strings (plus their `es-ES` pairs and the e2e specs that assert
on them) become delete-vocabulary. Renaming those buttons moves pixels in the visual spec, so that
change carries its own triage.

## Alternatives considered

- **Keep "Archive" as the visible word.** Rejected: it is our storage model on a shop's screen. The
  reader has to translate it before acting, and the translation is a paragraph.
- **Say "Delete" but hard-delete underneath, matching the word exactly.** Rejected: it makes a mis-tap
  unrecoverable and breaks the historical joins that manifests, audits, and past bookings read. The
  word we owe the reader is the one that describes their intent, not our storage.
- **A per-entity call, as the 2026-07-19 ADR left it.** Rejected: that is what produced the drift,
  and "is this one soft?" is a question no shop should be able to feel the answer to.
- **Show a countdown ("deleted records purge in 30 days").** Rejected: it re-introduces the
  explanatory paragraph and commits us to a purge we do not want. Deleted is deleted, and it stays
  recoverable.
