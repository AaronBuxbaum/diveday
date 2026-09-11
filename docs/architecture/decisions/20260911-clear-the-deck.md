# 20260911-clear-the-deck — Six ways to make DiveDay smaller, a floor of deletions, and the pick is the owner's

- **Status:** Proposed — pending H-73. **Round 1 read 2026-09-11 (Aaron Buxbaum, in session):**
  the six concepts land, and the surface itself — Reef — is now the problem, "overbearing and ugly";
  go farther. Round 2 (decision 3, below) redraws the surface as five candidates for the owner's
  pick. **Round 2 read, the same day:** the problem is Reef itself; the instrument is the direction
  the owner liked; farther from the cutesy. Round 3 (decision 4) draws that one direction deep —
  Console — and asks calls (i)–(l). **Round 3 read, the same day:** "Can we improve this further?"
  Round 4 (decision 5) takes Console further along its own axis and asks calls (m)–(o). **Round 4
  read, the same day:** light mode should still render light; that implies further changes; and the
  surface should sit somewhere between an instrument and the existing design. Round 5 (decision 6)
  prints the instrument on Reef's own paper — Chart — and asks calls (p)–(r). The floor's
  first two rows (the door, the chip and the pill) may start on this ADR alone,
  because they are One hand's slices 20b and 20c taken to zero; every other row, every concept and
  every surface waits on the owner's calls (a)–(r)
- **Date:** 2026-09-11
- **Design:** [the canvas](../../design/canvases/20260911-clear-the-deck/README.md) — five pages.
  Round 1: the cover with the count, the captures, the floor and the comparison; six concept boards,
  each redrawing the shop home at desktop and at 390 for the same shop on the same morning. Round 2:
  its cover with the layers counted on one screen and the surface floor; five surface boards, each
  a system sheet, the home at desktop and the counter at 390. Round 3: its cover, Console's sheet,
  the home by day, the home at depth, and three phones. Round 4: its cover, the parts, the home
  refined, a boat's page and the week, a person and the money, the outside. Round 5: its cover, the
  dial (the same morning at three stops), Chart's sheet, the home by day, the home at night, three
  phones
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

### 3. The surface, rethought — round 2 (H-73 e–h)

**The owner's read of round 1 (2026-09-11):** "I like these ideas, but I think we need to go
farther. I think our Reef concept needs to be rethought since I'm now finding it overbearing and
ugly."

Reef ([20260901-diveday-reimagined](20260901-diveday-reimagined.md), picked as H-64) was drawn to
feel warm and alive, and every canvas since added a moment on top of it rather than in place of
one. Counted on one screen of the home at HEAD: ten decorative devices (the water band, the drawn
site tile, the dial with water, the stage chip, the 28px panel on a bed, the tinted pill and its
glyph, coral in three places, the horizon tiles, the eyebrow and the 44px greeting, the intent
line), five hues and three washes, four radii, two elevations at rest, nine type rungs. The fix is
not a prettier Reef; it is a surface with fewer things on it.

**The surface floor.** Whichever surface is picked, every staff page obeys six rules, held by the
same guards that hold round 1's floor: two hues and red (ink and the shop's colour; red is the word
Blocked and nothing else; DiveDay's lagoon, coral, sand and shallows leave every staff surface); one
radius per surface, or none; no elevation at rest; one structural device — a hairline, a rule or
space, never two and never a fill behind text; type carries the hierarchy (no eyebrow, no caps
label, no glyph beside a word); nothing drawn on a staff surface.

**Five surfaces**, each on the floor, each drawn on round 1's recommended shape (Three words with
Ask as its search) on the home at desktop and the counter at 390, and each naming its own face:

- **I · Salt** — white, black, one hairline, the shop's colour on the current word and the verb;
  Instrument Sans; radius 0. For: the least to look at and the most to read; prints as it stands.
  Against: cold, and anyone's. 2–3 sessions.
- **II · Air** — a warm-neutral white with no lines; space as the structure, a soft fill under a
  finger; Figtree; radius 12. For: the gentlest answer to "overbearing". Against: the least
  distinctive; spends rows. 3 sessions.
- **III · Headline** — four sizes, two colours, no grey, two rules per group; the boats in the
  shop's colour at 28px; Schibsted Grotesk; radius 0. For: reads across a counter; unlike anything
  else. Against: spends height; a taste. 3–4 sessions.
