# 20260827-support-needs-are-a-record-about-the-dive — Scoping an accessible-dive record

- **Status:** Accepted — built 2026-08-27 (issue #1043)
- **Date:** 2026-08-27
- **Issue:** #691
- **Relates to:** [20260821-the-ready-page-asks-once](20260821-the-ready-page-asks-once.md), [20260820-shop-divemaster-ratio](20260820-shop-divemaster-ratio.md), [20260821-currency-is-what-catches-people](20260821-currency-is-what-catches-people.md)

## Context

DiveDay takes accessibility seriously in one sense and has no concept of it in the other. There is a
whole `docs/design/accessibility-tradeoffs.md`, an axe scan over three dozen surfaces, a `glare-mode`
palette with >=44px targets and >=16px text, a reduced-motion kill switch, a focus-ring ADR with
measured contrast ratios, and a provider-coverage test that fails the build when a Spanish page
would silently blank.

And the *dive* — the activity the product exists to run — has no model of a diver who needs anything
different. Grep `src` and `docs` for `adaptive`, `wheelchair`, `mobility`, `prosthetic`, `deaf`,
`Diveheart`: zero hits, all six. The nearest thing is `rental_fit_profiles.note`, free text, whose
own schema comment offers the example "titanium hip, I run heavy" — the closest the product comes to
acknowledging that divers' bodies differ, and a note nobody structured.

Adaptive diving is not a fringe case. HSA, IAHD and Diveheart certify thousands of instructors,
adaptive programmes are a growing and high-margin line for exactly the shops in the Florida call
list, and the operational requirements are concrete and knowable in advance rather than improvised at
the dock: how many in-water support divers a participant needs, whether a transfer or hoist is needed
to get aboard and into the water, whether the diver communicates by sign or needs a briefing in
writing or a tactile signal set agreed with their buddy, equipment adaptations the prep list and gear
register would reserve, and sometimes a specific named support diver who must be on the same
departure and buddy team.

Every one of those is a fact the shop needs before the day and currently has nowhere to put — so it
lives in an email, in the free-text note, or in the memory of whoever took the booking.

The delight argument is the strongest one. This product's thesis is that competitors have the
features and DiveDay wins on experience. Turning up to a dive shop as a disabled diver and finding
they already know what you need, without having to explain it again, is one of the largest experience
gaps in the industry, and it costs a table and a panel.

## Decision

**The design below is accepted.** It was written ahead of the build and the build followed it
(issue #1043, 2026-08-27); what shipped is recorded in "What was built" at the foot of this record,
including the three places the code and this design deliberately differ.

### What is recorded

A **support-needs record on the person, not the booking** — so a returning diver is never asked
twice. It belongs beside `rental_fit_profiles`, which is already the "what does this body need"
record and already carries the `needs_staff_fit` safe-fallback pattern to copy.

Structured where the fact is operational, free text for the rest:

| field | why structured |
| --- | --- |
| in-water support divers needed | it changes what a departure needs; a number is the only form the ratio arithmetic can read |
| transfer / lift assistance | it changes what the boat and the crew must have ready |
| communication preference (sign, written briefing, tactile signals) | it changes how the briefing is delivered, which is a crew action |
| equipment adaptation | the prep list and gear register would reserve against it |
| a named support diver who must be on the same departure and buddy team | it is a scheduling and buddy-team constraint, not prose |
| anything else | free text, because a list of five fields cannot anticipate a body |

### Who is asked, and where

**The diver, on `/ready/[token]`, optionally, framed as "anything we should set up for you"** —
never as a medical question, and never on the public booking form, where it is a disclosure to a
stranger before a purchase. `/ready` is after the sale and is the diver's own page; ADR
20260821-the-ready-page-asks-once is the model.

### Who sees it

The crew, on the prep list and the manifest, in the same neutral tone the app uses for a dive-recency
answer or a staff-fit flag: **a fact to plan around, not a warning.**
`src/lib/dive-recency.ts`'s doc comment is the standard — "A shop seeing … beside a name is the
entire value; a refusal would be the software deciding a refresher question that belongs to a
divemaster."

### What it feeds

A support-diver requirement changes what a departure needs, and it feeds the ratio arithmetic **as
information**. `src/lib/divemaster-ratio.ts` is the model: it shows the target beside what is
rostered and binds nothing. `src/lib/course-ratios.ts` is not touched — those are agency standards
that really do refuse a seat, and no diver's support needs may move one.

### What it never does

**It never gates.** No readiness blocker, no booking refusal, no effect on any agency ratio. A shop
that cannot accommodate a request has that conversation with a human.

**It records what the dive needs, not what the person is.** No disability field, no medical
classification, no HSA/IAHD level on the diver. Every question above is about the *dive*,
deliberately.

**It is not marketed.** Nothing goes in `src/lib/marketing.ts`. A claim that DiveDay shops are
accessible is a claim about shops, not software.

### What it owes

Health-adjacent personal data, so the build owes rows in `src/db/export.ts`, `src/db/anonymize.ts`,
`src/lib/retention.ts` and `src/db/delete-path-coverage.test.ts`, and a `security-reviewer` review.
Copy in both locale bundles.

## Alternatives considered

**Structure `rental_fit_profiles.note` instead of adding a record.** Cheapest — the field exists and
already holds exactly this kind of information informally. Rejected: a note is a note, and the
support-diver count and the named-buddy constraint have to be read by arithmetic and by the buddy-team
builder, which cannot read prose. It also conflates "what gear fits this body" with "what this dive
needs set up", which have different readers and different lifetimes.

**Put it on the booking rather than the person.** Simpler lifecycle, and it allows for needs that
genuinely change per trip. Rejected because it re-asks the question every time, which is precisely
the experience failure this exists to fix. A per-booking override on top of a person-level record is
a reasonable later addition and should not block the first version.

**Ask on the public booking form.** It would reach divers who never open `/ready`. Rejected outright:
that is a disclosure to a stranger before a purchase, on a page a shop's competitors can also load.

**A medical-questionnaire-shaped set of yes/no conditions.** It would classify cleanly. Rejected as
the wrong question entirely — it records what a person *is*, invites a gate, and reads as an
interrogation at the exact moment the product is trying to say "we already know what you need".

**Build it now, in the batch that scoped it.** Rejected on the owner's call: the exact wording is the
part most likely to be wrong, it needs two reviews, and it deserves a change of its own rather than
riding along at the top of a six-layer stack.

## Consequences

Nothing ships from this ADR. What it buys is that the next session picking up issue #691 starts from
a decided shape rather than a blank page, and that the three things easiest to get wrong — asking on
the wrong surface, recording the person rather than the dive, and letting it gate — are written down
as refusals before anyone writes a migration.

The build should be treated as safety-adjacent in review even though nothing it writes can refuse
anyone: a crew that plans around a support requirement is relying on the record being right, and a
support-diver count silently lost between `/ready` and the manifest is a diver in the water without
the help they arranged.

## What was built (2026-08-27, issue #1043)

`dive_support_needs`, one row per person per shop beside `rental_fit_profiles`, upserted. The diver
answers on `/ready/[token]`; the crew reads it on the trip prep list and on the manifest; the
departure's total in-water support requirement is stated on prep beside nothing that could refuse it.
`src/lib/support-needs.ts` holds the codes, `src/i18n/support-needs-labels.ts` the words, both
locales the copy.

**All four refusals hold.** Nothing in `src/lib/readiness.ts`, `src/lib/trip-admission.ts`, or
`src/lib/course-ratios.ts` reads this record or imports its module; nothing about it appears on the
public booking form; every column asks about the dive; nothing went in `src/lib/marketing.ts`.

### What the two reviews changed

The build was reviewed by `dive-domain-expert` and `security-reviewer` before merge, as this record
required. The security pass found no tenant-isolation, authorization, token-scope or data-exposure
defect; two hardening notes were taken (every read of the table now goes through one projection
rather than selecting the row, and the redundant second index is gone). The domain pass changed the
design in four places, and they are worth stating because each is a question this record got wrong:

**The count needed a supplier.** "2 support divers" is the same sentence whether the shop must find
two people or the diver is bringing two, and the shop's action is opposite in each. Left as one
number, a participant travelling with their own volunteers makes a manager staff up for nobody, and
the reverse leaves a diver alone in the water — which is this record's own named failure mode.
`support_divers_provided_by` is now asked beside the count, paired to it by a check constraint, and
only the shop's half is summed into a departure's total.

**The water question covered entry only.** Getting an adaptive diver *out* is the manoeuvre crews
staff for — a tired diver, a ladder, sea state, more hands than the entry took. One flag now covers
both directions.

**The briefing options were all visual.** Sign language, writing and agreed signals are the wrong
set for a blind or low-vision diver, and "in writing" is exactly the wrong answer for one.
`briefing_aloud` was added.

**The ceiling refused illegibly.** Five in-water supporters is a real configuration for a first
open-water session, and the `max={4}` typo guard answered it with a browser validation bubble in the
wrong language on the one form that must never feel like a refusal. The bound stays; it now says so
on the field, and the field says what to do instead.

Four findings were filed rather than built, each as a `needs-triage` issue: carrying the record into
the offline manifest, checking the named support diver against the roster and showing it in the
buddy-team builder, a staff-side write path for arrangements taken over the phone, and an activity
trail entry so an overwritten arrangement is diagnosable.

## Amended 2026-08-27: staff may write the record too, and it is not marked when they do

The build gave the record exactly one writer — the diver's own `/ready/[token]`
page — and the ADR's reason for that stands: a record about somebody's own body
and how their dive has to be set up is theirs to state. But "the diver is the
author" and "the diver is the only one who can type it" are different claims,
and the second one was costing the thing this record exists for.

**Adaptive divers frequently book by phone**, precisely because they want to talk
to a human about arrangements before committing. A shop would take the whole
conversation — two support divers, a hoist, a briefing in writing — and have
nowhere to put it; the best it could offer was "go and find the link in your
email and type it in again". Walk-ups without a smartphone had the same problem.
And the prep panel already linked each diver's name to their staff record, where
the thing the staffer had just been reading was invisible, beside an editable
rental fit.

So there is a second door (issue #1069): a Dive support panel on the diver
record, beside the fit, writing through the same `saveSupportNeeds`. The
question stays on `/ready`. This is a second door, not a replacement.

It gates like the fit and for the same reason: recording arrangements nobody has
stated yet is data entry, open to whoever took the call, and overwriting what
the diver stated is the judgement call, on the same permission as overriding
their stated gear.

**A staff entry is not distinguishable from the diver's own, and that is a
decision rather than an oversight.** No `stated_by` column. A crew reading "needs
a lift in and out of the water" acts identically whether the diver typed it or
the shop typed it after speaking to them, and a badge saying "the shop wrote this
down" invites a crew to discount the arrangement — which is the failure this
record exists to prevent. The question such a badge would answer is already
answered better: every write leaves an activity-trail entry naming its author
(issue #1070), so "did this come from the diver's own link or from the shop" is a
fact on the record rather than a qualifier on the screen a crew works from. The
rental fit beside it makes the same choice.

## Amended 2026-08-27: the record does reach the offline manifest

The build shipped without it, as the conservative default rather than a considered answer, and the
trade was left written down here for a product-owner call. That call has been made (issue #1067):
**the whole record rides, the two free-text fields included.**

The argument against was real and is unchanged — this payload sits up to fourteen days in encrypted
IndexedDB on a deckhand's *personal* phone, which is exactly why the allow-list exists and why
`age`, `minor` and `birthday` were taken back off it, and support needs are health-adjacent facts
about disabled adults. What settled it is *where the record is read*. Boarding assistance is a
dock-side fact, where signal usually exists; a water lift and an agreed-signal briefing are
**mooring** facts, and at the mooring the offline copy is the only copy. This ADR names "a
support-diver count silently lost between `/ready` and the manifest" as the record's failure mode,
and a crew that cannot see it offshore is precisely that loss.

The equipment note and the named buddy ride rather than being trimmed as "a description of a
person", which was the narrower option. They are the most operational things here: "webbed gloves,
short fin" is what somebody packs, and a person you must be teamed with is the arrangement a crew
acts on at the rail. Shipping the flags and dropping the words would hand the boat a record it
could not act on.

One field is deliberately left behind. `statedAt` is not an arrangement — it answers "was this
diver ever asked", which the diver's own page reads and no crew surface renders — and it is a
`Date` in a payload that is otherwise JSON scalars, so it would come back a string wearing the
wrong type. The snapshot therefore carries `SupportArrangements` (`src/lib/support-needs.ts`), the
record minus that field.

It renders in `src/app/offline-manifest/` beside the rental fit, in the same neutral voice and
never as a warning, and only when something was stated — a line reading "nothing needed" down the
whole boat is the absence of information formatted as information. The field is optional and
additive on the snapshot, like `buddyTeamNames`, so a copy saved before this change still decrypts
and simply shows no record.

## Three deliberate differences from the design above

Each because the surface as built already answered the question:

**No sixth free-text field.** The table names "anything else — free text" as its last row. `/ready`
already carries exactly that question one row higher — "Anything else the crew should know?", saved
to `rental_fit_profiles.note`, whose own schema comment offers "titanium hip, I run heavy" as its
example. A second free-text box one row apart is the duplication `copy-restraint` deletes. Five
structured facts plus the note that already existed.

**The named support diver is a name, not a `people` reference.** The design says it is "a scheduling
and buddy-team constraint, not prose", which is why it is its own column. It is not a foreign key
because the diver is answering on a bearer-token page about somebody the shop may have no record of
at all. Resolving it to a booking is the later addition, and is not v1.

**Nothing was added to `src/lib/retention.ts`.** The design lists it beside `export.ts` and
`anonymize.ts` under "what it owes", and that turns out to be the wrong file. `RETENTION_DAYS` is a
bounded prune over **append-only trails**, and every window is measured from a row's own event time;
this is a living preference on a person with no event time and one row per diver, exactly like
`rental_fit_profiles`, which is also not in it. It is reached by erasure (`anonymize.ts`) and by
deletion of the shop, which are the paths a preference has. Adding a window would mean quietly
forgetting what a returning diver told this shop — the failure this record exists to prevent.
