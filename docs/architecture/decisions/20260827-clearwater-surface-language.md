# 20260827-clearwater-surface-language — Type leads, chrome recedes: the Clearwater surface language

- **Status:** Accepted
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-clearwater-surface-language/README.md) —
  ten artboards on three pages: **The language** (the system board), **The staff app** (the home in
  its morning and evening readings, the week board, orders, settings, the counter), and **The
  shopfront** (the public schedule at desktop and phone). Those pictures are illustrative and this
  record is normative — the split is [design/design-artifacts.md](../../design/design-artifacts.md).
  The trip and manifest surfaces are deliberately out of scope: they were designed the same day in
  [20260827-the-departure-is-two-working-surfaces](20260827-the-departure-is-two-working-surfaces.md),
  and this language generalises that canvas's grammar rather than competing with it. The
  marketing, legal and error surfaces are also outside every recomposition here — they are
  carried by decision 1's shared-primitive mechanics only (their visual diffs in the first
  slice's re-baseline are expected), and the account doors belong to
  [20260827-first-light](20260827-first-light.md).

## Context

An app-wide design evaluation (2026-08-27: full-page screenshots of eleven surfaces at two widths,
plus a mechanical inventory of the component layer) found the same defect on nearly every page, and
it is compositional rather than cosmetic. The tokens are good. The primitives are good. The pages
are **stacks of bordered boxes**, and the boxes repeat what their groups should own:

- **One composition everywhere.** `SectionCard` unified the card's spelling (209 hand-rolled panels
  across 153 files at four radii), but it also froze the *stack of cards* as the app's only
  composition — which principle 11 calls the fallback, never the target. 28 files still hand-roll
  panels; 47 hand-roll the section heading; section rhythm is ad-hoc margins (`mt-6` ×92, `mt-8`
  ×83) rather than a page-level stack.
- **Repetition at page scale.** Today renders twelve near-identical card boxes in which one
  departure's title appears eight times; Orders repeats the trip title and the date down every row
  of a 20-row table; Close-out re-renders the same queue rows as a third card idiom with Dismiss
  buttons. Principle 9 ("say a shared fact once") is enforced within lists and violated between
  them.
- **The best surfaces already broke the pattern — independently.** The schedule board and the
  public schedule both dropped cards for hairline-separated rows directly on the page background
  under sticky day headers. The two calmest, most legible surfaces in the app converged on the same
  grammar without a rule telling them to. Settings converged on the other good grammar: rows inside
  one hairline shell under a small-caps group label.
- **Vocabulary drift where the language is silent.** Four pill idioms (`Badge`, `FilterChips`,
  `KindChip`, three ad-hoc), two empty-state idioms, two `rounded-3xl` one-offs, an h2 with ~20
  one-off spellings beside the 63 canonical ones, `text-sm` outnumbering every other size 6:1, and
  a chrome height hard-coded into a child component (`sticky top-[68px]`).
- **The staff app is 85% small muted text under a 36px title** — everything between whispers at
  one volume, so nothing leads.

Meanwhile the roadmap's concept-model table already carries an owner-facing proposal this
evaluation independently re-derived: **the home should read as the shop's day** (Today, the counter
and Close-out are three renderings of one day), and Close-out's own page is visibly Today's evening
mirror.

## Decision

**DiveDay's surfaces adopt one language — Clearwater. Hierarchy is carried by type and space;
groups own their shared facts; chrome recedes; elevation is earned.** Ten decisions, the first
three mechanical and app-wide, the rest recompositions of specific surfaces.

Over all ten stands a direction Aaron set on 2026-08-27 (H-62): **fewer surfaces, each with one
obvious next action.** Where a destination exists only to re-render another surface's content in a
different order, the default is to fold it, not to restyle it — and every surface that remains must
answer "what do I do here?" without the reader hunting.

### 1. Elevation is earned

A panel at rest is **flat**: `bg-surface`, a 1px `--border` hairline, `rounded-2xl`, **no shadow**.
Shadows belong exclusively to things that float above the page — menus, sheets, dialogs, toasts.
`shadow-sm` retires from resting cards, tables and stat tiles. (Rejected alternative below explains
why the borderless iOS treatment is not available to this palette.)

### 2. Two grouped anatomies are the default composition; the card stack retires

