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

- **One idea:** the work. What needs this shop today, ranked, with the day's boats above it
  (ADR 20260720-today-work-queue).
- **The question it arrives with:** "what needs me before the first boat?" — answered on screen, in
  the queue's first band, without a click.
- **Controls that dissolved:** the queue's rows *are* their own controls — each row's own link goes
  to the thing it is about. The view switch is the one standing control.
- **Remove first:** nothing currently; the orientation card is already conditional on first-run and
  the good-news lines already render nothing when untrue (see
  [settled-questions.md](settled-questions.md)).
- **Composition:** not the default card stack — a departure board above a ranked queue, because the
  day's boats and the day's work are two different readings and the first is the shorter list.

Enforced beside the code: `RoleOrientationCard.tsx` defers to it by name, and
`RoleOrientationCard.test.tsx` fails if the orientation box out-ranks the queue.

**Recomposition proposed** — ADR
[20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
(Proposed) redraws the same one idea as a chronological spine: stations carry their own work rows,
so a departure's facts are said once instead of once per card, and the two views become one
composition. The shipped code governs until that slice ships.

### The trip page — `/shop/[shopSlug]/trips/[id]`

**Designed, not yet built** — ADR
[20260827-the-departure-is-two-working-surfaces](../architecture/decisions/20260827-the-departure-is-two-working-surfaces.md)
(Proposed), drawn in
[its canvas](canvases/20260827-the-departure-is-two-working-surfaces/README.md).

- **One idea:** everyone who is coming, and whether they can. The roster *is* the page; what the
  dive is drops to a one-line summary that opens on request.
- **The question it arrives with:** "who still needs something before this boat sails?" — answered by
  the first group in the ledger, which is the only group carrying open work.
- **Controls that dissolved:** the filter chips (the groups do the filtering), the per-row Details
  caret (a row at rest is a name and a mark; open work is simply open), and the Overview tab itself
  (a disclosure on this page).
- **Remove first:** the Activity and Promote footer rows — kept only because a trip's history has no
  other home yet.
- **Composition:** one grouped ledger under a masthead, not a card stack — a roster is a list of
  people in states, and the state belongs to the group rather than repeated down every row.

### The boat manifest — `/shop/[shopSlug]/trips/[id]/manifest`

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

**Redesign proposed (desktop only)** — ADR
[20260827-clearwater-surface-language](../architecture/decisions/20260827-clearwater-surface-language.md)
(Proposed), drawn in [its canvas](canvases/20260827-clearwater-surface-language/README.md). The
stream stays on phone.

- **One idea:** the shape of the week — where the boats are, and where they aren't.
- **The question it arrives with:** "what does my week look like?" — answered in one screen of
  seven columns rather than seven screens of scroll.
- **Controls that dissolved:** none new; the row's `⋯` menu and per-day "+ Add" carry over.
- **Remove first:** the standing crew line above the board, once a station says its own crew.
- **Composition:** a week grid at desktop because the content is a calendar; the phone keeps the
  stream because a seven-column grid has no honest 390px form.

### Settings — `/shop/[shopSlug]/settings`

**Shipped 2026-08-28** (slice 6g) — same ADR and canvas. The phone keeps grouped lists.

- **One idea:** every switch in the shop, findable in one look.
- **The question it arrives with:** "where do I change X?" — answered by the rail, which shows the
  whole map at once instead of 42 rows of scroll.
- **Controls that dissolved:** the standing caption under every door row — the row's current value
  is the description.
- **Remove first:** nothing beyond the captions; the three groups already carve the space
  correctly.
- **Composition:** rail and pane, because settings are a directory and a directory reads as a tree,
  not a queue.

### Orders — `/shop/[shopSlug]/orders`

**Redesign proposed** — same ADR and canvas.

- **One idea:** the money ledger, day by day.
- **The question it arrives with:** "what came in, and is anything still open?" — answered by day
  subtotals and the rare `Open` badge, without reading fifty identical rows.
- **Controls that dissolved:** the five-control filter card demotes to a toolbar; the date column
  dissolves into the day group header.
- **Remove first:** the second imported-history table — it becomes one disclosure row.
- **Composition:** a grouped ledger because orders share their date, and a shared fact belongs to
  the group (principle 9 applied to a table).

### The counter — `/shop/[shopSlug]/check-in`

**Built** — same ADR and canvas, slice 6h, delivered 2026-08-28. Safety-adjacent; gets the
`dive-domain-expert` pass.

- **One idea:** who has walked in, against who should.
- **The question it arrives with:** "how many are still to come?" — answered by the count figure
  before any list.
- **Controls that dissolved:** per-row state text — the tap circle *is* the state; settled rows
  sink into one collapsed group.
- **Remove first:** the day's other boats from standing view; one departure is in focus, the rest
  one tap away.
- **Composition:** an instrument over a queue, inheriting the manifest's count-first grammar
  ashore.

### The public schedule — `/s/[shopSlug]`

**Shipped 2026-08-28** (slice 6i) — same ADR and canvas. Conversion surface; gets the
`conversion-reviewer` pass. `/s/[shopSlug]/reviews` restyled with it, and the two public course
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

**Redesign proposed** — ADR
[20260827-the-divers-thread](../architecture/decisions/20260827-the-divers-thread.md) (Proposed),
drawn in [its canvas](canvases/20260827-the-divers-thread/README.md). Conversion surface.

- **One idea:** this boat is worth your Saturday — and here is the one place to say yes.
- **The question it arrives with:** "what will I see, and can I get on?" — answered by the pitch
  and the scarcity word before any scrolling.
- **Controls that dissolved:** the boxed requirement note (one sentence), the boxed gear fieldsets
  (hairline steps of one sheet), the five-piece money story (one block), the sticky pill's
  duplicate seat count (verb only).
- **Remove first:** the packing section — it is preparation, not pitch, and moves to the thread.
- **Composition:** sell then close — the form is the page's terminal word, so the primary is where
  a decided diver already is.

### The thread — `/ready/[token]` (and every state after booking)

**Redesign proposed** — same ADR and canvas. Extends ADR 20260820-one-page-after-booking.

- **One idea:** the one link that answers "am I ready, and what's next?" for this trip — before,
  during, and after.
- **The question it arrives with:** "what do I still have to do?" — answered by one figure and the
  named next step, first.
- **Controls that dissolved:** the receipt panel, the emails line and the per-row Done chips (the
  steps' settled lines say it once); the four inline forms at rest (one open step at a time).
- **Remove first:** nothing after the fold — the after-state already absorbed the recap page.
- **Composition:** a step spine, because getting ready is a sequence, and the same spine grammar
  the staff home speaks makes the product one product.

### The waiver — `/waivers/[token]`

**Redesign proposed** — same ADR and canvas. Legal surface: wording and presentation floor are
H-01/H-03's.

- **One idea:** two minutes of paperwork, paced so it feels like two minutes.
- **The question it arrives with:** "how much is left?" — answered by the step rail's count.
- **Controls that dissolved:** the second submit's button chrome (save-later is a link beside the
  expiry line); three bespoke banners (one notice grammar).
- **Remove first:** nothing — the release must stay fully presented.
- **Composition:** three steps under a quiet rail; the sign card is the page's one worked-in card.

### The gear register — `/shop/[shopSlug]/gear`

**Redesign proposed** — ADR
[20260827-the-shops-shelves](../architecture/decisions/20260827-the-shops-shelves.md) (Proposed),
drawn in [its canvas](canvases/20260827-the-shops-shelves/README.md).

- **One idea:** where every unit is, said once.
- **The question it arrives with:** "what's out, and what's coming back?" — answered by the Out
  and Due back groups before any scrolling.
- **Controls that dissolved:** the three stat tiles and the Returns panel (the groups are the
  state); per-row acts ride the rows.
- **Remove first:** the service sentence on healthy units — it already renders only when it has
  something to say.
- **Composition:** one grouped ledger because reservation state is the register's whole subject,
  and three renderings of it were two too many.

### Staffing — `/shop/[shopSlug]/staffing`

**Redesign proposed** — same ADR and canvas.

- **One idea:** the week's crew, and the one hole in it.
- **The question it arrives with:** "is every boat covered?" — answered by the Needs-crew row's
  day cells, which render nothing when the answer is yes.
- **Controls that dissolved:** the two standing add-forms (doors now); the inline credential
  badge stack (one renewal word).
- **Remove first:** nothing — the week grid is already the minimum that shows coverage.
- **Composition:** people × days, because coverage is a grid question; the gap carries its act in
  the day it lives (H-59 keeps credentials inform-only).

### Reports — `/shop/[shopSlug]/reports`

**Redesign proposed** — same ADR and canvas.

- **One idea:** how the month is going, in five figures and the boats behind them.
- **The question it arrives with:** "how are we doing, and what needs chasing?" — the figures
  answer the first; the amber waiver remainders answer the second.
- **Controls that dissolved:** six bordered tiles (figures over hairlines); the CSV link joins
  one quiet line with tax.
- **Remove first:** the second imported-history apparatus, already folded by the orders ledger's
  precedent.
- **Composition:** figures then a ledger — the shape it always had, with the chrome removed.

### The diver record — `/shop/[shopSlug]/divers/[personId]`

**Answered 2026-08-27, redesign proposed** — ADR
[20260827-people-not-lists](../architecture/decisions/20260827-people-not-lists.md) (Proposed),
drawn in [its canvas](canvases/20260827-people-not-lists/README.md). This entry replaces the
"unanswered, and known to be" record that stood here since issue #780; the shipped code governs
until slice 8b ships.

- **One idea:** this diver, ready or not — and the one fix if not.
- **The question it arrives with:** "can they dive with us, and is anything in the way?" — answered
  by the status ledger under the masthead, which renders *nothing* when they are clear.
- **Controls that dissolved:** the jump nav (the page got short), the ten per-section notice slots
  (one router convention), the stat tiles (each figure lives in its group), three of the four
  primary-weight buttons (Book is the one primary).
- **Remove first:** the merge panel's standing card — it earns its place only while candidates
  exist, and the redesign keeps it conditional.
- **Composition:** status, story, file — a person is a readiness question, a history, and a set of
  facts, in that order; ten co-equal sections answered no question first.

### The doors — `/sign-in`, `/onboard`, and the token family

**Redesign proposed** — ADR
[20260827-first-light](../architecture/decisions/20260827-first-light.md) (Proposed), drawn in
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