- **IV · Their ink** — the shop's colour as the ink in four strengths (Harbor's derivation run to
  7:1, with a twelve-step fallback to neutral ink), its face on the titles, DiveDay's palette gone;
  Public Sans; radius 6. For: "it's in our colours"; no mix to be ugly. Against: heavy in a dark
  hue; about a third of shop colours fall back to Salt with a coloured bar. 4–5 sessions.
- **V · Slate** — a cool grey ground, one white sheet, hairlines, 44px rows, a face cut for low
  vision; Atkinson Hyperlegible; radius 4. For: the densest without a table; the dock test as a
  face. Against: "another app". 3 sessions.

A surface is picked whole. The one honest composition is Their ink's colour rule under another
surface's type and structure. Under every surface the manifest and the roll call keep neutral ink
and boat mode — a head count is never in a brand — and Harbor keeps the storefront in the shop's
colour and face on the picked surface's rows and controls.

The recommendation, stated so it can be disagreed with: **Their ink**, with Air's spacing already
inside it — the owner's "overbearing and ugly" is the mix of DiveDay's colours with the shop's, and
Their ink removes the mix by removing DiveDay's colours; it is the lever the owner liked on 09-09
taken to its end, and the one surface a shop repeats to a friend. Headline if the phone matters
more than the desk; Salt for the cheapest honest answer; Air if the priority is that nobody can
call it anything; Slate if a five-boat Saturday on one laptop screen is the job.

**The owner's round-2 calls (H-73):** (e) which surface replaces Reef on every staff page;
(f) whether Geist leaves the staff app for the picked surface's face, reversing H-64's one-face
pick; (g) whether the hand and the coral leave the product entirely or stay on the diver's recap
postcard only; (h) whether DiveDay's own pages take the picked surface in the slice that shrinks
them. Round 1's (a), (c) and (d) stand; (b) is answered by every surface here.

### 4. Console — the instrument, drawn deep (round 3, H-73 i–l)

**The owner's read of round 2 (2026-09-11):** "I think my problem is with the Reef itself. I like
when we were looking at DiveDay as an instrument, possibly moving farther away from the cutesy-ness."

The instrument has been drawn twice before: Deck ([20260901-diveday-reimagined](20260901-diveday-reimagined.md))
— dark by default, IBM Plex Mono figures, the day as a T−minus ladder, the roll call at depth — lost
to Reef on warmth; C ([20260908-one-hand](20260908-one-hand.md)) — dark, one cyan, every state a word
in a fixed 128px slot — was declined on 09-09 as hard to move around in and not warm enough. Round
3 draws it a third time, by name, with both losses answered in the drawing rather than argued with:

- **Movement** is round 1's: three words in the bar and at the bottom of a phone, the Ask field,
  and the row's own tap; the slot holds a state word or a figure and never a sentence; the way back
  is the word you are standing on.
- **Warmth** is not attempted. The desk is drawn in daylight — a matte light ground, near-black ink
  — and goes to depth only after dark, by the device; the roll call and the counter at the rail
  take the boat scheme regardless. The owner's read is that warmth is no longer the bar.

