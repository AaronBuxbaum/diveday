# 20260827-clearwater-surface-language — Type leads, chrome recedes: the Clearwater surface language

- **Status:** Proposed
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-clearwater-surface-language/README.md) —
  ten artboards on three pages: **The language** (the system board), **The staff app** (the home in
  its morning and evening readings, the week board, orders, settings, the counter), and **The
  shopfront** (the public schedule at desktop and phone). Those pictures are illustrative and this
  record is normative — the split is [design/design-artifacts.md](../../design/design-artifacts.md).
  The trip and manifest surfaces are deliberately out of scope: they were designed the same day in
  [20260827-the-departure-is-two-working-surfaces](20260827-the-departure-is-two-working-surfaces.md),
  and this language generalises that canvas's grammar rather than competing with it.

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

The raised worked-in card survives for exactly three jobs: a form someone works inside, a
tone-carrying operational panel, and an overlay. A page is otherwise a sequence of groups spaced by
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

In the evening the same spine **closes**: stations show their head-count result, recap and log
state; still-open work becomes the leftovers group; the one act is closing the day. This is
Close-out's content as the home's evening reading — the roadmap's "home becomes the shop's day"
row, drawn. Whether Close-out's route folds away is an **owner call** recorded there and in the
Consequences; nothing in this ADR forecloses it.

The queue's ranking rules, row kinds, and the two good-news moments (principles.md §3) are
unchanged — this reshapes where the work renders, not what counts as work.

### 5. The board is a week

At desktop the schedule board composes as a **seven-column week**: one column per day, departures
as compact time-led entries, a multi-day course as a spanning bar, the current day marked, past
days dimmed. Paging is by week. The existing vertical stream remains the phone composition (a
seven-column grid has no honest 390px form), and the board's cursor-paged "stream with no end"
contract is unchanged underneath.

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
content's job.

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
- **Two owner calls are surfaced, not settled**: whether Close-out's route folds into the home once
  the evening reading ships (the concept-model table's first row — slice (d) builds the reading
  without removing the route), and whether the week board should eventually replace the stream on
  tablet as well as desktop. Both want a `dive-domain-expert` pass on dock-day ergonomics.
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
  word; targets ≥44px (≥56px at the counter); AA on every ink/tint pair; drawn SVG marks, never
  emoji, on anything new. The flat-at-rest rule touches no contrast ratio (borders stay).
- **Copy shrinks.** Settings' standing captions, the queue rows' repeated explanations, and the
  storefront rows' stacked metadata all pass through the copy-restraint filter as their surfaces
  land; deletions land in every locale's bundle in the same change.
- The visual-regression baseline moves on every slice — expected, explained per PR, and the reason
  the slices are cut small.
