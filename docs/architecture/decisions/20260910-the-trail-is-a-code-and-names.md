# 20260910-the-trail-is-a-code-and-names — An activity row records what happened, not how to say it

- **Status:** Accepted
- **Date:** 2026-09-10
- **Amends:** 20260802-diver-data-erasure, on one column: the `activity_events` sweep now replaces a
  code and a payload rather than a sentence. The decision that record makes — what an erasure
  destroys and what it leaves standing — is unchanged, and the row it describes is corrected in
  place.

## Context

`activity_events` is the shop's append-only account of its own work: who did what, to which
departure or seat or diver, and when. Until now every row also carried **the sentence**, in English,
composed in `src/db` at write time and printed verbatim by `ActivityLog`:

```
`${booking.personName} checked in at the counter`
`${actor.name} added a private note about ${diver.name}`
`${scope.actorName} ${action}`          // and `action` came from a call site in src/app
```

Two things were wrong with that, and the smaller one is the rule.

`.claude/rules/domain.md` says `src/lib` and `src/db` return **codes, not sentences**, and
`pnpm check:domain-strings` is that rule's enforcement. It reported none of these, for a mechanical
reason: `looksLikeCopy` rejected any value containing an interpolation, on the sound theory that an
interpolation usually marks a value being *built* rather than prose. Every activity message
interpolates a name, so the largest run of domain-layer prose in the tree was invisible to the one
guard that existed to catch it — and its baseline was empty, which reads as "clean" rather than
"not looking". That half is fixed separately (#1655, first half): the guard now strips placeholders
and asks whether what remains is still a sentence.

The larger one is what a shop met. The trail read English whatever language its staff had chosen, on
a surface a Spanish-speaking shop reads all day. Nothing about the words was the shop's — they were
DiveDay's, chosen by DiveDay, in one language.

The **demo** made that worse rather than better. Eighteen of the seeded lines are desk work a real
shop does and DiveDay does not record for itself ("took Priya's deposit at the counter"), and the
demo is the surface an evaluating shop reads all day before deciding whether to buy.

## Decision

**A row holds a code and the names its sentence needs. The words are picked where the trail is
rendered.**

- `src/lib/activity.ts` closes the set: an `ActivityCode` union, and a parameter shape per code.
  `ActivityEntry` is a discriminated union of the two, so a writer that forgets a name is a compile
  error at the call site rather than a gap in a sentence on a shop's screen.
- `activity_events.message` becomes `code text not null` plus `params jsonb not null default '{}'`.
- `src/i18n/activity-labels.ts` turns the pair into a sentence over a new `activity` staff
  namespace, in both locales. It is server-side, like everything over that bundle; the three
  surfaces that show a trail hand `ActivityLog` finished strings.
- `recordTripActivity` and `recordDiverActivity` stop taking a phrase from the call site and take a
  typed entry, so a sentence about a crew member cannot be filed with a diver's name in it.

**The column is `text`, not an enum.** The set is closed by the union and by a test that walks every
code against both bundles; a new line of history should not cost a migration. `isActivityCode`
guards the read, and a code an older build does not know renders as one honest sentence rather than
a raw code or a throw — a real state for the seconds a deploy takes.

**There is no code carrying free text.** That would be the old column wearing a new name, and every
property below rests on its absence.

**The demo's lines are codes too**, under `demo_` names, with copy in both bundles and no writer in
`src/app`. The alternative was dropping them, which would have emptied the diver record's pager —
the seed exists to make that a rendered thing rather than a claim — and would have left the demo
showing less than the product can do.

**Existing rows are deleted, not backfilled** (`.claude/rules/db.md`, H-49). There is no mapping
from a free sentence back to a code, and DiveDay is pre-pilot.

## Consequences

**Erasure keeps its outcome and changes its mechanism.** Both statements in the `activity_events`
sweep now write `ACTIVITY_REDACTED` — `code: "redacted"`, empty payload — so an erased line still
reads `[redacted]`, and now does so in the reader's own language. Redacting only the payload would
have left the verb standing, which is more history than an erasure should leave behind on a person's
own record.

The fuzzy name match moves from the sentence to `params::text`. It matches **less**, not more: names
are the only free text left on the table, where before the pattern ran against a whole sentence. The
`\y` anchors, the minimum name length, and the logged match count are unchanged, and the hazard they
exist for — a two-character name as an unanchored pattern replacing most of a shop's history — is
bounded exactly as it was.

**The export carries the code and the payload.** `activity_events.csv` gains `code` and `params` and
loses `message`. Rendering a sentence there would need a locale the data layer deliberately does not
have, and a code plus its names is the more useful thing to hand a spreadsheet anyway. What leaves
the system is the same information.

**A new line of history costs two lines of copy.** Adding a code without its sentence fails
`activity-labels.test.ts`; adding it to one locale fails `pnpm check:locale`. That is the intended
friction: the previous cost of a new trail line was zero, which is how the pattern spread to sixteen
writers without anyone deciding it should.

## Alternatives considered

**Translate the strings in place in `src/db`.** A second copy mechanism for one table, which is
exactly what #1611 declined to build for a single call site.

**Keep `message` and add `code` beside it.** Dual-write, dual-read, and the free-text column still
there for the next writer to reach for. `.claude/rules/db.md` forbids the shape and the reason is
this one.

**Store person ids and resolve names at render.** Tempting, and wrong for history: a line saying who
did what in March should keep saying it after somebody is renamed, and a resolved-at-render trail
would rewrite the past every time a shop corrected a spelling.

**Leave the demo's lines as free text.** One escape hatch is all it takes; a seed file is still a
writer.
