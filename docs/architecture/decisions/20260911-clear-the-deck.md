# 20260911-clear-the-deck — Six ways to make DiveDay smaller, a floor of deletions, and the pick is the owner's

- **Status:** Proposed — pending H-73. The floor's first two rows (the door, the chip and the pill)
  may start on this ADR alone, because they are One hand's slices 20b and 20c taken to zero; every
  other row and every concept waits on the owner's calls (a)–(d)
- **Date:** 2026-09-11
- **Design:** [the canvas](../../design/canvases/20260911-clear-the-deck/README.md) — one page: the
  cover with the count, the captures, the floor and the comparison; six concept boards, each
  redrawing the shop home at desktop and at 390 for the same shop on the same morning
- **Scope:** every staff surface under `src/app/shop/**`, the primitives in `src/components/ui/`,
  the destination registry `src/lib/staff-destinations.ts`, the settings registry
  `src/app/shop/[shopSlug]/settings/settings-groups.ts`; under calls (c) and (d), the storefront
  `src/app/s/**`, the embed catalogue, the print register, the integrations, and DiveDay's own pages
  under `src/app/`
- **Follows:** [20260908-one-hand](20260908-one-hand.md), whose floor (20a–20e) this ADR keeps as
  its own floor's floor and whose open slices 20f–20m pause until H-73 is answered

## Context

The owner's brief on 2026-09-11: the design system is ugly and has far too many controls and
external-facing features; rethink the visual presentation; give at least five concepts that
consolidate concepts and make it clean and simple.

Read from the tree at `748021f` and from captures of the running demo shop, the finding is that
DiveDay is not short of a design system; it is long on product. Thirteen design canvases landed
between 08-27 and 09-10, and the last one ran four rounds in three days: round 2 added five levers,
round 3 eight more and a redraw of every surface, round 4 seven possibilities — all seven shipped on
09-10 as a stack of seven pull requests (#1626, #1627, #1629, #1630, #1631, #1633, #1634). The floor
that would have made any of it cohere, One hand's five deletion slices 20a–20e, is still open. Every
feature arrived three times — as a switch in Settings, as a door on a surface, and as a page outside
— and nothing was ever taken away. Counted:

- **96 page routes**: 57 staff, 9 storefront, 13 reached by link, 17 DiveDay's own.
- **21 staff destinations** in the registry: four tabs, fifteen under More in two groups, two in
  ⌘K only.
- **43 rows on the Settings hub and 12 pages beneath it**; every row is a conditional somewhere
  else in the app.
- **About twenty tappable controls on the home at rest**, before a staffer has done anything —
  nine of them a row's trailing "Open …" door — under a water band, a drawn tile, a dial and a
  stage chip, with three row grammars (a 28px panel, a bare ledger, two horizon tiles) on one
  screen.
- **14 sections and about 25 controls on the storefront's one page**: hero, rating and badges,
  Right now, Next boat with space, In season, a seven-chip lens rail with two selects and a
  checkbox, nine days of ledger, courses, boats, reviews and three disclosures.
- **27 primitives in `src/components/ui/`** with eight button variants, and **39 staff message
  namespaces** — roughly one per feature.

The cause is additive design, and the fix is not a fourteenth vocabulary. It is fewer things: fewer
nouns, fewer doors, fewer switches, and fewer pages outside.

## Decision

### 1. The floor — deletions of kinds of thing

Whatever concept the owner picks, these happen first. One hand's twelve deletions (one width, one
eyebrow, one title, one row, one add, one state, one meter, one link, one skeleton, one disclosure,
the voice sheet) hold each job at one spelling and remain the floor's floor; the rows below delete
kinds of thing rather than spellings.

| Kind of thing | The floor | Held by | Waits on |
| --- | --- | --- | --- |
| The door | a row's own tap is its only door; a trailing verb, where one exists, is the fix and nothing else — the nine "Open …" doors on the home go | a guard on a link rendered inside a row | — |
| The chip and the pill | a state is a word: **Blocked** in danger ink, or a sentence in muted ink; nothing tinted behind text on a staff surface | `Badge` is deleted, not narrowed (20c, taken to zero) | — |
| The decoration | the water band, the drawn site tile, the dial's water, the coral washes and the greeting's mark leave every `/shop/**` page; the shop's colour is the staff app's one accent; the hand and the coral stay on the diver's side | the coral table gains a row; `WaterBandStyle` renders nothing under `/shop` | H-73 b |
| The switch | a feature is on with a default a sentence can change, or it does not exist; Settings becomes the shop's card (concept 5 in full, or its first half under any other pick) | the settings registry shrinks to facts; each retired switch's conditional goes with it | H-73 c |
| The outside | the storefront's front page is Right now and the week; every other public noun is one tap in or gone; one embed with one look; every page prints; three connects; the lobby display is the storefront full-screen | the storefront's composition test; the embed snippet table shrinks to one | H-73 c |
| DiveDay's own pages | three plus the two legal ones — the homepage (already the demo), pricing, switching; product, about, the regions, the demo stories and status fold into the homepage or leave | the marketing route table; `check:route-coverage` | H-73 d |

### 2. Six concepts, and the pick is the owner's (H-73 a)

Each consolidates along a different axis, redraws the shop home for Blue Mantis Divers on Thursday,
August 27, 2026 at 6:40 AM at desktop and at 390, and states its case, its tradeoff, its cost, what
it folds, what it deletes, what it keeps and where it stops. Names are stable from here on; none
reuses a letter from One hand's A–Z.

