# 20260820-shop-divemaster-ratio — One advisory diver:divemaster target replaces "Divers per departure"

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

`shops.shore_group_size` — labelled "Divers per departure" — was the shop's only stated opinion
about how big a group it runs. Three things were wrong with it.

**It was asked of the wrong shops.** The field only appeared when boat diving was off, on the
reasoning that a boat shop's answer is its hull's seat count. That reasoning holds for *seats* and
not for anything else: a twelve-seat boat is a fact about the boat, and says nothing about how many
people one divemaster should have in the water off it. A boat shop had nowhere to state the thing it
actually briefs its crew on.

**It was the wrong grain.** "Divers per departure" is a property of an outing. The number a dive
shop actually reasons with is a ratio — 5:1, six to a guide — and it is the same number whether the
outing is a two-tank morning, a shore dive off the beach, or an Open Water session. Storing the
coarse form meant the ratio had to be re-derived, or guessed, everywhere it mattered.

**Almost nothing read it.** One caller: the Requests planner (`src/lib/request-advisor.ts`), which
divided a day's requested divers by it to invent a departure count. On a beach, "two departures" is
an object the shop does not have — there is no hull to fill twice, only more or fewer guides in the
water.

Sitting beside all this, and easy to confuse with it, are the **agency course ratios** in
`src/lib/course-ratios.ts`: PADI's published 8/+2/12 for Open Water training dives and the tighter
Discover Scuba figure (H-08, HD-6). Those are safety caps sourced from an instructor manual, and
they really do refuse a seat in `createBookingRecord`.

## Decision

**One shop-wide target, `shops.divers_per_divemaster`, asked of every shop, applying to every
dive.** Stored as the divers half of the ratio: `5` is "5:1". It covers fun dives and course
sessions alike, because the question — how many people does one divemaster take into the water —
does not change when the outing has a syllabus attached.

**It binds nothing.** No booking is refused by it, no manifest is held up by it, no crew change is
blocked by it. A shop may crew a departure however it likes; DiveDay shows the departure against the
target and suggests a divemaster count, and that is the whole of its authority. The one definition
lives in `src/lib/divemaster-ratio.ts`, whose only reportable state is `under_target`.

**It is measured and reported separately from the agency caps, never merged with them.** A shop
typing a generous number here cannot loosen PADI's published ratio, and typing a tight one does not
tighten it. Where a course session is short of both, the two sentences say different things: the
agency cap is *why a seat was refused*, the target is *what the shop wanted its own boat to look
like*. Merging them into one number would have made a shop preference look like a safety control,
which is the more dangerous direction of the two.

**Who counts as a divemaster for it: everyone supervising in the water.** `countInWaterCrew`
(`src/lib/crew-roles.ts`) splits instructors from certified assistants because the agency ratios need
the split. This target adds them: an instructor guiding a fun dive is guiding it, and a shop that
rosters two instructors and no divemaster has not left the water unsupervised.

**`shore_group_size` is dropped, not carried.** Pre-pilot, no users, H-49. The Requests planner now
sizes a boatless day as one departure of the people who actually asked, and recommends the
divemasters the target implies — for boat shops too, where the hull already answers the seat
question and never answered this one.

**Not null, defaulting to 6.** Every suggestion needs a number, and a null would only be a second
spelling of the default with a branch at every read. Six to a guide sits mid-range in ordinary
recreational practice; it is a starting point visible and editable on the settings page, not a
standard DiveDay asserts.

## Consequences

- The settings field moves out of the boats-off branch and is asked of every shop, and the
  Diving-options hub row states the target beside the three dive kinds (`6:1 divers per
  divemaster`) — a target nobody can see without opening the row is a target nobody remembers
  they set.
- `DepartureShape` loses its two-armed `boats | group` union: `hulls` is null for a shop with no
  boat, and `diversPerDivemaster` is on both arms because both need it.
- The trip page's Crew panel gains one advisory line, rendered only when the departure is short of
  target, in ordinary ink rather than the warning block the two agency gates use — the ink is the
  difference between advice and a refusal, and a reader should be able to tell without reading.
- A shop that never opens the settings row runs at 6:1 and sees suggestions built from it.
- Export's shop row carries `divers_per_divemaster` in place of `shore_group_size`.
- The Requests planner gains a crew line, sized off the divers who actually asked rather than
  off a suggested hull's empty seats — recommending three divemasters for a party of four
  because the smallest free boat seats twelve is advice no shop would follow.

## Alternatives considered

**Keep both.** A coarse departure size *and* a ratio. Rejected: the two disagree the moment a shop
edits one, and the coarse one had a single reader that the ratio serves better.

**Fold the target into `course-ratios.ts`.** Rejected for the reason above — a shop preference and a
published safety cap must not share a code path, a type, or a sentence, however similar their
arithmetic looks.

**Make it binding, or make it binding above some threshold.** Rejected: the shop is looking at the
water and we are looking at a row. A shop knows when today's four divers on one guide is two
buddy pairs on a shallow reef, and a refusal it did not ask for is a refusal it will route around.