- **The open ledger** — rows directly on `--background`, separated by hairlines, under a group
  header that owns every fact the rows share (a date, a departure, a state word, a count). For work
  surfaces: the home, the board, orders, the counter, rosters, the public schedule. This is the
  grammar the board and the public schedule already found; it becomes the rule rather than the
  exception.
- **The inset group** — rows inside one hairline shell under a small-caps group label, for
  configuration and object lists: settings, forms' summaries, detail panels. This is Settings'
  existing grammar, kept.

The bordered worked-in card survives for exactly three jobs: a form someone works inside, a
tone-carrying operational panel, and an overlay — flat, per decision 1; only true overlays carry
shadows. A page is otherwise a sequence of groups spaced by
one page-level rhythm — never a stack of same-weight boxes.

### 3. One ramp, one chip, tabular figures

- The type ramp is closed: page title (`text-4xl`, tracking-tight — existing), page summary
  (`text-base text-muted`), eyebrow (existing), section heading (`text-lg font-semibold` —
  existing), group label (`text-xs font-semibold tracking-[0.14em] uppercase text-muted` — the
  Settings spelling, now the only spelling), row title (`text-base`), row meta (`text-sm
  text-muted`). The ~20 one-off heading variants collapse into these.
- **`Badge` is the only pill.** `KindChip` and the ad-hoc count/crew pills retire: a row's kind is
  a word in the row's own type, a count is quiet text, and a badge marks only the exceptional
  state — which principle 9 already required.
- Every count, time and money figure sets `tabular-nums`. Numbers that lead (a head count, seats
  sold) render as **figures** — `text-2xl`–`text-4xl` semibold — not as another line of `text-sm`.

### 4. The home is the day's spine

One composition replaces the urgency/by-departure view pair: **departures as stations on a
chronological spine, each station carrying its own work**. A station is the time (large, tabular),
the title, the capacity figure, the crew line — and beneath it, its blockers and chores as ledger
rows ranked by severity, each with its one fix beside it. Work bound to no boat pools under one
"At the desk" group. Tomorrow and the rest of the week collapse to single count-carrying rows. The
day's facts are said once, at the station, instead of once per card.

In the evening the same spine **closes** — and this is a state, never a mode: there is no phase
control and no second view, the stations simply settle one by one as head counts close, and the
closing block appears beneath the spine once every departure of the shop day has ended (with the
standing one-hour late-arrival buffer) or closed its count. The closing block is the leftovers
group — each row carrying its own **Dismiss**, saved immediately with Undo, per H-57, so closing
never owns those decisions — then the one closing act. Recaps and the log ride their stations. On a
day with no departures the page collapses to its one-line quiet state (principles.md's
whole-page-empty rule) rather than rendering empty groups.

**Close-out's route folds away (H-62, decided 2026-08-27).** `/shop/[shopSlug]/close-out` becomes a
308 to the home, its `?notice=` codes re-home, the `closeOut` destination leaves the registry (the
phone dock drops to four destinations plus More), and `day_closeouts`, the close action, and the
departure-log door are unchanged underneath. This is the concept-model table's "home becomes the
shop's day" row, first half, delivered by design; the Check-in fold remains a separate, open call.

The queue's ranking rules, row kinds, and the two good-news moments (principles.md §3) are
unchanged — this reshapes where the work renders, not what counts as work.

### 5. The board is a week

At desktop the schedule board composes as a **seven-column week**: one column per day, departures
as compact time-led entries, a multi-day course as a spanning bar, the current day marked, past
days dimmed. Paging is by week. **The width floor is `xl` (1280px), decided 2026-08-27 (H-63):**
seven columns are too squeezed on a portrait tablet, so tablets and phones keep the vertical day
stream, and the board's cursor-paged "stream with no end" contract is unchanged underneath.

### 6. Settings is a rail and a pane

At desktop, settings splits into a **left rail** (the destinations, grouped under the three
existing group labels, one selected) and a **pane** (the selected destination as inset groups of
label/value rows). The 2,251-line single column retires at desktop. On the phone the current
grouped list stays — it is already the right anatomy — but **standing captions retire**: a row is
its label and its current value; explanation appears where the row opens. (The copy-restraint
question, asked of every settings caption at once.)

### 7. Orders is a day ledger