**Console, stated so a guard can hold it.** Seven tokens — ground, ink, meta, hairline, red, amber,
fill — in three schemes (day, depth, boat), plus the shop's colour as a 3px rule at the top edge and
nowhere else. Geist for every word and Geist Mono for every figure, label, time and state, at five
sizes (56 readout · 28 figure · 24 title · 18 name · 16 value, with the mono's 14, 12 and 11). One
radius, 2px. Six parts and nothing else on a staff surface: the readout (the one number a surface
exists to show, its unit in caps, a meter whose gap carries the signal colour), the figure, the line
(label · sentence · state in a 128px slot), the ladder (the day as departures with T−minus or the
hour they came home), the meter, and the cell (the counter's and the roll call's 60px row with a
48px square target). Figures lead; a state is a word; red is the only ink that stops a boat and
amber the only ink that needs a person, both always beside a word; there is no green, and "Ready"
is never shown. Nothing is drawn — the hand, the coral, the sand, the panel and its bed, the band,
the dial, the chip, the pill, the tints, the greeting and the moments leave for good, and the recap
becomes a printed log card in the same system. A figure rolling is the one motion kept.

The readouts, per surface: the home shows T−minus to the next boat; the counter, here of booked; the
roll call, aboard of expected and then back of aboard; a boat's page, seats open; the week, boats;
a person, dives with the shop; money, the month; the storefront, seats left per boat, in the shop's
colour and face on Console's line and button.

The recommendation, stated so it can be disagreed with: **adopt Console as the surface, on Three
words with Ask, with Ashore-and-aboard's boat half as the roll call's home.** It is the direction
the owner has now named twice, it deletes the idea of decoration rather than the decoration, and
its one risk — a shop that wanted a brochure gets a console — is answered by the storefront, which
stays the shop's.

**The owner's round-3 calls (H-73):** (i) Console as the surface on every staff page, replacing
round 2's (e); (j) the scheme — daylight at the desk with depth after dark by the device and the
boat scheme at the rail, or depth always as Deck and C were; (k) the figures' face — Geist Mono,
keeping one family, or IBM Plex Mono if Geist Mono reads soft at 56px; (l) two signal inks, red and
amber, or red only. With round 3, (b) and (f) are answered by the drawing — the decoration leaves
and Geist stays — and (g) is recommended as entirely: the hand and the coral leave the product.
(a), (c), (d) and (h) stand.

### 5. Console, further — round 4 (H-73 m–o)

**The owner's read of round 3 (2026-09-11):** "Can we improve this further?" Round 4 takes
"further" along the instrument's own axis — more instrument, not more decoration — and adds to
the sheet what every instrument has and round 3 lacked:

- **The display.** The one reading a surface exists to show sits on dark glass even by day —
  #0b0f12 with a #263036 edge, the same at depth and on the boat — with its unit in caps beneath.
  One per surface, never two; a surface with nothing to read shows dashes and says why. The only
  dark block Console allows on a light page.
- **The seat gauge.** A boat's count as one segment per seat — ink for here, red for cannot board,
  amber for still to come, grey for booked and not yet here, empty for unsold — with a legend in
  words beneath it, so the gauge is never the only carrier. It replaces the meter wherever the count
  is people on a boat; the meter stays for counts that are not seats.
- **The telemetry line.** The last line of every surface, in mono caps: live and the time; saved on
  this phone and since when; stale and what to do ("refresh before you rely on it", principle 4's
  own sentence, with a fixed place); and who is at the desk and aboard, which is One hand's K in
  one line. It replaces the connectivity pill, the freshness pill, the offline banner and the
  shell-version banner.
- **Digits and words.** T−00:20, 06:40, 10/12 — fixed width as they roll, seconds only under five
  minutes; "lines off", "home", "not aboard", "not back"; no greeting.
- **Motion, complete.** A digit rolls, a gauge segment fills in the same beat, a cell sinks under a
  finger; nothing else moves.

And four more surfaces drawn on the sheet, so the direction is proven where the shop works: a
boat's page as one instrument (the four trip tabs become one: display, gauge, six figures, seven
lines, the roster as cells, the roll call as the one primary); the week as seven columns of gauges
(the board's tiles and buttons go; "Add a boat" is the last line); a person's record with the fix
as its primary and the till as one page with the month on glass and the weeks as gauges; and the
outside — the storefront's row on Console's parts under the shop's colour and face, the recap as a
log card in the same seven tokens (the drawing gone, call g), and DiveDay's own hero as a live
console with the visitor's boat on glass.

The recommendation, stated so it can be disagreed with: **all five additions, and the four
surfaces as the order to build after the home** — the boat's page first, the week second, the
person and the money third, the outside last, because Harbor already holds it.

**The owner's round-4 calls (H-73):** (m) the display, or round 3's plain figure; (n) the seat
gauge with a legend on every boat count, or the plain meter; (o) the telemetry line on every
surface, or only where a reading can be stale. Recommended: the display, one per surface; the
gauge, with the meter kept for counts that are not seats; the line on every surface — an
instrument that only sometimes says when it read is one you learn not to trust. Every earlier call
stands as put.

### 6. Chart — light renders light, and the instrument on Reef's paper (round 5, H-73 p–r)

**The owner's read of round 4 (2026-09-11):** light mode should still render light; that implies
further changes; and the surface should sit somewhere between an instrument and the existing
design. Round 5 answers with **Chart** — Console's parts, figures, words and discipline printed on
the paper the app already has — and with a dial, the same morning drawn at three stops so
"between" is a position rather than a word: Console as round 4 left it; Chart; and Reef after the
floor (today's tokens, ladder, bed and cards with only the floor applied). What changes from
Console:

- **The face.** The display's one reading, at the same size, on a lit panel: `--surface` with a
  `--border` hairline by day; the night surface after dark, where it reads as glass by its edge
  alone. Never a colour of its own; one per surface, dashes when empty, as round 4 specified.
- **The paper.** Sand, shell, tideline, rope, deep-sea ink and its muted, red and amber — the eight
  light tokens in `globals.css` at HEAD, unchanged; the ninth is the shop's own colour, on the bezel
  and the one filled button. Console's grey, black and slate leave. Lagoon stays on DiveDay's own
  pages and leaves every shop's.
- **The night.** The night palette the app already has — open ocean, its surface, sunken, border,
  ink, muted, the lifted red and amber — as the one dark; Console's depth scheme is not built, and
  the night-palette test stands as it is. The shop's colour at night is lifted as `brand.ts` lifts
  Harbor's.
- **Glare.** Console's boat scheme becomes a word in the roll call's and the counter's bar that
  turns the app's own `.boat-mode` skin on for that phone until the same word turns it off. The
  theme never does it: light renders light, dark renders the night, and a crew chooses glare when
  spray and sun say so. Round 3's rule that the roll call is black whatever the phone says leaves.
- **One radius of 6**, between Console's 2 and Reef's control rung of 10; the inset and panel rungs
  go, and the pill with the chip.
- **The sheet.** The one panel: a boat is a sheet of shell on the sand with a hairline and no bed;
  the desk, the week, a person's dives, the till's lines and every group head sit on the paper. The
  rule for when a thing gets a panel is that it sails.
- **The gauge on paper.** An empty seat is the tideline with a hairline, so a gauge reads on sand
  as it read on grey. Everything else — the figure, the line, the ladder, the cell, the telemetry
  line, fixed digits, the crew's words, motion — is round 4's, unchanged.

The dial's ends are not candidates: today's Reef, uncut, is what the owner asked to leave, and the
boat scheme by decree is what light-renders-light rules out. A stop between Chart and Reef keeps
the bed or a second rung, which is the ladder returning; a stop between Console and Chart keeps the
grey, which is the cold returning.

The recommendation, stated so it can be disagreed with: **Chart, as drawn — the middle stop.**
Eight of nine tokens in each scheme are already in the tree, so the slice that lands it deletes
the ladder's two upper rungs, the bed, the marks and the moments and repaints nothing; the parts
are Console's, drawn on nine surfaces across pages 3 and 4, and every one holds on paper without a
change; the one new thing is the face, which is the display with its glass off. Its risk is the
owner's sentence in reverse — a shop that wanted the instrument's severity gets paper — and glare,
one word at the rail, is where that severity still lives.

**The owner's round-5 calls (H-73):** (p) light renders light — the face replaces the display's
glass by day, the night palette is the device's, glare is the crew's word — or round 4's display
and boat scheme as drawn; (q) where on the dial: Console, Chart, or Reef after the floor; (r) what
Chart takes from Reef (the paper and ink, the night palette, the sheet) and what it leaves (the
ladder's upper rungs, the bed, the lagoon on staff pages, the coral, the marks, the moments, the
greeting), with the radius as the one open notch — 6 as drawn, or Reef's control rung of 10.
Recommended: yes; Chart; as drawn. (p) answers (j) and (m): the scheme is the device's everywhere
and the display stays, lit. If (q) is Chart, (i) reads "Chart as the surface". Every other call
stands as put.

### 7. What this does to One hand

One hand's ADR stays Proposed and its floor (20a–20e) stays the floor: nothing here restates it and
every concept assumes it. Its open slices 20f–20m — the earned moment on the shared door, the levers
F, H and K, the trip's line, the pass, the log, the postcard, the rooms, the surface sweep — pause
until H-73 is answered, because each adds a thing and this ADR's whole argument is subtraction.
Their features that already shipped (20n–20t: the boat's line, try it with your boats, the year,
the gift, sightings, paper, the shelf) stay; call (c) decides where they sit — recommended: all
kept, on by default, and off the storefront's front page.

### 8. What does not change

The name and the mark. Harbor — the diver-facing pages wear the shop's brand, and concept 6 makes
that everything rather than less. The dock test: 44px targets, 16px critical text, AA, never colour
alone — on every round-2 board the two who cannot board carry a sentence, never a hue. The coral
bans on manifests, roll call, certs, waivers and payments, which every surface makes moot by having
no coral. The claims policy. The roll call commits before it renders, and keeps neutral ink and boat
mode under every surface. H-02's retention and erasure promises. Every settled question in
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
- **Round 2 as a tidier Reef — the same tokens with fewer moments** — declined: the owner's word
  is "overbearing and ugly", not "busy", and the ugliness is the mix of hues and rungs that a tidier
  Reef would keep. Every candidate starts from two hues and one radius instead.
- **Round 2 as one surface, chosen for the owner** — declined: taste is the owner's call, and five
  drawn on one anatomy let it be made by eye; the recommendation is stated so it can be refused.
- **Round 3 as a sixth surface beside the five** — declined: the owner named the direction, so the
  page draws it deep (a sheet, two schemes, three phones) instead of adding a sixth card to a row;
  the five stay on page 2 as the record of what was offered.
- **Round 3 as Deck or C republished** — declined: both lost for reasons the owner stated, and a
  drawing that ignores them would lose again; Console keeps their parts and answers the two losses.
- **Round 4 as decoration returning under another name** — declined: a display, a scale and a
  time-of-reading are what instruments have, not ornaments; each addition is held to one per
  surface, a word beside every colour, and no new hue.
- **Round 4 as a dashboard** — declined: two displays on one surface, or a gauge without its legend,
  would make Console the thing the brand's own words rule out; the sheet says one display and one
  reading per surface.
- **Round 5 as Reef with fewer moments** — declined: the owner's words were "between", not "back";
  the ladder, the bed, the lagoon and the coral leave the staff pages under Chart, and the dial's
  third stop draws what keeping them looks like so the middle can be seen as the middle.
- **Round 5 as Console in beige** — declined: a grey page recoloured is still a page with a dark
  block on it and a boat scheme by decree; Chart changes three things Console refused — the face is
  the surface, a boat is a sheet, glare is a word — which is what "light renders light" costs.
- **Round 5 as a lighter display on Console's grey** — declined as the only move: it answers the
  first sentence of the read and not the second, and the grey is the cold the instrument lost on
  before.

## Consequences

Easy: every concept board is a subtraction list, so a slice is a set of deletions with tests to
remove, not a set of new components — the cheapest kind of slice this repo has. The floor's first
two rows land without a decision. The count on the cover is reproducible from the tree, so the next
canvas can measure whether the number went down.

Hard: each retired switch drove a conditional on some surface, and the sweep has to find and remove
each one with its guard, message keys and test — the sessions in every cost estimate are mostly
that. Marketing loses features it currently names (the embed catalogue, the print register) and
gains a sentence ("nothing to configure before the first boat"). Concept 6 cannot start before
concept 3's boat half exists. A new surface reverses accepted picks — Reef's tokens (H-64, 13a),
and under round 3 the H-64 choice of Reef over Deck itself — and the tests that pin them
(`card.test.tsx`'s radius and elevation rules, `check:type-ramp`'s constants, the water-band and
night-palette tests, the illustration tests) are rewritten to pin Console, never deleted. Under
round 5 the reversal narrows: Chart keeps Reef's tokens and its night palette, so the night-palette
test stands as it is and the rewrite is the ladder (one rung), the bed, the water band and the
illustrations, to pin Chart. Round 3
also retires H-67's coral count and the earned-moment budget for staff surfaces; the ADRs that
record them stay as the record and this one supersedes their surface decisions on acceptance.

Commits us to: fewer things, held by guards that refuse a new door, a new pill, a new switch and a
new front-page section, so the count cannot climb back in silence.

Escape hatch: if a pilot shop needs a switch the card took away, the card's "set by DiveDay for
you" flag is the door and support is the person; if two such requests arrive for the same switch,
it returns as a decided line with a Change, never as a page. If the owner declines every concept,
the floor's first two rows still stand on their own and this ADR moves to Accepted on them alone.
Reversing the whole thing costs what it saved: the routes and components come back from history,
one family at a time.
