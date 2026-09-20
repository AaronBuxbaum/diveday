# Surfaces

One entry per significant surface, carrying the five answers from
[the holistic pass](principles.md#the-holistic-pass-run-it-before-any-checklist) and nothing else.

The pass has always required its answers "in writing" and never said where, so exactly one surface in
this repo had ever recorded them (issue #825). Everywhere else the thinking evaporated when the
session that did it ended, and the next reviewer started from a screenshot.

## What belongs here

An entry when a surface is **significant** — the same judgment that decides whether something needs
an ADR. A page a shop lives in, a flow a diver is walked through, a marketing page carrying an
argument. Not a document per route, and not a required artifact on every pull request.

An entry is five sentences. If it is longer, it is drifting into the kind of description the code
already carries.

## Two things to copy from the one instance that worked

The shop home is the only surface whose one idea was written down before this file existed, and it
worked for two reasons worth generalising:

- **State it next to the code when it constrains the code.** `RoleOrientationCard`'s doc comment
  defers to the page's one idea *by name* — "the page's one idea is the queue, and a tinted
  orientation box above it…". That is more useful to whoever edits that component than any document.
- **Pin it with a test where it is load-bearing.** `RoleOrientationCard.test.tsx` fails if the
  orientation box out-ranks the queue. A one-idea statement a test enforces cannot rot.

So an entry here is the index; the constraint lives beside the code it constrains.

## Entries

### The shop home — `/shop/[shopSlug]`

**Proposed 2026-09-18** ([ADR 20260918-nothing-to-explain](../architecture/decisions/20260918-nothing-to-explain.md), [canvas](canvases/20260918-nothing-to-explain/README.md)): on a floor with no decoration, no eyebrow, no greeting and one shell, the home is a large title over the day's boats — each a group whose first row is the boat (A), a title with its count at the end over hairline rows (B), or four figures in tiles over A's groups (C). Pending H-87, one call: A · Inset, B · Glass or C · Figures. Superseded 2026-09-19.

**Decided 2026-09-19 (H-88)** ([ADR 20260919-one-idea](../architecture/decisions/20260919-one-idea.md), [canvas](canvases/20260919-one-idea/README.md)). Three whole products were drawn: the home is the thing the app is — the day under the sky at the shop's own hour, the boats on the hours they leave and the needs under each (I · Tide); today's boats as coloured hulls with their seats, stacked, the shop's card last (II · Deck); the shop's own water with today's tracks and the day as a sheet over it (III · Chart). No tabs, no More, no dock under any of them. **The pick: I · Tide** — the home is the day: the sky at the shop's own hour, the boats on the hours they leave, the tide under them, a line for now, and the needs under each departure.

**Shipped 2026-09-20, the evening says what the day made** (issue #1930; ADR 20260919-one-idea's decision I · Tide, "money is what the day made"). The evening close gains one money reading — the day's takings, as a figure with tips beside it — **above** the closing block and inside nothing, under the same condition that block renders under. `ClosingBlock`'s charter is two things and nothing else, so a figure inside it would have amended ADR 20260827-clearwater-surface-language decision 4 by implication; a reading is not an act, and Aaron decided the sibling placement in session that day. It is `getMonthlyReport` over `shopDayBounds` — the month's own derivation with narrower bounds, never a second query, so the day and `/reports` cannot disagree. Gated on `canPersonViewShopReports` against live role rows: a captain closing out a Saturday sees the evening exactly as before, with nothing in that slot and no notice that a number was withheld. A day that took nothing says nothing.

**Shipped 2026-09-17, the floor's first row** ([ADR 20260911-clear-the-deck](../architecture/decisions/20260911-clear-the-deck.md) §1, "the door" — the one row of that floor that may start on the ADR alone):
a row's own tap is its only door. The nine trailing "Open …" verbs are gone from the spine, the desk, the draft row and the first-morning checklist; what is left on a door row is the chevron `LedgerRow` already drew, and the destination is still named on the stretched overlay for a screen reader. A trailing verb survives only where it *is* the fix — a waiver send, a wait-list invite, an invoice resend, "Keep it", the closing block's own link beside a Dismiss demoted to ghost weight. Two tests in `DaySpine.test.tsx` hold it: no row that is itself a link may contain a second link, and a door's name may be spoken but never drawn. Shipped in the same pass: the desk's counting rows are their subject alone (the sentence under "3 messages are waiting on an answer" taught a feature already found); the units row states both guesses and what to do about them; a cancelled departure owes **one** row, not one per seat; the stuck-checkout row no longer prints a Stripe session id; the settled station draws one hairline between its parts instead of two; the plan-change clause is its own sentence on its own line; "Print the day" is the header's one action; and the first-bookable card and the role orientation never render together. The decoration (the band, the tile, the dial, the greeting) and `Badge` are untouched, pending H-77.

**Proposed 2026-09-11, six consolidations** ([ADR 20260911-clear-the-deck](../architecture/decisions/20260911-clear-the-deck.md), [canvas](canvases/20260911-clear-the-deck/README.md)):
the home loses its doors (a row's own tap is the door), its pills and chips (a state is a word), and — pending H-77 b — its decoration (the band, the tile, the dial, the coral washes); what it is then organised by is the owner's pick among six concepts, each redrawing this surface: three words, the week, the desk and the boat, one field, the shop's card, the storefront itself. Round 2, the same day, redraws the surface beneath any of them — five candidates to replace Reef (Salt, Air, Headline, Their ink, Slate), each on the home and the counter — pending H-77 e–h; round 3, the same day, draws one of them deep on the owner's word — Console, the instrument: the home's one readout is the countdown to the next boat, the day is a ladder of departures with their figures, every need a line with its state in a slot, daylight at the desk and depth after dark — pending H-77 i–l; round 4 puts the countdown on a display, a seat gauge under every boat and a telemetry line at the foot, pending H-77 m–o; round 5, on the owner's word that light must render light, prints the instrument on the app's own paper — Chart: the reading on a lit face, a boat as a sheet on the sand, the night palette as the one dark, glare as the crew's word at the rail — pending H-77 p–r. Nothing ships from it until H-77 is answered.

**Accepted 2026-09-07, the second look** ([ADR 20260907-in-your-hands](../architecture/decisions/20260907-in-your-hands.md), [canvas](canvases/20260907-in-your-hands/README.md)):
on a phone or tablet in a browser tab, a staffer whose role reaches the manifest sees one line under the day's spine, once per device, saying the roll call can open from the home screen without a browser bar or signal, with the platform's install prompt or its own menu item; installed, on a desktop, or dismissed, it renders nothing.

**Proposed 2026-09-07** ([ADR 20260907-nothing-from-nowhere](../architecture/decisions/20260907-nothing-from-nowhere.md), [canvas](canvases/20260907-nothing-from-nowhere/README.md)):
on a phone the greeting folds into the header bar as the page scrolls, driven by the scroll position; a cleared row's neighbours slide into its gap; the station chip's count rolls; every row and chip answers a press in the frame the finger lands. Each renders the cut, the swap or the tap of today when it is not true.

**Shipped 2026-09-06** ([ADR 20260906-before-you-ask](../architecture/decisions/20260906-before-you-ask.md), [canvas](canvases/20260906-before-you-ask/README.md)):
the desk group carries one "Unfinished" row while a staff form draft exists, and none otherwise; the palette opened from here answers a diver, a day or a departure with the fact and its fix before the doors.

**Proposed 2026-09-04** ([ADR 20260904-reef-all-the-way-down](../architecture/decisions/20260904-reef-all-the-way-down.md), [canvas](canvases/20260904-reef-all-the-way-down/README.md)):
the station becomes a panel with the tile leading and one sentence per row; the band follows the shop's clock; one fact of scale on the day it is true; a stage chip when the crew set one; the evening counts divers and crew. The clock, the fact of scale and the stage chip wait on H-67; the station as a panel waits only on the ADR.

**Reef, 2026-09-02** ([ADR 20260901-diveday-reimagined](../architecture/decisions/20260901-diveday-reimagined.md)):
the greeting is the one display moment on a staff surface (44/700, `ShopPageHeader`'s `display`);
the page top is the water band; every work row leads with its glyph; the head count is a dial in
`shallows`; the next boat's site mark carries the surface's one coral detail; the "First thing"
panel lifts the next boat's first blocking door above the spine; the morning's all-clear line
carries the green turtle; the two horizons are two tideline panels side by side.

- **One idea:** the work. What needs this shop today, in the order the day happens
  (ADR 20260720-today-work-queue; recomposed by
  [20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
  decision 4).
- **The question it arrives with:** "what needs me before the first boat?" — answered on screen, by
  the summary sentence and the first station's rows, without a click.
- **Controls that dissolved:** the queue's rows *are* their own controls — each row's own link goes
  to the thing it is about, and since 2026-09-17 says so with a chevron rather than a verb — and the
  urgency/by-departure view switch is gone with the views it chose between. The page's only standing
  control is "Print the day" in the header, on a day that has boats on it.
- **Remove first:** nothing currently; the orientation card is already conditional on first-run and
  the good-news lines already render nothing when untrue (see
  [settled-questions.md](settled-questions.md)).
- **Composition:** **the day's spine.** Today's departures are stations in clock order, each owning
  its time, title, site, hull, crew, price and head count, with its own blockers and chores as
  ledger rows beneath it; a diver's open day-of help request is one neutral row on that departure;
  work bound to no boat pools under "At the desk"; once every boat is settled the day's takings read
  above the closing block, for a reader who may read money; tomorrow is a collapsed disclosure and
  the rest of the week one link to the board. A departure's facts are said once, at its station,
  instead of once per card.

Enforced beside the code: `DaySpine.tsx` and `DayStation.tsx` defer to the ADR by name,
`DaySpine.test.tsx` pins the composition (including its silences and, since 2026-09-17, the door
rule), `FirstRunChecklist.test.tsx` pins the same rule on the first-morning ledger, and
`RoleOrientationCard.test.tsx` fails if the orientation box out-ranks the work or grows an emoji
back.

### The trip page — `/shop/[shopSlug]/trips/[id]`

**Proposed 2026-09-18** ([ADR 20260918-nothing-to-explain](../architecture/decisions/20260918-nothing-to-explain.md), [canvas](canvases/20260918-nothing-to-explain/README.md)): the four tabs become one page — the boat's facts, the needs and the roster as groups (A) or sections (B), or a ring of here of booked with five facts beside it over A's groups (C) — and Roll call is the page's one filled control or its floating capsule. Pending H-87, one call: A · Inset, B · Glass or C · Figures. Superseded 2026-09-19.

**Decided 2026-09-19 (H-88)** ([ADR 20260919-one-idea](../architecture/decisions/20260919-one-idea.md), [canvas](canvases/20260919-one-idea/README.md)). Three whole products were drawn: the departure is its hour with the strip zoomed to the voyage (I), its hull with every seat's initials and state (II), or its voyage on the chart with the legs as a timeline (III); one page, the roll call's tap untouched beneath. **The pick: Tide's hour with Deck's hull inside it** — the departure opens with its time over the sky and the strip zoomed to the voyage, then the seats laid out bow to stern.

**Reef, 2026-09-02:** the water band sits behind this header too — a wash, not a drawing. The
manifest beneath it keeps neither drawing nor coral (`illustration.test.ts`).

**Built 2026-08-29** — ADR
[20260827-the-departure-is-two-working-surfaces](../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md)
(Accepted), drawn in
[its canvas](canvases/20260827-the-departure-is-two-working-surfaces/README.md). Slices 5d and 5e
now make Trip the canonical working surface: the compact About disclosure owns the departure facts,
and the roster ledger owns who is coming and what still needs attention. The historical Guests route
remains available as a compatibility redirect, so consolidating the visible surfaces did not remove
the roster's actions or deep links.

- **One idea:** everyone who is coming, and whether they can. The roster *is* the page; what the
  dive is drops to a one-line summary that opens on request.
- **The question it arrives with:** "who still needs something before this boat sails?" — answered by
  the first group in the ledger, which is the only group carrying open work.
- **Controls that dissolved:** the filter chips (the groups do the filtering), the per-row Details
  caret (a row at rest is a name and a mark; open work is simply open), the Overview tab itself
  (a disclosure on this page), and `Add a diver` as a second page section (it is the ledger's
  terminal group, even when no one is booked yet). The masthead's own `Add diver` went with it in
  weight: it is a link-weight jump to that band, which keeps the act to one primary.
- **Remove first:** the Activity and Promote footer rows — kept only because a trip's history has no
  other home yet.
- **Composition:** one grouped ledger under a masthead, not a card stack — a roster is a list of
  people in states, and the state belongs to the group rather than repeated down every row; arrival
  guidance is authored with the departure details, while invite and add actions are its terminal
  bands, not detached forms.

**Amended 2026-09-17** (design review, "as rendered"). The About panel said every fact twice: five
label/value rows stating the plan, the conditions, who can book, the boat and crew and the repeat,
then five headed sections below them restating the same five subjects, each with its own summary
prose and its own `Edit …` disclosure, then three full-width series buttons and two destructive
ones, every one of them carrying a standing caption. About fifteen controls and eight captions for
five facts.

- **One grammar:** a row *is* its own disclosure. The label and the settled value are the summary,
  the editor opens in place beneath it, and there is no headed duplicate of anything. A row opens
  itself when its editor has an outcome to show, when the state is fail-closed (no requirements row
  at all), or when its subject has open work — the crew row does that, which is what keeps the
  pulse's "needs an instructor" link landing on something.
- **Controls that dissolved:** the five section headings and their five `Edit …` disclosures (the
  row carries both), the summary prose above each form (it restated the form directly below it),
  and the standing captions under the rare acts.
- **Collapse the rare path:** `Apply this date's details to every upcoming date`, `Stop repeating`,
  `Cancel every upcoming date`, `Weather blow-out…` and `Cancel this departure` are one closed
  `More for this departure` list at the foot of the panel — a single column of `link` and
  `danger-ghost` items with no captions. Each consequence sentence moved into the confirm or the
  page that item opens; the two irreversible series writes and the departure cancel keep a blocking
  `InlineConfirm`, and stopping a repeat has none because the control opposite it puts the run back.

**The long page, deliberately — decided 2026-09-20 (Aaron, in session; issue #1924).** Since slice
23c folded the packing list in, this is the tallest surface in the app by a wide margin:
`departure-load-out-handed-over` captures at **12,340px at 390** and **8,605px at 1280**, against
roughly 2,500px for the shop home. The visual suite's phone is 390×844, so that is about fifteen
screens of scrolling, and about eleven on its 1280×800 desktop.

`.claude/rules/e2e.md` says a surface that screenshots enormous is telling you the page is
unbounded, and the fix belongs in the product. **Here it does not.** A packing list *is* a long
document; the fold was the point of 23c; and the two halves are one job — who is aboard, then what
to pull for them. A crew member working down a boat scrolls anyway, and what they had before the
fold was a second page and a tab strip to reach it.

Not taken: collapsing the list's lower sections (tanks, sizes, staff fit, support, kit,
assignments) behind disclosures. That puts a lid on the half somebody arriving at `#packing-list`
came for, to answer a number rather than a complaint. Also not taken, and never: shrinking the
visual capture so the number reads smaller — that hides the measurement instead of answering it.

So the height is expected. **Measure it again when the page gains a part, not when it merely grows
with a shop's fleet** — the assignments table scales with the register rather than with this
departure, which is the one thing here that could turn a long page into an unbounded one.

### The boat manifest — `/shop/[shopSlug]/trips/[id]/manifest`

**Proposed 2026-09-18** ([ADR 20260918-nothing-to-explain](../architecture/decisions/20260918-nothing-to-explain.md), [canvas](canvases/20260918-nothing-to-explain/README.md)): the checkpoint card, the five stage chips, the three-way switch and the disclosure above the first name become the count and one line — at 34px in a group (A), at 44px under a floating bar (B), or as a ring that closes when everyone is aboard (C) — then the one still to call, then everyone aboard, one circle per name; glare is a word in the bar. Pending H-87, one call: A · Inset, B · Glass or C · Figures. Superseded 2026-09-19.

**Decided 2026-09-19 (H-88)** ([ADR 20260919-one-idea](../architecture/decisions/20260919-one-idea.md), [canvas](canvases/20260919-one-idea/README.md)). Three whole products were drawn: the roll call is the same picture as boarding — under Deck it is tapping the seats on the hull, under Tide and Chart the count leads and the names follow, one circle per name; glare is the crew's word in every case. **The pick: Tide**, so the count leads and the names follow, with the hull above them on a boat departure.

**Proposed 2026-09-04** (same ADR and canvas): a catch-up strip and a five-word stage strip at the top, the blocked word on the row, no drawing, coral or motion.

**Reef, 2026-09-02:** no drawing and no coral, mechanically — `src/components/illustration/illustration.test.ts`
walks `src/app` and `src/components` (the offline manifest lives in the second) for both. The
roll call's glass fills with `shallows`, the token minted for a fill that carries no fact.

**Built** — same ADR and canvas, slice 5a, delivered 2026-08-27
([shipped.md](../product/shipped.md#the-boat-manifest-becomes-an-instrument-delivered-2026-08-27)).
The design's whole argument is that this surface is worked *on a boat*, one-handed and wet, so its
content is tiered by when it is needed at the rail.

- **One idea:** the head count. Names, one big tap each, and how many are still to call.
- **The question it arrives with:** "who is not aboard yet?" — answered by the count and the
  still-to-call chips above the list, before any scrolling.
- **Controls that dissolved:** the two-button cluster per row (one circle whose fill *is* the state),
  the per-row pair of disclosures (one person panel), the checklist card and the device housekeeping
  card (one line each). The emergency band is the one piece still standing — it moved below the roll
  call rather than behind a `⋯`, which is slice 5c's.
- **Remove first:** nothing on the phone — it is already down to names, taps, and the count. On
  desktop, the audit line per row, if a dockside reader turns out not to want it.
- **Composition:** an instrument, not a console — a count that leads at 44px, a list that is mostly
  names and circles, and everything rare deliberately one tap away or ashore.

Two rules here are load-bearing, and both are now pinned beside the code: a destructive roll-call
claim is never a single tap, and no danger tone renders at a checkpoint where nothing has been
recorded. `RollCallControls.tsx` defers to the ADR by name and `DiverRollCall.test.tsx` fails on
either.

### The schedule board — `/shop/[shopSlug]/schedule/board`

**Shipped 2026-09-06** ([ADR 20260906-before-you-ask](../architecture/decisions/20260906-before-you-ask.md), [canvas](canvases/20260906-before-you-ask/README.md)):
the add panel opens filled from what the shop ran on that weekday over the last six weeks, under one sentence saying so, every value an ordinary field and the crew as chips (H-68 c); the pattern's second boat is offered as a row and never added on its own; a shop with no history, or a panel opened with a draft, a course, a site or a request, sees the panel it always did.

**Reef, 2026-09-02:** every departure's site mark, drawn in the line alone — the board has no one
boat to give the coral detail to, so none carries it.

**Shipped 2026-08-28 (desktop only)** — slice 6e of ADR
[20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md),
drawn in [its canvas](canvases/20260827-clearwater-surface-language/README.md). The stream stays
below `xl` (1280px), on tablets and phones.

- **One idea:** the shape of the week — where the boats are, and where they aren't.
- **The question it arrives with:** "what does my week look like?" — answered in one screen of
  seven columns rather than seven screens of scroll.
- **Controls that dissolved:** none new; the row's `⋯` menu and per-day "+ Add" carried over — the
  menu's panels open full width beneath the grid, because a move form is two date/time fields and
  a 160px column is not a form.
- **Removed 2026-09-17:** the standing "Usual crew: …" line above the phone stream (what survives
  is the rule it carried — a row running the board's usual crew prints no crew line, so any row
  that does is the exception), and the header's "View public page" button, demoted to link weight
  beside Add a departure and Add a booking. The week grid's card titles clamp to two lines rather
  than truncating: the site is the title's second half, so one clipped line hid which boat a cell
  was about.
- **Remove first:** nothing left above the board; the row `⋯` menu is the next candidate.
- **Composition:** a week grid at desktop because the content is a calendar; the phone keeps the
  stream because a seven-column grid has no honest 390px form.

### Settings — `/shop/[shopSlug]/settings`

**Harbor, 2026-09-02:** the brand fields end in a preview of the brand as it reads by day and at
night (`BrandPreview`), and the contrast note reports whichever scheme moved the colour.

**Shipped 2026-08-28** (slice 6g) — same ADR and canvas. The phone keeps grouped lists.

- **One idea:** every switch in the shop, findable in one look.
- **The question it arrives with:** "where do I change X?" — answered by the rail: all three groups
  in the pane's own order, with the group being read named at the top of the column (its label is
  sticky inside the rail's scroll area) and the group holding the current row tinted. Forty-two rows
  do not fit beside the bar on any viewport at a legible row height, so the rail scrolls in its own
  right; what it must never do is let a reader believe Money and Data & integrations are not there.
- **Controls that dissolved:** the standing caption under every door row — the row's current value
  is the description.
- **Remove first:** nothing beyond the captions; the three groups already carve the space
  correctly.
- **Composition:** rail and pane, because settings are a directory and a directory reads as a tree,
  not a queue.

### Orders — `/shop/[shopSlug]/orders`

**Built 2026-08-29** — same ADR and canvas.

- **One idea:** the money ledger, day by day.
- **The question it arrives with:** "what came in, and is anything still open?" — answered by day
  subtotals and the rare `Open` badge, without reading fifty identical rows.
- **Controls that dissolved:** the five-control filter card demotes to a toolbar; the date column
  dissolves into the day group header.
- **Remove first:** the second imported-history table — it becomes one disclosure row.
- **Composition:** a grouped ledger because orders share their date, and a shared fact belongs to
  the group (principle 9 applied to a table).

### The counter — `/shop/[shopSlug]/check-in`

**Chosen 2026-09-07, the second look** ([ADR 20260907-in-your-hands](../architecture/decisions/20260907-in-your-hands.md), [canvas](canvases/20260907-in-your-hands/README.md)):
a blocked row whose fix is the release gains *Sign here* as its primary, which locks the desk behind the diver's own waiver page on the shop's device and reopens the counter with the row settled once a staffer signs back in; the signature records the counter, the device, who handed it over and when. H-70 b decided yes.

**Proposed 2026-09-07** ([ADR 20260907-nothing-from-nowhere](../architecture/decisions/20260907-nothing-from-nowhere.md), [canvas](canvases/20260907-nothing-from-nowhere/README.md)):
the instrument line's figures roll as a check-in lands, the sinking row's neighbours slide into its gap on the same 200ms, and Undo runs both in reverse. The optimistic commit principle 1 grants the counter is what the motion follows.

**Built** — same ADR and canvas, slice 6h, delivered 2026-08-28. Safety-adjacent; gets the
`dive-domain-expert` pass.

- **One idea:** who has walked in, against who should.
- **The question it arrives with:** "how many are still to come?" — answered by the count figure
  before any list.
- **Controls that dissolved:** per-row state text — the tap circle *is* the state; settled rows
  sink into one collapsed group, and since 2026-09-17 they carry no state of their own at all:
  the group header says "Checked in — 5 · all boarded" once for every row under it, each row keeps
  only what singles that person out, and the pass demoted to link weight as the row's one act. A
  blocked row says one thing, and it is the gate.
- **Remove first:** the day's other boats from standing view; one departure is in focus, the rest
  one tap away.
- **Composition:** an instrument over a queue, inheriting the manifest's count-first grammar
  ashore.

### The public schedule — `/s/[shopSlug]`

**Proposed 2026-09-18** ([ADR 20260918-nothing-to-explain](../architecture/decisions/20260918-nothing-to-explain.md), [canvas](canvases/20260918-nothing-to-explain/README.md)): Harbor's face on the headings and the shop's colour on the one filled control, over the picked direction's rows: the boat that is out, the next boat with space and Book, the week, the courses — as groups (A), as the page with one floating capsule that books the next boat (B), or with two tiles for spots and the boat that is out (C). Pending H-87, one call: A · Inset, B · Glass or C · Figures. Superseded 2026-09-19.

**Decided 2026-09-19 (H-88)** ([ADR 20260919-one-idea](../architecture/decisions/20260919-one-idea.md), [canvas](canvases/20260919-one-idea/README.md)). Three whole products were drawn: Harbor's face and the shop's colour over the idea's own front page — the next boats led by their time under the noon sky and the week as seven days (I), the boat you are about to book with its empty seats visible (II), where we go on the shop's chart (III). **The pick: Tide** — the shop's name and the day over its own sky, the next boats led by their time, the week as seven days with seats left.

**Tidied 2026-09-17** (the "as rendered" sweep, slice F1). Three things, all layout and disclosure — no feature left the page. The identity band's panels — the off-season card, the boat that is out, the next boat with space, the season band — each held `max-w-md` and stacked down the left third of a 1152px page, three unrelated boxes with two-thirds of the width beside them empty; they are one row now (`grid-flow-col` with `auto-cols-fr` at `md` and up, the stack on a phone), which reads at one panel or at four. The lens rail met a diver with ten or eleven controls at rest — seven chips, two selects, one or two checkboxes and a counted sentence — so the four filters moved behind one quiet "Filter" disclosure inside their own `<form>`, open on first paint whenever the URL already carries one of them, and the rail at rest is the shop's own chips. The sentence above the list ("3 departures ask for more than Open Water. They are still bookable: ask the shop.") was deleted: the rows already say "Above your level" and the shorter list is one tap away in the same panel.

**Proposed 2026-09-04** (same ADR and canvas): a live panel when a boat is out, "next with space", and a lens rail of the shop's own words.

**Harbor, 2026-09-02:** every heading the diver meets is in the shop's face — the name in the bar,
the four sections, each boat's name — and the fact beneath each stays in Geist. The hero carries
the shop's about line (`shops.description`); the boats block carries the shop's own sentence per
hull; the courses shelf says how long and when next; the footer names DiveDay once.

**Shipped 2026-08-28** (slice 6i) — same ADR and canvas. Conversion surface; gets the
`conversion-reviewer` pass. **Redrawn as Harbor (ADR 20260901-diveday-reimagined, slice 13c, shipped 2026-09-01):** the same composition in the shop's own brand — its colour, display face, hero
photograph, badge wall, quotes and boats — with DiveDay as a credit line. `/s/[shopSlug]/reviews` restyled with it, and the two public course
routes took the display-scale h1 only.

- **One idea:** this shop is worth your dive day — and the next boat is right there.
- **The question it arrives with:** "is this shop good, and can I get on a boat?" — answered by the
  identity line, the review aggregate, and the next-boat card before any scrolling.
- **Controls that dissolved:** the per-row metadata stack (six lines collapse to one; the trip page
  answers the rest); the month navigator demotes below the hero.
- **Remove first:** the conservation disclaimer card at the top — it becomes one line in the hero.
- **Composition:** a shopfront — identity, then the week as a shelf, then courses and reviews —
  because a diver is choosing a shop before they are choosing a time slot.

### The public trip page — `/s/[shopSlug]/trips/[id]`

**Tidied 2026-09-17** (the "as rendered" sweep, slice F1). "What the crew logged, and when. It says what was seen, not what you will see." closed every "Seen here this month" block, so a two-tank day printed it twice, twelve lines apart. It is the **day's** sentence now — once, under the plan, whenever any site in the day has a month to show. And the embed's booking confirmation stopped offering three link-blue lines at one weight: the readiness page is the button, the way back into the widget is quiet text (and the readiness door demotes to `secondary` when there is a balance to pay, which is then the section's one primary).

**Shipped 2026-09-06** ([ADR 20260906-before-you-ask](../architecture/decisions/20260906-before-you-ask.md), [canvas](canvases/20260906-before-you-ask/README.md)):
reached from the thread's next-dive link, the page arrives knowing her: the verified card, the waiver that still covers this trip, her gear and her emergency contact folded into one panel, each naming the day it was kept, with her name, email and phone prefilled into the fields that are the doors to change them; "Not Yara? Start with a blank form" stands beneath. A cold visitor gets the form that ships, and the page reveals nothing to anyone who did not arrive through the handoff. A matching cold email may receive one link an hour (H-68 b); nothing on the page says whether it went.

**Proposed 2026-09-04** (same ADR and canvas): bounded to three field-guide tiles and a door above the form (the shipped page is 5,782px at 390 before it), two alternates with reasons, one optional intent question, a kind offer to a diver who has been away.

**Built 2026-08-28** (slice 7b) — ADR
[20260827-the-divers-thread](../architecture/decisions/20260827-the-divers-thread.md) (Accepted),
drawn in [its canvas](canvases/20260827-the-divers-thread/README.md). Conversion surface.

- **One idea:** this boat is worth your Saturday — and here is the one place to say yes.
- **The question it arrives with:** "what will I see, where do I meet, what changed, and can I get
  on?" — answered by the pitch, arrival card, change ledger and scarcity word before any booking
  work.
- **Controls that dissolved:** the boxed requirement note (one sentence), the boxed gear fieldsets
  (hairline steps of one sheet), the five-piece money story (one block), and the sticky pill's
  duplicate seat count (verb only); saving the arrival card is an opt-in link on the card itself.
- **Removed:** the packing section, which is preparation rather than pitch and moved to the thread
  in 7b; and the swipeable briefing deck, deleted outright in 7c. The 2026-08-28 diver-views review
  put the deck's *pictures* back without the deck: "Look for" shows each species' bundled photo
  beside its name, and the published diver moments render as one capped strip (`TripMoments`) —
  beats, not a gallery.
- **Composition:** sell then close — the form is the page's terminal word, so the primary is where
  a decided diver already is; the arrival card follows the hero and the change ledger follows the
  conditions reading so practical wayfinding never competes with the pitch.

### The regional pages — `/dive` and `/dive/[region]`

**Built 2026-09-07** — N-49 (issue #1436), the one place DiveDay lists shops beside each other: a
town, and the shops that dive out of it.

- **One idea:** a diver who knows *where* they will be, and not yet *who* with, gets a way in.
- **The question it arrives with:** "who runs boats out of Key Largo?" — answered by the town's own
  page, one row per shop, each row the shop's own name and its own line about itself.
- **Controls that dissolved:** every filter anyone would reach for. There is no search box, no map,
  no sort: a town has a handful of shops and a list of them needs no instrument.
- **Remove first:** anything DiveDay would be saying *about* a shop. A row carries only what the
  shop authored and its storefront already shows a stranger, so a shop that has written no tagline
  gets a shorter row rather than a generated one. Departures stay on the storefront one tap away —
  putting "next out" on every row would fan an unbounded town out to three reads a shop on a page
  crawlers hit. That is decided, not deferred: the owner settled it on 2026-09-10 (issue #1511)
  against #1436's original spec, which asked for departures. The town page is a list of shops.
- **Composition:** the marketing chrome with its trial pitch suppressed (a diver looking for a boat
  is not that audience), the page's name, one line saying these shops book through DiveDay, then
  the hairline ledger the diver-facing catalog already uses.

### The product page — `/product`

**Reviewed 2026-08-31** — conversion surface, governed by
[marketing.md](../product/marketing.md)'s claims and control budget.

- **One idea:** the whole dive day can run from one shared record, and a shop can try it before it
  makes a buying decision.
- **The question it arrives with:** "will this cover the day, what does it cost, and can I see it?"
  — answered by the capability proof, a sourced price line in the first screen, and the demo door.
- **Controls that dissolved:** a second hero action for price; cost is a quiet sentence under the
  existing demo note, leaving the demo as the one action.
- **Remove first:** any repeated price story above the capability proof; the source-backed hero
  sentence answers the comparison question without competing with the page's argument.
- **Composition:** claim, price, proof, then door — not a sales dashboard. The page earns a trial
  by showing a shop's day, then gives the interested visitor one place to continue. The reference
  index that follows the argument is closed at rest (2026-09-17): nine hairline rows, each a
  `<details>` naming its group and counting its lines, so the page ends where its argument does
  instead of running on through ninety-odd bullets.

### The thread — `/ready/[token]` (and every state after booking)

**Chosen 2026-09-07** ([ADR 20260907-nothing-from-nowhere](../architecture/decisions/20260907-nothing-from-nowhere.md), slice 18f, [spec](canvases/20260907-nothing-from-nowhere/SPEC.md)):
one line beside Add to calendar, *Add to Wallet*, on every state after booking; the pass wears the shop's brand, carries the top card's facts, the diver's name and the crew-set stage, surfaces on the lock screen from the dock call, and updates when the plan moves. Never the thread's URL, a barcode, a price or a medical fact. Rendered only when a platform is configured; otherwise the thread as it ships.

**Proposed 2026-09-04** (same ADR and canvas): one step, "Anything changed?", over the facts the shop kept; provenance on the arrival card; the boat's-back line on the day; the recap becomes a postcard with its number, an image to keep, a private pulse and the next dive with its reason.

**Built 2026-08-29** (slices 7c and 7d) — same ADR and canvas. Extends ADR
20260820-one-page-after-booking.

- **One idea:** the one link that answers "am I ready, and what's next?" for this trip — before,
  during, and after.
- **The question it arrives with:** "what do I still have to do, where do I go, and who has my
  hand-off?" — answered by one figure and the named next step first, then the shared arrival card,
  change ledger, party status and one small help request.
- **Controls that dissolved:** the receipt panel, the emails line and the per-row Done chips (the
  steps' settled lines say it once); the four inline forms at rest (one open step at a time); help
  is a controlled choice, never a free-text support inbox; the trailing "Your dive shop" card
  (2026-09-17), whose address, phone, email and map link the arrival card two screens above had
  already given — the embedded map moved into "Where to go", where the shop's own arrival photo
  outranks it, and the shop's first-visit welcome moved to the top of the thread, since a greeting
  that arrives below the button releasing your seat is not greeting anybody.
- **Remove first:** nothing after the fold — the after-state already absorbed the recap page.
- **Composition:** a step spine, because getting ready is a sequence, followed by the reusable
  arrival/change reading and the party hand-off; the same spine grammar the staff home speaks makes
  the product one product.

### The shelf — `/shelf/[token]`

**Built 2026-09-10** (slice 20t of [ADR 20260908-one-hand](../architecture/decisions/20260908-one-hand.md)).
The first bearer surface anchored to a **person** rather than to a booking, so it outlives every
seat: `person_shelf_tokens`, stored and revocable, and erasure closes it.

- **One idea:** what this shop already holds for me, and the next reason to come back.
- **The question it arrives with:** "when am I next out, and what do you have for me?" — answered by
  the seat the diver holds, the same boat next time, and the crew's own "next time" from the day
  just dived, in that order, before the file.
- **Controls that dissolved:** none — this surface is new. What it deliberately never grows: a
  medical answer, another diver's anything, a price. The reader (`src/db/shelf.ts`) cannot return
  any of the three, and its test walks the whole object rather than the fields somebody remembered.
- **Remove first:** the file's rows, before the reasons to come back. A shelf with nothing on it is
  still worth opening for the next departure; a shelf with nothing ahead of it is a filing cabinet.
- **Composition:** the thread's shell and measure, in the shop's brand — a diver who reached this
  from their thread should not feel they left the shop. Two quiet lines close it: what is never here,
  and "Forget this phone", which clears the storefront's greeting cookie and nothing else.
- **What it leaves elsewhere:** the storefront reads that cookie and greets the diver by first name
  with which visit the next one is, puts a "Yours" group above the week, and says why a departure
  demanding a card is open to them instead of the warn pill. Without the cookie the storefront is
  unchanged.

### The waiver — `/waivers/[token]`

**Built 2026-08-29** — same ADR and canvas. Legal surface: wording and presentation floor are
H-01/H-03's.

- **One idea:** two minutes of paperwork, paced so it feels like two minutes.
- **The question it arrives with:** "how much is left?" — answered by the step rail's count.
- **Controls that dissolved:** the second submit's button chrome (save-later is a link beside the
  expiry line); three bespoke banners (one notice grammar).
- **Remove first:** nothing — the release must stay fully presented.
- **Composition:** three steps under a quiet rail; the sign card is the page's one worked-in card.
  Each medical question is a bordered `<fieldset>` whose `<legend>` **floats** (2026-09-17), so the
  question flows inside the box instead of straddling the top border a browser draws its rendered
  legend in — eleven questions cut through their own boxes, which on a legal surface reads as a
  rendering fault. Presentation only: the semantics that name each radio group, and every word of
  the release and the questionnaire, are untouched (H-01/H-03).

### The gear register — `/shop/[shopSlug]/gear`

**Built 2026-08-29** — ADR
[20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md) (Accepted),
drawn in [its canvas](canvases/20260827-the-shops-shelves/README.md).

- **One idea:** where every unit is, said once.
- **The question it arrives with:** "what's out, and what's coming back?" — answered by the Out
  and Due back groups before any scrolling.
- **Controls that dissolved:** the three stat tiles and the Returns panel (the groups are the
  state); per-row acts ride the rows; and, 2026-09-17, the header's "Add gear" button — the
  register ends in the "Add a unit" band the way the trip roster ends in "Add a diver", and a
  header door onto the same disclosure only scrolled the reader back down to it.
- **Remove first:** the service sentence on healthy units — it already renders only when it has
  something to say.
- **Composition:** one grouped ledger because reservation state is the register's whole subject,
  and three renderings of it were two too many.

### Staffing — `/shop/[shopSlug]/staffing`

**Built 2026-08-29** — same ADR and canvas.

- **One idea:** the week's crew, and the one hole in it.
- **The question it arrives with:** "is every boat covered?" — answered by the Needs-crew row's
  day cells, which render nothing when the answer is yes.
- **Controls that dissolved:** the two standing add-forms (doors now); the inline credential
  badge stack (one renewal word); and, 2026-09-17, the standing "Name divers see" form — a
  summary-first row stating the answer ("Shown as Dana" / "Not shown") that opens the form on a
  tap. A gap cell carries one act, chosen by the reader: "Assign ›" for somebody who can crew the
  boat, "Ask for this one" for somebody who can only ask.
- **Remove first:** nothing — the week grid is already the minimum that shows coverage. The
  Credentials group no longer renders a heading over an orphan door: with nothing on file the door
  is the group and names itself.
- **Composition:** people × days, because coverage is a grid question; the gap carries its act in
  the day it lives (H-59 keeps credentials inform-only).

### Reports — `/shop/[shopSlug]/reports`

**Built 2026-08-29** — same ADR and canvas.

- **One idea:** how the month is going, in five figures and the boats behind them.
- **The question it arrives with:** "how are we doing, and what needs chasing?" — the figures
  answer the first; the amber waiver remainders answer the second.
- **Controls that dissolved:** six bordered tiles (figures over hairlines); the CSV link joins
  one quiet line with tax.
- **Remove first:** the second imported-history apparatus, already folded by the orders ledger's
  precedent.
- **Composition:** figures then a ledger — the shape it always had, with the chrome removed.

### The diver record — `/shop/[shopSlug]/divers/[personId]`

**Declined 2026-09-07, the second look** ([ADR 20260907-in-your-hands](../architecture/decisions/20260907-in-your-hands.md), [canvas](canvases/20260907-in-your-hands/README.md)):
the card reader is not built and no photo capture is added; the certification form ships as it is, and a card carries no photograph (ADR 20260811-retire-the-digital-card). The canvas's premise that one already did was wrong.

**Answered 2026-08-27, shipped** — ADR
[20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md), drawn in
[its canvas](canvases/20260827-people-not-lists/README.md), built as slice 8b. This entry replaces
the "unanswered, and known to be" record that stood here since issue #780. Two rules are pinned in
code: the status section renders nothing when `buildDiverStatus` is empty
(`_lib/status.test.ts`, `_components/DiverStatusLedger.test.tsx`), and exactly one
primary-weight control lives on the page (`_lib/record-primaries.test.ts`).

- **One idea:** this diver, ready or not — and the one fix if not.
- **The question it arrives with:** "can they dive with us, and is anything in the way?" — answered
  by the status ledger under the masthead, which renders *nothing* when they are clear.
- **Controls that dissolved:** the jump nav (the page got short), the stat tiles (each figure lives
  in its group), the twin certification sections (one group, one add flow), the three lists of the
  same bookings (one story), the refund button (money out is the Orders ledger's act) and the
  Connect-payments CTA, leaving Book as the one primary.
- **Remove first:** the merge panel's standing card — it earns its place only while candidates
  exist, and the redesign keeps it conditional.
- **Composition:** status, story, file — a person is a readiness question, a history, and a set of
  facts, in that order; ten co-equal sections answered no question first.

**Amended 2026-09-17, the file is one door grammar.** The 8b build shipped two: "legacy" groups
(certification records, waiver, gear and sizes, diver notes, conversation) hid their summary above
`sm` and rendered open as `InsetGroup` cards under a second, uppercase copy of their own label,
while the newer groups (shelf, dive support) stayed doors at every width. Down one page they
interleaved — an open bordered card, a closed row, another open card — and the phone, which had
only ever had the doors, was the cleaner page. Every group is now a door at every width, its row
label is its `<h2>` and its fragment target, and its summary is its one **useful** fact rather than
a queue state: the levels on file rather than "None waiting", the release's standing **and its
date**, "{n} notes", "{n} unanswered". A group opens itself only for work the staffer came for — a
notice aimed at it, an unanswered message, a held medical review, a standing can't-fill flag, notes
somebody wrote. The activity trail joined the same grammar; it was the last `LedgerGroup` on the
page. Pinned by `page.composition.test.ts` (no second heading inside a group, no group that opens
itself at a breakpoint) and `_components/DiverFileGroupDisclosure.test.tsx`.

Two controls went quiet with it: the certification row's `Delete`, a bordered `danger` button
standing on every row of a safety-critical group, is `danger-ghost`; and "Can't fill one of these
sizes?" — a heading, a two-line caption, an input and a button under the gear facts on every diver
who rents anything — is one link-weight door, its caption deleted (it described what the flag does
to the packing list, which is the mechanism, not the outcome).

### The departures board — `/board/[token]`

**Built 2026-09-07** — N-23 (owner decision 2026-09-07, issue #1426), the shop's day on a screen
nobody touches: a TV in the lobby, a tablet on the dock, behind a display link minted at
Settings → Lobby display.

- **One idea:** the boat you are looking for, from across a room — when it leaves, where it is,
  how full.
- **The question it arrives with:** "is my boat still boarding, and where do I go?" — answered by
  the time, the crew's own stage word and the meeting line on the same row, at 24px or larger.
- **Controls that dissolved:** all of them. No nav, no session, no tap; the page re-reads itself
  every minute and the only act (revoke) lives on the settings page that made the link.
- **Remove first:** anyone's name. The row is a count ("3 of 12 aboard"), a private charter is
  "Private charter", and the crew line exists only on a link minted with names on.
- **Composition:** the shop's name and the date, then one row per departure in clock order —
  time · title, site, meeting point, outlook · stage word and count — on the manifest's
  `boat-mode` ground so it follows the device's light or dark; the footer says when it last read.

### Self check-in at the counter — `/check-in/[token]`

**Built 2026-09-09** — N-24, the other thing a display link can open: a tablet on the counter that
a diver operates unaided, behind the same credential and the same revocation door as the board.

- **One idea:** type your last name, learn whether you are set — and if you are not, learn it
  standing in front of somebody who can fix it.
- **The question it arrives with:** "am I checked in, and where do I go?" — answered in one
  submission, because a lookup step would mean a screen listing who was found.
- **Controls that dissolved:** all but one box and one button. No nav, no session, no account, no
  second step; the answer clears itself after twelve seconds so the next diver walks up to a blank
  prompt.
- **Remove first:** every reason. A miss, an ambiguous surname and a diver readiness will not clear
  are one identical sentence — the screen is operated by whoever walks up to it, so an answer that
  varied with *why* would answer questions about a stranger's booking to anyone willing to type.
- **What it must never do:** board anybody. It records an arrival; boarding stays a roll-call act
  the crew performs at the rail.
- **Composition:** the shop's name and today's date, the prompt, one box, one button — then one
  card, in success or caution tone, at 24-32px so it reads at arm's length across a counter.

### The doors — `/sign-in`, `/onboard`, and the token family

**Chosen 2026-09-07, the second look** ([ADR 20260907-in-your-hands](../architecture/decisions/20260907-in-your-hands.md), [canvas](canvases/20260907-in-your-hands/README.md)):
on a device that holds a passkey for the account, `/sign-in` is one primary and the device's own check, with the password as the link out; every other device gets the form as it ships. The door keeps its anatomy and its one primary; sign-out keeps its two taps. H-70 a decided yes, the step-up included.

**Built 2026-08-29** — ADR
[20260827-first-light](../architecture/decisions/20260827-first-light.md) (Accepted), drawn in
[its canvas](canvases/20260827-first-light/README.md). One entry for the family
(`/forgot-password`, `/reset-password`, `/verify`, `/invite`, `/unsubscribe` — and `/claim`,
which leaves for the thread), because they are one surface: `EntryShell` is the page.

- **One idea:** one column, one act — a door asks for exactly one thing and gets out of the way.
- **The question it arrives with:** "am I in the right place, and what do I type?" — answered by
  the wordmark (whose house this is) and a single h1 naming the act.
- **Controls that dissolved:** onboard's h2 section rules (group labels), three of its four
  reassurance sentences, claim's hand-rolled header and panel (ThreadShell), the emoji glyphs
  (a closed drawn set).
- **Remove first:** nothing standing — the family was already lean; the discipline is refusing
  additions (a door never grows a second primary or a marketing aside).
- **Composition:** wordmark, h1, one form or one sentence, one primary, quiet footer — and two
  dead-link tiers: account tokens never name a shop, booking tokens always offer the shop's hand.

### The homepage — `/`

**Reviewed 2026-08-27** — the conversion pass in
[marketing-review-20260827.md](../product/marketing-review-20260827.md) (open; slices in roadmap
section 12). The 2026-08-13 composition stands; the findings move copy, not bands.

- **One idea:** the whole dive day runs from one calm place — and you can walk it right now for
  free.
- **The question it arrives with:** "what's the catch — cost, time, and can I get out?" — the
  exit is answered by the diptych; the review moves cost into the hero and answers time in the
  records band.
- **Controls that dissolved:** the nine-choice hero (2026-08-13, down to one primary + one
  secondary, test-pinned); the mid-page demo door; the stacked switching links.
- **Remove first:** the moments band's abstraction sentence — its concrete twin does the work.
- **Composition:** a day told in order — hero, shared-day statement, moments (which the review
  extends to the evening), breadth as four numbered assertions, the mirrored records diptych,
  one merged close.

**The hero became the visitor's, 2026-09-10** — ADR
[20260908-one-hand](../architecture/decisions/20260908-one-hand.md) decision 6, possibility Y,
drawn on that canvas's `TryItWithYourBoats.dc.html`.

- **One idea:** the demo is you — a page that draws the visitor's own shop, in the visitor's own
  colour, from three words.
- **The question it arrives with:** "yes, but what does it look like with *my* boats?" — the one
  question a screenshot of somebody else's shop cannot answer, and the one a shop owner asks first.
- **What it never does:** look anything up. No website, no listing, no logo, no stored keystroke.
  The hero says both halves on its face — "Drawn from what you typed" over the drawing, "Nothing is
  saved until you open it" under the door — and that is what keeps a page arguing from a visitor's
  own name inside the claims policy.
- **Controls that dissolved:** none, and that is the constraint the composition was built inside.
  The three fields sit under the two doors, "Draw my day" is inert until there is something to
  draw, and the demo still leads at first paint.
- **Composition, drawn:** their chrome, the day as a line with their boat on it, the app's own
  greeting, one sentence naming the time and its zone, a live countdown, three rows that are one
  door, the primary that opens it.