Orders group by **day**: the group header owns the date and the day's order count and subtotal;
rows are diver, trip (muted), amount (tabular, right-aligned). The five-control filter card demotes
to a toolbar — one search field, two quiet selects. Status renders only when exceptional (already
the rule). Imported payment history collapses to one disclosure row at the ledger's foot instead of
a second full table-and-pager apparatus.

### 8. The storefront leads with the shop

The public schedule becomes a **shopfront**: the shop's identity leads (name at display scale, its
own tagline, the review aggregate and conservation line), beside the **next boat** as a bookable
object — the page's one card and one primary action. The week follows as the existing
day-grouped ledger tightened to **one metadata line per row** (site · requirement · spots · price);
the six stacked lines per row retire to the trip page. Courses and reviews follow as shelves; the
date-request and find-my-booking doors close the page. The public h1 joins the display scale
(the `text-2xl`/`text-4xl` disagreement between `/s/...` and `/s/.../courses` resolves upward).

### 9. The counter is a boarding instrument

Check-in inherits the manifest's instrument language, ashore: the **count leads** (a figure, not a
sentence), the queue is names with one large tap each, checked-in rows sink into a collapsed
settled group, and a blocked row carries its one fix inline. One departure is in focus at a time,
with the day's other boats one tap away. Targets at counter scale (≥56px rows on the tablet).

### 10. One chrome spec

Both shells share one header bar: **56px**, translucent page background
(`bg-background/85` + `backdrop-blur`), bottom hairline, one z-index, its height a shared token so
no child hard-codes `top-[68px]` again. The page's `<h1>` stays in the page (no collapsing
large-title behavior — see Alternatives). The phone dock is unchanged.

### 11. The coral budget

The accent is the rarest thing the palette owns, and scarcity is what it is *for* — coral spent
on chrome is coral the earned moments no longer have. So the accent's every sanctioned appearance
is one table, here, and nowhere else:

| Where | The moment | Governed by |
| --- | --- | --- |
| Public pages, and the diver's own rating input | star fill (data ink — see rule 4) | decision 8; the thread's after-state |
| The diver's thread | booked · paperwork done (the waiver's completed state) · welcome home (the after-state greeting, coral until the review is in — exactly three) | [20260827-the-divers-thread](20260827-the-divers-thread.md), decision 6 |
| The counter | everyone expected is here (the existing cleared line) | decision 9 |
| The home, morning | today's boats are all clear (the existing line) | [principles §3](../../design/principles.md); slice 6c |
| The home, evening | all boats are home — worded once-ever as "your first boat is home" on the day no departure has ever sailed before; yields to the closed-day panel, which is the same moment recorded | decision 4 |
| The home, once ever | the shop's first booking | [20260827-first-light](20260827-first-light.md), decision 6 |
| The diver record | that was the last thing (post-action, transient) | [20260827-people-not-lists](20260827-people-not-lists.md) |
| The gear register | everything is back on the wall | [20260827-the-shops-shelves](20260827-the-shops-shelves.md), slice 9d |
| Reports | every waiver in (counted signatures > 0) | the shops-shelves SPEC, 9f |
| The manifest | everyone's back aboard · dock complete | [20260827-the-departure-is-two-working-surfaces](20260827-the-departure-is-two-working-surfaces.md) |

Five rules ride the table. A surface renders **at most one** coral element at a time. Every
moment is **earned and transient** — condition-derived, never stored, never decorative, and each
disappears when its condition passes. A new coral moment **takes a row in this table in the
same change** — a pull request that adds accent ink without amending this record is a finding
against the pull request. **A filled rating star is data ink, not a moment**: coral fill renders
only on public pages and in the diver's own rating input, counts as one appearance however many
stars a page fills, and never fires beside an earned moment; staff surfaces keep the shipped
warning-amber fill, because a moderation queue is work, not a celebration. And **the words carry
no emoji, with one exception**: the shaka (🤙) is the product's one word-mark gesture and stays
where it ships; every other celebration emoji (🎉 and kin) leaves its string in the slice that
recomposes its surface — the coral, the words, and the drawn marks are the celebration.

## Alternatives considered

**Keep polishing surfaces inside the current language.** The standing plan (the SectionCard
migration follow-up) converges every panel on one spelling of the same box. Rejected as the round
that produced the current state: consistency of the card is not composition, and twelve identical
boxes are not calmer than twelve drifted ones.

