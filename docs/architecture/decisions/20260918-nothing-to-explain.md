# 20260918-nothing-to-explain — One floor decided from the owner's own reads, three directions drawn as finished products, and one call

- **Status:** Superseded on 2026-09-19 by [20260919-one-idea](20260919-one-idea.md), on the owner's read of round 2: "You're still not thinking big enough. I think the way that our current design looks in its entirety, top-down, needs complete rethinking." §1's type, colour and decoration rows and §7's surface stand and are carried into the new ADR by reference; §2–§6 (the three directions, the recommendation, the call H-87, and the floor's shell rows) are withdrawn — A · Inset, B · Glass and C · Figures were three skins on the same skeleton. The **round 1 read** and round 2 are kept below as the record
- **Date:** 2026-09-18
- **Design:** [the canvas](../../design/canvases/20260918-nothing-to-explain/README.md) — eight
  boards on two pages. Round 1: the cover, then each direction redrawing the same six screens (the
  home and a boat on a desk; the home, the roll call, the night roll call and the storefront in a
  pocket) for Blue Mantis Divers on Thursday, August 27, 2026, at 6:40 AM. Round 2: its cover with
  the evaluation and the sheet, then the same three directions redrawn frame for frame on the
  corrected surface
- **Scope:** every staff surface under `src/app/shop/**`, the primitives in `src/components/ui/`,
  the staff shell (`ShopNav`, `StaffTabBar`, `ShopPageHeader`, the trip layout's tab strip), the
  destination registry `src/lib/staff-destinations.ts`, the tokens in `src/app/globals.css`; the
  storefront `src/app/s/**` on the picked direction's rows and controls under Harbor's face and
  colour. DiveDay's own marketing pages are out of scope (#1881 owns them) and take the picked
  surface only when it lands
- **Follows:** [20260911-clear-the-deck](20260911-clear-the-deck.md) and
  [20260908-one-hand](20260908-one-hand.md) — see §5 for what this does to each

## Context

The owner's brief on 2026-09-18: increasingly unhappy with the design; re-evaluate the entire app
top-down the way an Apple designer would; very clean, elegant and delightful; a few options, one of
which the owner will pick to implement.

Read against the two canvases before it and against the running app at `a8c16fb`:

1. **Every round answered a sentence with more.** Clear the deck offered six concepts, then five
   surfaces, then one direction with three more parts, then a dial; One hand before it four
   directions, five levers, eight more, seven possibilities. Eighteen lettered calls, (a) through
   (r), are still open on H-77 and nothing from that canvas has shipped. A design that needs
   eighteen decisions to accept is a menu, not a design.
2. **The instrument was drawn as a console for engineers** — monospace capitals, twelve-segment
   gauges, a telemetry line, a black display by day — and each time the owner found it cold while
   asking for it again. An instrument as Apple ships one (Weather, Fitness, Health) is light,
   rounded, one tint, the number in the same face as the words. Rounds 4 and 5 moved toward that
   in prose and not in pixels.
3. **The app's own pixels.** On the home at rest: twelve token colours, four radii, nine sizes of
   type; a row carries a glyph, a kind label, a name, a sentence, a verb and a chevron. The chrome
   is a website's: a bar of four tabs, More with fifteen under it, a ⌘K box, a six-slot dock. On the
   roll call a captain scrolls past a checkpoint card, five stage chips, a three-way switch and a
   disclosure before the first name. None of it is ugly alone; together it is a page with nine
   voices, and the test an Apple designer applies is simpler than any rule in `principles.md`: if a
   screen needs a label to say what a thing is, the thing is not designed yet.

## Decision

### 1. The floor — decided, not asked

Every direction stands on these rows. Each is what one of the owner's own sentences between
2026-09-08 and 2026-09-11 already implies ("overbearing and ugly", "too many controls", "light
renders light", "farther from the cutesy"), so none is a call; H-87 is a pick of a direction on top
of them. One hand's twelve deletions (one width, one eyebrow, one title, one row, one add, one
state, one meter, one link, one skeleton, one disclosure, the voice sheet) remain the floor's floor.

| Rule | Today | Under every direction | Held by |
| --- | --- | --- | --- |
| One face, one ramp | Geist at nine sizes, a 44px greeting, 11px capitals for eyebrows and labels | Geist at six — 34 · 28 · 22 · 17 · 15 · 13 — with tabular figures; no capitals, no eyebrow, no greeting; a page's name is its title and the date its subtitle | `check:type-ramp` rewritten to six rungs; `ShopPageHeader` loses `display` and the eyebrow |
| Two inks, one tint, two signals | Twelve colours on the home: lagoon, coral, shallows, sand, tideline, three washes | Ink and a secondary; the shop's colour on the current word and the one filled control, lagoon for a shop that set none; red is "can't board" and delete, amber is "needs a person", each always beside a word; no green on a staff surface — "Ready" is never shown | the token set shrinks; `Badge` deleted; a guard on `text-success` under `/shop` |
| Nothing drawn | The water band, the site tile, the dial's water, the hand, coral in three places | All of it leaves every `/shop/**` page; the hand and the coral stay on the diver's recap only | `WaterBandStyle` and the illustration set render nothing under `/shop`; `illustration.test.ts` widened |
| One shell | Four tabs, More with fifteen, ⌘K, a six-slot dock; twenty-one destinations | **Today · Boats · Divers · Shop** and Search — a sidebar at `lg`, a five-slot tab bar below; the twenty-one live under Shop and behind Search; a departure's four tabs are one page | `staff-destinations.ts` gains four groups; `ShopNavLinks`, `StaffTabBar` and the palette read them; the trip layout's strip deleted |
| One row, one group | Eight anatomies; a glyph, a kind label, a sentence, a verb, a chevron | Name · why · a state word or its fix · chevron; the row's own tap is the door (shipped 2026-09-17); a state is a word, never a pill; the group is the direction's one container | `LedgerRow` and `SectionCard` become the picked direction's Row and Group; the `divide-y` guard from One hand's 20b |
| Two radii, concentric | 10 · 18 · 28 · pill, and a bed under every panel | Two rungs per direction, the inner set from the outer; nothing between them; nothing lifted at rest | `card.test.tsx` rewritten to two rungs; `--shadow-bed` deleted |
| Dark and glare | Light, the night palette, boat mode by decree on the manifest | The device's scheme everywhere; the night palette is the one dark; glare is a word in the roll call's and the counter's bar that turns `.boat-mode` on for that phone until the same word turns it off | `night-palette.test.ts` stands; the glare word's device-kept state has a test |
| Creation is a sheet | Full-page forms behind "Add a departure", "Add diver", the walk-in | A sheet rises over the page you were on and leaves you there; a page is never a form | the add panel, the diver form and the walk-in open as sheets from their rows |
| Safety, untouched | — | 44px targets, 16px critical text, AA, never colour alone; the roll call commits before it renders; the coral bans are moot because there is no coral | every existing test |

### 2. Three directions, and the pick is the owner's (H-87)

Each is a complete product, drawn on the floor, differing in what carries the page. Names are
stable from here on.

- **A · Inset — the group carries the page.** Rounded white groups on a soft warm-neutral ground
  (`#f2f1ec` / white; the night palette after dark), the way Settings, Reminders and Health are
  built. A boat is a group whose first row is the boat with its count at the right; a need is a row;
  a fact is a row with its value on the right. A large title over groups; a 236px sidebar at `lg`
  with the shop's mark, Search and the four words; a tab bar with the four words and Search below.
  Radii 12 and 8. The roll call: the count at 34px in a group, then the one still to call, then
  everyone aboard, one 44px circle per name whose fill is the state. For: the most learned grammar
  on any phone, the densest, the cheapest. Against: calm rather than striking. **2–3 sessions.**
- **B · Glass — the material carries the page.** Content edge to edge on a near-white ground with
  nothing around it; type and space carry the hierarchy; a section is a title with its figure at the
  end, a facts line and hairline rows. Every control lives in one floating layer of frosted glass
  (`backdrop-filter`, a hairline edge, one lift): a capsule toolbar at `lg` carrying the mark, the
  four words, Search and the reader; a floating tab bar and a detached search button in a pocket,
  the bar shrinking to the current word as the page scrolls; one filled capsule for the page's act.
  Radii 26 and 12. **Every glass surface has a solid twin** that `.boat-mode` turns on — frosted
  glass is the least legible material in sun — and the roll call's tab bar is the shrunken one-word
  form. For: the most current grammar on any phone this year, and no dive software has it.
  Against: legibility in sun, blur on an old counter iPad, dates with the fashion. **4–5 sessions.**
- **C · Figures — the number carries the page.** Every surface opens with the one figure it exists
  to show — minutes to lines off, here of booked, aboard of expected, seats left, the month — at
  44–56px in Geist with its unit beside it, and a ring (an SVG arc on a track, scaled rather than
  resized) where a count fills; the words beside the figure carry the fact, so the shape is never
  the only carrier. Tiles carry figures on the home alone (four at `lg`, two in a pocket); every
  other surface has one figure in a hero row. Beneath the figure the lists, rows, shell and radii
  are A's. The roll call's ring closes when everyone is aboard, which is the surface's one moment.
  For: the morning read in a glance; the instrument, warm; built on A. Against: a second figure on
  a surface makes it the dashboard the brand rules out — so **one `Figure` per route at rest, and
  tiles only on the home**, both held by a test. **3–4 sessions**, and A is its first slice.

Under every direction the manifest and the roll call keep neutral ink and the boat skin; Harbor
keeps the storefront in the shop's colour and face on the picked direction's rows and controls;
the night palette is the one dark and the shop's colour at night is lifted as Harbor lifts it.

### 3. The recommendation, and the one call

**C · Figures**, for three reasons in order. The product's own truth is counts, and the manifest
and the counter already lead with one; Figures makes the rest of the app agree with its two best
surfaces. The owner has named the instrument three times and each time declined the drawing for its
cold; this is the instrument without the console, light because the page is light. And it composes:
its lists, shell and rows are A's, so a session that builds C ships A on the way, and if the tiles
ever prove too much the floor and the lists stand alone. **A** if the priority is the least risk
for the most calm; **B** if the demo matters more than the dock this season, at a week more and a
solid twin for every glass surface.

**The one call (H-87): A, B or C.** Nothing else waits on the owner: the floor is decided, the
fiction is fixed, the storefront and the night are drawn for each, and the slices are in the canvas
README. A pick is one word; the first slice starts the same day.

### 4. What does not change

The name and the mark. Harbor: a diver-facing page wears the shop's colour and face. The dock test
and the roll call's commit-before-render. Every message bundle, the clock, the timezone, the
skeletons and `instant = true`. The claims policy. H-02. Every row of
[settled-questions.md](../../design/settled-questions.md). DiveDay's own marketing pages, which are
#1881's and take the picked surface only when it lands.

### 5. What this does to Clear the deck and One hand

Clear the deck's ADR stays Proposed as the record of what was offered; its floor's first row (the
door) shipped on 2026-09-17 and stands. Of H-77's open calls, this ADR's floor answers (b), (e)–(f)
and (i)–(r) — the decoration leaves, Geist stays, the surface is one of the three here rather than
Console or Chart — and H-87's pick replaces (a); **(c) and (d) stay open on H-77**: the outside
(the storefront's front page, one embed, every page prints, three connects) and DiveDay's own pages
are consolidations this canvas does not draw. One hand's ADR stays Proposed; its floor (20a–20e) is
this floor's floor and its open slices 20f–20m stay paused, because each adds a thing.

### 7. Round 2 — the surface, evaluated and decided (H-87 unchanged)

**The owner's read of round 1 (2026-09-18):** "I think my problem is that the core of this design
is kind of ugly. Can we evaluate the visuals themselves? I think there's nicer solutions that feel
more Apple-like."

The read is right and the fault is round 1's own: it kept DiveDay's deep-sea ink as the text, put
the shop's forest green on every control, set everything on a warm grey, cut its own icons at
tab-bar size, outlined every group, and framed no device. None of that is how Apple's software gets
its look, and all of it was on every frame at once. Round 2 evaluates eight things on the canvas's
second page and decides the surface, which is the same under any pick:

| Rule | Round 1 | Round 2 | Held by |
| --- | --- | --- | --- |
| Neutrals | warm grey `#f2f1ec`, deep-sea ink, a 1px ring on every group | ground `#f2f2f7`, groups `#ffffff`, separators `#e3e3e8`, ink `#1d1d1f`, secondary `#6e6e73`; at night `#000000`, `#1c1c1e`, `#2c2c2e`, `#f5f5f7`, `#98989d`; no outline, no bed | the token set in `globals.css`; `night-palette.test.ts` rewritten to these pairs |
| The tint | the shop's colour on every staff control | **one DiveDay blue**: `#0a7aff` for symbols, rings and figures at 20px and up (4.0:1 on white, where 3:1 applies), `#0064d2` for text and the one filled control (5.6:1 on white, 4.6:1 on its bed `#e6f0ff`); at night `#0a84ff`, `#6cb4ff` for text, `#102a47` the bed. The shop's colour stays on the storefront | a guard that no staff surface reads `shops.brand_color`; the contrast pairs in a test |
| Signals | red and amber words | `#d70015` and `#b35900` by day (5.4 and 4.8 on white), `#ff453a` and `#ff9f0a` at night, always beside a word; green `#34c759` / `#30d158` only as the aboard circle's fill under a white check, never as text | unchanged rule, new values |
| The face | Geist only (H-64) | **the device's own**: `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Helvetica Neue", Geist`, so every iPhone, iPad and Mac renders SF Pro; figures in `ui-rounded` (SF Pro Rounded) at 700 with tabular digits; Inter then Geist off Apple hardware. **Reverses H-64's one-face pick**; keeping Geist is deleting the first entries of the stack | `next/font` stops loading Geist on Apple hardware; `check:type-ramp` to six sizes |
| The ramp | six sizes at 500/600/700 | 34 · 28 · 22 · 20 · 17 · 15 · 13; names regular, section titles and figures bold, no capitals | `check:type-ramp` |
| Shape | 12px groups, 8px controls, rectangles for buttons | 20px groups and tiles, 12px controls, capsules for buttons, 46px for the screen; nothing lifted at rest; a floating bar or capsule casts `0 8px 28px` at 10% | `card.test.tsx` rewritten to two rungs |
| Density | 14px padding, 52px two-line rows | 16px insets, 50px rows, about 60px for name-and-why rows, 28px above a section title | the Row and Group primitives |
| Controls | small tinted rectangles | tinted capsules for every secondary act; one filled capsule per page; a grey capsule for the rare neutral act; the 44px circle whose fill is the state | `buttonClass` variants become three capsules |
| Icons | hand-cut strokes | re-cut at 26px with a 1.6 stroke on one geometry, the tint when current | `DiveDayIcon` re-cut (slice 22i) |
| The device | a bordered column | every pocket frame inside an iPhone with the island, the status bar and the home indicator; at night the same bezel on black | the canvas only; the app renders inside a real one |

The recommendation stands: **C · Figures**, and the redrawn boards argue it better than the words
did — a blue ring on white is the one picture of a boat filling that a shop owner remembers, and
under this surface it is no longer a dashboard because nothing around it is coloured. The call is
unchanged: **H-87, A, B or C.** The surface is slice 22b under any pick and can start the day the
letter is said; the face is inside 22a; the icons are 22i.

## Alternatives considered

- **A sixth round on Clear the deck** — declined: a canvas whose five pages argue eighteen calls is
  read by an agent as one instruction, and the brief this time is a pick, not a further step.
- **Console or Chart republished under a new name** — declined: both are drawn as a console (mono
  capitals, segmented gauges, a telemetry line), which is the cold the owner named each time; C
  keeps their one true idea, the figure that leads, and nothing of their form.
- **Asking the floor as calls, as H-77 did** — declined: every row is a consequence of a sentence
  the owner already said, and a floor that waits on a decision is not a floor. If the owner
  reverses a row, that is a new read recorded on H-87, not a call left open here.
- **One direction only** — declined: the brief asks for a few to pick from, and one drawn deep is
  what round 3 did; three complete products on one skeleton let the pick be made by eye.
- **More than three** — declined: six concepts and five surfaces were the menu that produced no
  pick; three that differ on one axis is the number a person can hold at once.
- **Apple's own type (the system face)** — declined for now: Geist is H-64's settled face and is
  close to it; a `system-ui` stack is a one-token change if a pilot shop's iPad says otherwise.
- **The tint as the shop's colour on staff surfaces** — round 1's choice, reversed by round 2: Blue
  Mantis's green showed that a shop's colour is whatever it is and half of them are dull, and a staff
  tool that changes its one accent per shop cannot be tuned for contrast once. The storefront keeps
  the shop's colour; the staff app wears one DiveDay blue.
- **Keeping Geist as the only face (H-64)** — reversed by round 2 for the surface, not the brand:
  the device's face is what makes Apple's software look like Apple's, and Geist stays as the fallback
  off Apple hardware and on DiveDay's own marketing pages until #1881 decides otherwise.

## Consequences

Easy: the floor is mostly deletion, and a direction is a small set of primitives on top of it — a
Group and a Row (A), a Bar, a TabBar and a Capsule with solid twins (B), a Figure, a Ring and a Tile
(C). Every frame on the canvas is drawn from the fiction the last eight canvases share, so the boards
compare with theirs. A pick is one letter.

Hard: the floor reverses accepted picks — Reef's tokens and ladder (H-64, 13a), the water band, the
greeting, the earned-moment budget for staff surfaces — and the tests that pin them (`card.test.tsx`,
`check:type-ramp`, the water-band, illustration and night-palette tests) are rewritten to pin the
floor, never deleted; the ADRs that record those picks stay as the record and this one supersedes
their surface decisions on acceptance. Each retired kind of thing (the eyebrow, the chip, the dial)
drove copy and tests on several surfaces, and the sweep is the cost in every estimate. Under B the
glass layer needs a measured legibility pass at the rail before the counter's iPad takes it.

Commits us to: nothing to explain — no label that says what a thing is, no colour without a word,
one shell, one row, one figure per surface — held by guards that refuse a new eyebrow, a new pill,
a new radius, a second figure and a sixth destination in the bar.

Escape hatch: if the owner declines all three, the floor's first three rows stand on their own and
this ADR moves to Accepted on them alone. Reversing a direction costs its primitives and one sweep
back; reversing the floor costs what it saved.
