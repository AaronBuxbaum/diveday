# 20260827-self-guided-departures — A departure may be marked self-guided, and the shop's own target stops applying to it

- **Status:** Accepted
- **Date:** 2026-08-27
- **Extends:** [20260820-shop-divemaster-ratio](20260820-shop-divemaster-ratio.md)

## Context

[20260820-shop-divemaster-ratio](20260820-shop-divemaster-ratio.md) gave a shop one advisory
diver:divemaster target and was explicit that it binds nothing. Its own reasoning for staying
advisory was that a shop knows things the number does not:

> A shop knows when today's four divers on one guide is two buddy pairs on a shallow reef, and a
> refusal it did not ask for is a refusal it will route around.

Issue #732 then put that target on the Today queue as `uncrewed_departure`, which fires for any
departure with divers booked and zero in-water crew — course session or fun dive alike. Its own
issue text anticipated the tension and decided to fire anyway, on the grounds that "a shop that
means it ignores it".

A `dive-domain-expert` review of that implementation (issue #973) pointed out that the reasoning
does not survive contact with a shop whose *ordinary product* is unguided. There was no schema
concept anywhere for "this dive is meant to run without a guide", and `MIN_DIVERS_PER_DIVEMASTER`
is 1, so a shop could not configure its way out either. A self-guided shore-dive operation would
have seen a warning-toned row at the top of Today on **every departure, forever**, with exactly one
way to silence it: roster a divemaster it did not want.

That is the same habituation the ratio ADR was written to avoid, arriving by a different door. A
refusal a shop routes around and an advisory row a shop learns to skip are the same failure, and the
cost lands on the row's credibility for the case it exists to catch — an instructor pulled off a
fully-booked DSD trip at the last minute.

## Decision

**`trips.self_guided`** (boolean, not null, default false). A shop ticks "Self-guided dive" on a
departure to say buddy pairs go in without a guide.

Three choices inside that, each of which could have gone the other way.

**Per departure, not per shop.** A shop-level "we don't require in-water supervision" setting is
cheaper and blunter: it would silence the row for the fully-booked course session too, which is the
case the row was built for. The fact is also genuinely per-sailing — the same shop runs a guided reef
charter on Saturday and an unguided shore dive on Sunday.

**The exemption lives in `divemasterRatioGap`, not at its callers.** That function's own docblock
says it exists so "the trip page and any later surface cannot disagree about the same sailing", and
an exemption applied per call site is precisely how they would come to disagree. `selfGuided: true`
returns `{ code: "none" }` before any arithmetic, so the Today queue, the trip Overview, and
whatever reads it next all get it at once and none of them can forget.

**It reaches the shop's own target and nothing else.** Agency training ratios
(`src/lib/course-ratios.ts`) are published safety caps that really do refuse a seat in
`createBookingRecord`, and no shop may switch one off by ticking a box on a departure: a course
session short of its instructor still raises `instructor_missing` with `self_guided` set, and
`courseCrewGap` takes no such parameter and must never grow one. Readiness, trip admission and
capacity never see this column at all.

**Amended 2026-09-04 (issue #1342): no trip-creation door writes the combination any more, and the
detector is unchanged.** The paragraph above describes the *output* for a course session carrying
`self_guided`, and that behaviour is correct and stays — `courseCrewGap` still takes no such
parameter. What it did not do was stop the state being stored, and the schedule builder offered the
checkbox in the same disclosed panel as the course picker.

**Why the combination is refused.** Not because a certification dive is always supervised — a
`dive-domain-expert` review of this change found that absolute contradicted by DiveDay's own course
catalog, where Emergency Oxygen Provider and Equipment Specialist are dry classroom courses, PADI's
Nitrox specialty has no training dives at all, and a Divemaster candidate's mapping project is
unguided by design. The load-bearing reason is narrower and true of every course we ship: the mark
silences *the shop's own advisory divemaster target* and reaches nothing else, and a departure that
runs a course has an instructor of record whether or not they are in the water, so that target is
exactly the signal that should keep applying to it. The glossary's **Target diver:divemaster ratio**
already says it applies to every dive, fun dive or course session alike; this restores that.

**The direction of error is the safety argument.** `divemasterRatioGap` returns `none` outright when
the mark is set, so coercing it to false can only ever *add* an advisory row, never suppress one.
Even in the Divemaster-mapping-project case the worst outcome is one extra advisory on a departure
that legitimately has no guide.

So `insertTripInstance` now coerces `self_guided` to false whenever `course_id` is non-null — there
rather than in `createTrip`, because it is the one function all three creation doors pass through
(`createTrip`, `duplicateTrip`, and the series horizon roll, which copies the template's flag
nightly and would otherwise re-mint the state forever). `updateTrip` applies the same rule, read
against the existing row's course rather than the patch's, since a departure's course is fixed at
creation and `UpdateTripPatch` carries no `course_id`. Both editors drop the checkbox rather than
ignoring it, and the board's sits *below* the course select so a tick cannot vanish above the fold
when a course is picked afterwards.

**Coerced, not refused, and that is deliberate.** Two of the three remaining callers have no human
to tell. A refusal in the nightly roll drops the date — the shop's Saturday silently never reaches
the board — and a refusal in `duplicateTrip` is a dead end a staffer cannot edit their way out of,
since the source's course is fixed. Both are worse failures than a normalized flag. The one human
case, a stale form post, cannot arise: neither editor renders the control.

**Not enforced in the schema, and that is a choice rather than an oversight.** A
`course_id is null or self_guided = false` check constraint would close the six seed modules that
insert into `trips` directly, and this repository does enforce twice elsewhere (see the glossary's
**Card sighting**). It is left out because two tests deliberately write the state behind the writer's
back to pin the "a row predating this rule still resolves correctly" case, and a constraint makes
those unwritable. The claim above is therefore about the creation doors, not about the column.

Such a row is not permanent, either: the trip's details form parses an absent checkbox as `false`
rather than `undefined`, so the first save of a legacy course session clears the mark.

The sentence above therefore now describes a state no creation door produces. It is kept, not
deleted: the detector's behaviour is the load-bearing half, and a row written out of band still has
to resolve correctly.

## Alternatives considered

**Leave it as shipped and wait for a shop to complain.** DiveDay is pre-pilot (H-49) with no usage
data, and the ADR's own "buddy pairs" scenario may be rarer in practice than the review worried. It
is the cheapest answer and it was genuinely arguable. Rejected because the cost of being wrong is
paid in the row's credibility rather than in a bug report: a shop that learns to skip a
warning-toned row does not file an issue about it, it just stops reading, and by the time anyone
notices, the row has failed silently for the one departure it mattered on. The column and its
default cost a shop that does not need it nothing.

**A shop-level setting** — "this shop doesn't require in-water supervision by default" — changing
the row's tone or suppressing it shop-wide. Cheaper, one row on the settings page, no per-departure
UI. Rejected as too blunt: it silences the row for the fully-booked DSD trip in the same stroke, and
"do we guide?" is not a property a real shop holds at the shop level — it holds it per sailing.

**Make `MIN_DIVERS_PER_DIVEMASTER` zero, letting a shop set a 0:1 target.** Would need no new
column. Rejected because zero is not a ratio: it makes the settings field mean two different things
at once ("how many divers per guide" and "do we use guides"), it silences the signal shop-wide
rather than per departure, and `divemastersNeeded` would have to special-case a divisor that cannot
divide.

**A per-course flag instead of a per-trip one.** A course is the wrong container: the departures
that are genuinely unguided are fun dives, and a course session is precisely where an agency ratio
applies and the mark must not.

**Suppress only `uncrewed_departure` and leave `crew_below_target`.** Rejected as incoherent. If a
departure needs no guide, "one short of your target" is not a smaller version of the same problem —
it is the same non-problem stated more quietly, and a shop that marked the departure and still got a
row would reasonably conclude the mark did nothing.

## Consequences

A shop that runs self-guided charters marks them and its Today queue goes quiet about crew for those
sailings. A shop that does not, notices nothing: the default is false and the column is invisible
until somebody ticks it.

The mark is a **statement**, not a permission. Nothing about it makes an unguided dive safe or
allowed; it records what the shop already decided so the software stops arguing. Nothing gates on it
and nothing should start to — a future reader looking for a place to hang "refuse to sail unless
guided" should hang it somewhere else, because this column means "the shop said so", which is the
wrong evidence for a refusal.

The cost of getting it wrong is asymmetric and mild in the direction that matters: a departure
wrongly marked self-guided loses an advisory row it was never obliged to act on, while every real
gate that could refuse a diver a seat is untouched.

`docs/product/human-decisions.md` H-51's open question — whether an advisory signal should ever
become binding — is unaffected. This ADR does not make anything binding; it narrows what an advisory
signal is advisory *about*.