**The borderless iOS grouped-list treatment** (fill contrast instead of hairlines). Rejected on
measurement: Apple's `#F2F2F7`-on-white reads because the fills sit ~5% apart; DiveDay's sand
`#faf9f6` against `--surface` white is 1.03:1 — a borderless white group on sand simply vanishes.
The hairline stays; the shadow goes.

**A collapsing large-title chrome (the iOS scroll behavior).** Deferred, deliberately. It needs a
scroll listener under every page, and the app's best property — instant, skeleton-first
navigation — is exactly what page-level scroll chrome tends to erode. If it is ever revisited it
needs a new fact (a CSS-only mechanism), not a fresh opinion.

**A `[phase]` or `?view=` control on the home** (morning/evening as tabs). Rejected: the clock
already knows. A control asking the shop which part of the day it is would be chrome doing the
content's job. The fold (decision 4, H-62) sharpens this into the load-bearing reading: the evening
is not even a *state the page switches into* — the stations settle individually, so the page never
has two renderings of one moment, and there is nothing for a control to choose between.

**An acknowledgement gate on the closing act** (the current close-out's "close with things still
open" checkbox). Rejected — H-57 already decided that leftovers carry forward by default and are
dismissed per row, immediately, with Undo; closing the day does not own those decisions, so a gate
re-asking them at the close is a confirm on a reversible act (principle 7).

**Retiring the week board idea in favor of the stream at all widths.** Considered because the
stream is honest and already good. Rejected at desktop only: a week of departures at ~2,700px of
scroll answers "what does my week look like?" seven times slower than seven columns; gaps and
collisions (two boats, one boat, none) are the board's whole question.

## Consequences

- **Slices** (sequenced in
  [roadmap.md](../../product/features/roadmap.md#6-clearwater--the-surface-language-design-complete),
  tracked in the canvas README): (a) the language mechanics — flat-at-rest, the ledger/group
  primitives, one chip, ramp cleanup; (b) one chrome spec; (c) the home as the day's spine;
  (d) the home's evening reading; (e) the week board; (f) the orders day ledger; (g) settings rail
  and pane; (h) the counter instrument; (i) the storefront. Each ships with the standing
  obligations: the component names this ADR in a doc comment, a test pins the rule (never pixels),
  the slice table updates, screenshots in light and dark.
- **Both owner calls this record originally surfaced are now decided** — the fold (H-62, decision
  4) and the week board's width floor (H-63, decision 5) — so slice (d) removes the Close-out route
  in the same change that ships the evening reading, and slice (e) carries no per-device judgment.
  One related call stays open and is deliberately not this ADR's: folding the counter Check-in into
  the home (the concept-model table's second half), which depends on the arrived-vs-aboard data
  question. The counter's design in decision 9 stands whether or not its route later folds.
- **The canvas carries an implementation spec** (`SPEC.md` beside the artboards, per
  [design/design-artifacts.md](../../design/design-artifacts.md)): the user journeys, acceptance
  tests, and interface contracts for slices (a)–(i), written so a session with none of this
  context — or a smaller model — can implement a slice to spec. The spec's authority expires per
  slice exactly as the canvas's does; this record outranks it.
- **Supersedes the composition half** of
  [20260720-today-work-queue](20260720-today-work-queue.md) (the ranked queue's row kinds, ranking
  and empty/good-news states survive; the two-view rendering does not) and, if slice (d) leads to
  the fold, revisits [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md)'s `?view=`
  contract — that revisit is part of the owner call, not assumed here.
- **No new tokens.** Clearwater uses the palette as it stands; hairlines are `--border`, tints are
  the existing opaque `--*-tint` tokens, and the tinted-ink, timezone, locale and copy gates in
  `pnpm check:repo` apply to every slice unchanged. A canvas colour outside the palette is a
  finding against the canvas.
- **Accessibility commitments carry over verbatim**: every colour-carried state also carries a
  word; targets ≥44px (≥56px for the counter's queue rows — standalone controls there meet the
  app-wide 44px floor); AA on every ink/tint pair; drawn SVG marks, never
  emoji, on anything new. The flat-at-rest rule touches no contrast ratio (borders stay).
- **Copy shrinks.** Settings' standing captions, the queue rows' repeated explanations, and the
  storefront rows' stacked metadata all pass through the copy-restraint filter as their surfaces
  land; deletions land in every locale's bundle in the same change.
- The visual-regression baseline moves on every slice — expected, explained per PR, and the reason
  the slices are cut small.