- **1 · Three words** (by noun) — the staff app is Day, People, Shop. Twenty-one destinations,
  More, the dock and the ⌘K list fold into three words; every page beneath is one list in one
  grammar. For: learned in a sentence. Against: Shop is a drawer of nine; it looks like a list
  that lines up. 3–4 sessions.
- **2 · The week** (by time) — one list in the product, the calendar; everything with a date is a
  mark on the week and nothing with a date has an index page; people and things are a drawer.
  For: the plan and the memory are one page. Against: seven columns on a phone; the month has no
  home. 5–6 sessions.
- **3 · Ashore and aboard** (by place) — two tools: a dense desktop ledger for the desk and the
  owner, and a phone with one boat on it for the crew; nothing drawn for both. For: half the
  controls each, by construction. Against: two things to learn; the owner who also drives. 6–8
  sessions.
- **4 · Ask** (by question) — one control, a field that takes a name, a day, a boat or a word and
  answers with the fact and its fix; no navigation; the home is the answer to "today". For: the
  09-06 palette already does this. Against: typing on a dock; discoverability; can read as a
  launcher. 3–4 sessions.
- **5 · The shop's card** (by default) — no settings: one card of what the shop is and twelve
  sentences DiveDay decided for it; every switch becomes a default and every control that existed
  because a switch could be off goes with it. For: the direct answer to "too many external-facing
  features"; composes with all five others. Against: DiveDay decides more; the exception becomes a
  person. 4–5 sessions.
- **6 · One face** (by face) — the storefront is the app: staff sign in and the same page grows a
  strip and a layer of ink; the staff app as a separate product is deleted; the boat and the till
  stay apart. For: "our website is our office"; one component set, the shop's. Against: needs 3's
  boat half; the hero is in the desk's way; privacy is structural. 8–10 sessions.

The recommendation, stated so it can be disagreed with: **5 now, then 1 with 4 as its search, then
3's boat.** The card is pure subtraction and lands one row at a time. Three words and a field is the
smallest staff app that still reads as a day rather than a dashboard. Aboard gives the crew the one
screen the dock test was always about. Six stays on the canvas as the pitch to return to once the
boat is its own tool; two is the honest alternative for a shop whose owner already plans on a wall
calendar.

### 3. What this does to One hand

One hand's ADR stays Proposed and its floor (20a–20e) stays the floor: nothing here restates it and
every concept assumes it. Its open slices 20f–20m — the earned moment on the shared door, the levers
F, H and K, the trip's line, the pass, the log, the postcard, the rooms, the surface sweep — pause
until H-73 is answered, because each adds a thing and this ADR's whole argument is subtraction.
Their features that already shipped (20n–20t: the boat's line, try it with your boats, the year,
the gift, sightings, paper, the shelf) stay; call (c) decides where they sit — recommended: all
kept, on by default, and off the storefront's front page.

### 4. What does not change

The name and the mark. Harbor — the diver-facing pages wear the shop's brand, and concept 6 makes
that everything rather than less. The dock test: 44px targets, 16px critical text, AA, never colour
alone. The coral bans on manifests, roll call, certs, waivers and payments. The claims policy. The
roll call commits before it renders. H-02's retention and erasure promises. Boat mode as the palette
of whatever screen is on the boat. Every settled question in
[settled-questions.md](../../design/settled-questions.md).

## Alternatives considered

- **A fifth round on One hand** — declined: the brief reverses the direction of rounds 2–4 (each
  added; this subtracts), and a canvas whose four pages argue additions and whose fifth argues
  taking them away is read by an agent as one instruction. A new canvas with its own id names what
  it follows and what it pauses.
- **A fourteenth vocabulary — a new skin over the same nouns** — declined: One hand's diagnosis
  already showed that a new look over the same forks reproduces the feeling in a month, and the
  owner's word this time is not "inconsistent" but "too many".
- **Finishing One hand's floor first and asking again** — declined as the only move: the floor
  (20a–20e) is still the first slice of every concept here, but it holds spellings at one and says
  nothing about how many kinds of thing there are, which is the half of the brief it cannot answer.
- **Deleting features outright without the owner's word** — declined: every deletion on the floor
  that removes a feature a shop could see is behind a call; the two rows that start on this ADR
  alone remove doors and pills, not capabilities.

## Consequences

Easy: every concept board is a subtraction list, so a slice is a set of deletions with tests to
remove, not a set of new components — the cheapest kind of slice this repo has. The floor's first
two rows land without a decision. The count on the cover is reproducible from the tree, so the next
canvas can measure whether the number went down.

Hard: each retired switch drove a conditional on some surface, and the sweep has to find and remove
each one with its guard, message keys and test — the sessions in every cost estimate are mostly
that. Marketing loses features it currently names (the embed catalogue, the print register) and
gains a sentence ("nothing to configure before the first boat"). Concept 6 cannot start before
concept 3's boat half exists.

Commits us to: fewer things, held by guards that refuse a new door, a new pill, a new switch and a
new front-page section, so the count cannot climb back in silence.

Escape hatch: if a pilot shop needs a switch the card took away, the card's "set by DiveDay for
you" flag is the door and support is the person; if two such requests arrive for the same switch,
it returns as a decided line with a Change, never as a page. If the owner declines every concept,
the floor's first two rows still stand on their own and this ADR moves to Accepted on them alone.
Reversing the whole thing costs what it saved: the routes and components come back from history,
one family at a time.
