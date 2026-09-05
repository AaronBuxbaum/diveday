# 20260904-reef-all-the-way-down — Take Reef to the bottom of every surface, decide the delight backlog, and widen the budget along one axis

- **Status:** Accepted — decided 2026-09-04 (Aaron Buxbaum, in session; H-67: the budget widens as
  drawn, `trips.revision` carries the calendar revision, the postcard stamp and the stage words as
  drawn). Slices 16a–16j in the roadmap
- **Date:** 2026-09-04
- **Design:** [the canvas](../../design/canvases/20260904-reef-all-the-way-down/README.md) — twelve
  artboards on two pages: the cover, the verdict ledger, the budget sheet and the measured gap; then
  the home at morning and evening, the phone home, the storefront, the booking page, the thread, the
  recap and the manifest
- **Scope:** every surface a shop and a diver live in (`/shop/[shopSlug]`, the manifest,
  `/s/[shopSlug]`, `/s/[shopSlug]/trips/[id]`, `/ready/[token]`, `/recap/[token]`), the delight
  backlog (#1160 and its thirty open children, plus #1081, #1284, #1346, #1357, #1363, #1366), and
  the delight budget in [principles.md](../../design/principles.md) §3

## Context

The owner's brief on 2026-09-04: the feature ideas in GitHub Issues have never been selected
against; the frontend does not reach the quality the designs depict; consider everything top-down,
nothing sacred; and the product is too restrained — there are delight angles it is missing.

Three facts, established that day and carried on the canvas:

1. **The gap between the drawing and the code is composition, not colour.** Reef's tokens landed
   on 2026-09-02 ([20260901-diveday-reimagined](20260901-diveday-reimagined.md), 13a) and the three
   moments followed, but each landed inside the composition that already existed. Captured from
   `pnpm dev` on the day: the shop home renders each station as a three-column grid (112px time, a
   hairline rail, the body) where Reef drew a 28px panel with the site tile leading it; rows are a
   14px subject over a 14px detail where the drawing had one 15px sentence with a kind word; a
   settled boat is a success line, a disclosure and a button — the busiest block on the page; and a
   *Generate log* secondary button stands beside every boat, every morning, for an act an owner
   performs a few times a season. The dial is 64px where the drawing had 76. None of this is a
   token, and no slice was ever "the station".
2. **The public booking page is unbounded.** 5,782px at 390 before the form: a route map, ten
   species with photographs, a moments strip, five site-notes paragraphs and the crew. The thread
   ADR ([20260827-the-divers-thread](20260827-the-divers-thread.md)) put the form last and was
   right; nothing bounded what came before it, and the repository's own rule says a page that
   screenshots enormous is telling you the page is unbounded.
3. **The product does not know what time it is.** Between Reef's three moments no surface says a
   boat is out, that it is dusk, or that today is one the shop will remember. The 2026-09-01 delight
   report produced fifty-five tickets; the owner ruled on 2026-09-03 to keep the backlog open and
   re-triage after the first pilot boat day, and its own triage note found the blocker was
   "selection, not specification depth". Thirty are open. Nobody had selected.

## Decision

Proposed, in four parts. Parts 2 and 4 carry the three owner calls recorded as H-67.

### 1. The surfaces are rebuilt to the drawing, by surface

The canvas's slice table is sequenced by *surface* rather than by token or moment, because the
Gap board's last finding is that the other two orderings are how the pictures were missed. The
station on the shop home becomes a `SectionCard` per departure with the site tile leading, one
sentence per row, and the log door demoted from a secondary button to a quiet link. *Corrected on
acceptance*: the canvas moved that door to the evening, and the 2026-08-12 amendment to
[20260804-incident-export-owner-gate](20260804-incident-export-owner-gate.md) forbids exactly that —
the log is offered on every departure, because the moment a shop most needs it is while the boat is
still out. The amendment stands; what changes is the weight, not the presence; the booking page is bounded to three field-guide
tiles and a door above the form, with a composition test that refuses more; the manifest keeps
every rule it has and gains two strips at its top; the storefront gains a live panel and a lens
rail; the thread gains one step; the recap gains a postcard. Each slice ends in the standing
obligation from [design-artifacts.md](../../design/design-artifacts.md): the component names this
ADR and a test pins the rule.

### 2. The delight budget widens along one axis — time — and every ban stands (H-67 a)

[principles.md](../../design/principles.md) §3 rations joy to finishes and declines a standing
good-news line. Both stay. What the canvas adds is the product knowing *when* it is, in eight rules
on the Budget board, each naming what renders when it is not true: nothing.

| Rule | What | Renders otherwise |
| --- | --- | --- |
| 1 | The water band takes one of four washes by the shop's clock (dawn 5–8, day, dusk 17–20, night). Lagoon-family and sand only; never coral | the day wash, as today |
| 2 | Three things may move, and only these: the swell across settled work (ships), the water in a dial (ships; gains the swell's crest at the waterline, except on the roll call), and **the boat**, which drifts 12px once when the crew taps *Underway*. Each ≤ 600ms on `--ease-out-soft`, never while a field has focus, all under `prefers-reduced-motion` | nothing moves |
| 3 | One fact of scale, on the day it is true: every 100th diver of the season, the first boat of the season, and the two once-a-shop moments that already ship. A count of divers or boats, never money, a comparison, a streak or a rank. It *is* the surface's earned moment that day, so it takes the coral wash and outranks the daily all-clear line | nothing |
| 4 | A boat that is out says so everywhere the boat is drawn: five stage words the crew taps on the manifest (D20), rendered as a chip on the station, a panel on the storefront, a line on every diver's link. Never a position; DiveDay repeats what the crew said and when. *Home* takes the roll call's success tone, the one deliberate exception to "a wash is not a status" | nothing — a stage the crew did not set is absent, never "Unknown" |
| 5 | A mutable fact says where it came from (D51): Forecast (hollow), Plan (lagoon), Crew with a time (ink), Observed (success). Only Observed may print on a recap as what happened | — |
| 6 | Anything a diver shares says who sees it, for how long, and the way back, in the sentence that asks (D53's grammar, drafted ahead of counsel and reworded to whatever counsel decides) | — |
| 7 | The diver's day gains three sentences and a picture: the boat's-back line, the dive-day number on the postcard, the next dive with its reason; the postcard exports as an image with no link in it and room for one private line that never leaves the phone | — |
| 8 | Every ban stands: no drawing, coral or motion on a manifest, roll call, cert check, waiver or payment, or beside a refusal; coral stays at three; a wash is not a status; nothing renders quietly; every sentence earns its place | — |

The hand gains its eighth drawing, the boat, and the boat is the only drawing that ever moves. It
appears on the home, the board and the storefront; never on the manifest.

### 3. Every open feature idea gets one verdict

Thirty-six issues, one line each on the Verdicts board. **Eighteen drawn** onto the surfaces
(D01, D02, D12, D14, D15, D18, D20, D22, D24, D33, D35, D40, D42, D47, D49, D51, #1081, #1346).
**Eleven adopted unseen** — built from their own bodies because the primitives already settle their
shape (D05 on H-67 b, D17, D25, D36 and D45 as one recap variant, D44, D52, #1284, #1357, #1363,
#1366). **Three
folded** into the row they duplicate (D19 into D15; D23 into D12's count; D27 into D42). **Three
held** on the waiting-on lines their issues already carry (D39, D48, D53). **One declined**: D38,
a message the diver did not ask for, which is the one thing the delight report itself forbids; if it
ever exists it is a line on the storefront the diver returns to, never a send.

Four things on the boards came from reading the app rather than the backlog — the band's clock,
the boat that leaves, the fact of scale, the storefront's live panel — and are filed as their own
follow-ups (#1371, #1372, #1373, #1374), so the tracker holds the whole set. The owner's ruling that
the backlog re-triages after the first pilot boat day stands; this is what that triage reads.

### 4. Two sets of words are the owner's (H-67 b and c)

- **D05's revision counter.** Half of D05 merged (#1348). The rest was which edits bump the
  calendar event's revision and where the counter lives. Recommended: `trips.revision`, an integer
  bumped by a change to `starts_at` or to the site list, read by the `.ics` as `SEQUENCE`; the
  thread's "updates itself if the plan moves" line assumes it. **Shipped as recommended** (slice
  16j, issue #1165): the column bumps for a `starts_at` change and for a change to the day's dive
  sites, in `moveTrip`, `updateTrip`, `applyDetailsToFutureSeries` and the demo refresh, and for
  nothing else — a conditions note and a status flip leave it where it is. Both calendar surfaces
  read it as `SEQUENCE`, through `src/lib/trip-calendar.ts`; the rule itself is
  `src/lib/trip-revision.ts`.
- **Two phrases that print to a diver.** "Dive day № 3" on the postcard's face (today's
  `visitMilestone` sentence, moved and shortened), and the crew's five stage words as the storefront
  and the thread show them: *Boarding · Out on ⟨site⟩ · On the surface · Heading in · Home*. Both
  land in every locale in one change.

## Alternatives considered

- **Refine the shipped compositions in place.** Rejected: the Gap board measured the difference and
  it is structural — a rail against a panel, two lines against one — and three token-level passes
  since 2026-09-01 did not close it, because none of them was aimed at a surface.
- **Ship the delight backlog in its recommended order (#1160's four phases).** Rejected as the
  selection mechanism: the phases group by theme, and half of phase 1 is already closed. Selecting by
  surface puts every accepted idea on the board it lands on, so a slice ships a *surface* rather
  than a theme's worth of scattered rows.
- **Widen the budget by allowing more coral, or a mascot, or sound.** Rejected. Coral is a status
  risk on every safety surface and stays at three; a mascot is the failure mode Reef's own tradeoff
  names; there is no sound anywhere in the app and a boat deck is the wrong place to start. Time is
  the one axis where the product's silence costs delight and nothing costs trust.
- **A standing good-news line.** Declined on 2026-08-27 (issue #808) and still declined; rule 3 is
  a fact that is true once, not a line that is present always.
- **Track the boat.** Rejected: rule 4 repeats what the crew said and when. A position is a promise
  DiveDay cannot keep and a liability a shop does not want.
- **Send D38.** Declined outright, above.

## Consequences

- The home's visual baseline moves on every capture; 16a's pull request explains it as the station
  landing, and the visual spec captures the home at 6:40 and 6:10 so the band's clock is
  photographed. `e2e/visual.spec.ts` freezes the clock, so the four washes need four frozen instants.
- `trip_stage_events` is a new append-only table read by four surfaces; a stage is never inferred
  and never edited, only appended. The manifest's stage strip is a control on a safety surface and
  gets the `dive-domain-expert` pass, and the stage word a diver reads is copy in both locales.
- A season start becomes a shop setting (default: January 1) so the fact of scale has a denominator
  a shop chose. The count is a read, never a cache.
- The booking page's composition test bounds its own length, so the next feature that wants to sell
  harder has to open a door rather than add a section.
- The consent grammar (rule 6) ships behind counsel: D12, D22 and D40 are drawn with its sentences
  and are reworded, not redrawn, when H-01–H-03 answer.
- The escape hatch is the same as Reef's: every widening in part 2 renders nothing when it is not
  true, so reversing any one of them is deleting a rule, not redrawing a surface. Reversing part 1
  would mean keeping the lists, which is the state this record measured and found wanting.
