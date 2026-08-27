# 20260827-support-needs-are-a-record-about-the-dive — Scoping an accessible-dive record

- **Status:** Proposed — design accepted, build deferred
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

**The design below is accepted. The build is deferred to its own focused change**, because it needs a
`dive-domain-expert` review of whether these are the right questions and a `security-reviewer` review
of health-adjacent personal data, and because asking badly is worse than not asking.

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
