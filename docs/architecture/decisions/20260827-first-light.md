# 20260827-first-light — Every door is one shell, and the first morning is a designed state

- **Status:** Accepted
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-first-light/README.md) — the door
  grammar at desktop and phone, the terminal states, and the shop's first morning. `SPEC.md`
  beside them carries journeys, acceptance tests and interface contracts per
  [design/design-artifacts.md](../../design/design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way).
  Speaks the Clearwater language
  ([20260827-clearwater-surface-language](20260827-clearwater-surface-language.md)); this record is
  normative.

## Context

The Clearwater program redesigned every working surface and left the **doors** unmapped: a
route census on 2026-08-27 found `/sign-in`, `/onboard`, `/forgot-password`,
`/reset-password/[token]`, `/verify/[token]`, `/invite/[token]`, `/claim/[token]` and
`/unsubscribe/[token]` in no canvas, no SPEC, and with zero entries in `surfaces.md` — the pages a
person meets *before* any of the surfaces the program improved.

What exists is better than "undesigned." Eight of those pages already share one spine —
`EntryShell` / `EntryDone` / `EntryShellSkeleton` in `src/components/account/EntryShell.tsx` — and
the dead-link treatment already splits into two deliberate tiers (`ExpiredLinkCard` names the shop
for booking tokens; bare `EntryDone` withholds it for account tokens). The gaps are precise:

- **Onboard speaks a pre-Clearwater grammar**: its two sections ("Your shop" / "You") are h2s over
  `border-b` rules, not group labels, and its reassurance footnote concatenates four sentences
  where one earns its place.
- **The terminal glyph is an emoji.** `EntryDone` puts 📬, ⏳, 🎉 or 🔕 in its circle — a mark
  rendered differently on every platform, standing where a drawn stroke should. (It is not the
  only emoji in the app — several celebration strings carry one — but it is the only place an
  emoji is the *structure* of a component rather than a word in a sentence; the word-borne ones
  are governed by the Clearwater coral budget's emoji rule.)
- **`/claim/[token]` is the odd one out**: a hand-rolled `max-w-xl` page with `TokenPageHeader`,
  duplicating the grammar the diver's thread now owns — even though its success already redirects
  into `/ready/[token]`, which *is* the thread.
- **Day zero has machinery but no composition.** The home already carries `FirstRunChecklist` —
  six steps over five persisted facts, gated on `countShopTrips === 0`, with its own test hooks
  and a pinned `FIRST_RUN_STEP_COUNT` — but it is a primary-tinted card of nested step boxes,
  exactly the boxes-in-boxes anatomy Clearwater retires, and no design says how it composes with
  the quiet-day collapse the Clearwater canvas drew. The first thing every new owner sees is the
  one surface the program never looked at.

## Decision

**Every door into DiveDay is one shell spoken in Clearwater, its terminal states are one drawn
grammar in two tiers, and the shop's first morning is a state of the home — never a wizard.**
Six decisions.

### 1. The door grammar is EntryShell, spoken in Clearwater

No new shell. `EntryShell`, `EntryDone` and `EntryShellSkeleton` stay the chokepoints for every
account-side page; the recomposition is convergence, not replacement. The type ramp, field
spacing and label weights adopt Clearwater's scale; a door carries **one primary and nothing
else button-shaped**; footer links are quiet text. Onboard's two h2-ruled sections become two
**group labels** ("Your shop" / "You") — the same grammar every grouped surface in the program
now uses — and its four-sentence reassurance footnote becomes one sentence, because a person
about to type a card-free signup form needs exactly one fact: no card, free while you set up.
The slug field's hint becomes the storefront URL it will produce, live as they type.

### 2. The terminal glyph is drawn, never typed

`EntryDone`'s emoji becomes a stroked SVG mark in the same `size-14` circle — a closed set,
`DoorGlyphId = "sent" | "expired" | "done" | "quiet"` (mail for a sent reset, a clock for a dead
link, a check for a confirmed act, a resting bell for unsubscribed). One component owns the
strokes; no caller passes markup or emoji. The marks are `currentColor` strokes so they follow
tone and theme for free.

### 3. The dead-link law has two tiers, and now it is written

Already true in code, now normative: a dead **account token** (verify, reset, invite) renders
bare `EntryDone` and **never names a shop** — the token belongs to a person, and a forwarded
invite link must not disclose who invited whom. A dead **booking-capability token** (waiver,
ready, recap, claim) always offers the shop's hand — `ExpiredLinkCard` with the shop's name and
contact — because the diver holding it wants exactly one thing: who to ask for a fresh link.
Every dead-link screen is one `unavailableTitle`/`unavailableText` pair in its page's own
bundle subtree; no third shape may appear.

### 4. Claim joins the thread

`/claim/[token]` adopts `ThreadShell`
([20260827-the-divers-thread](20260827-the-divers-thread.md)): it is the thread's first page for
a party member, and its success already lands on `/ready`. The hand-rolled header and panel go;
its five `?error=` refusals keep the thread's one notice grammar. The diver's-thread SPEC gains
the adopter in the same change.

### 5. The doors carry DiveDay's name; everything after carries the shop's

Existing practice, blessed: account doors (sign-in, onboard, forgot/reset, verify, invite) wear
the DiveDay wordmark and no shop identity; bearer-token pages wear the shop as their eyebrow and
never say DiveDay. The moment a person crosses a door, the product recedes and the shop is the
brand — the same recession the Clearwater chrome bar performs inside the app.

### 6. The first morning is a state of the home, never a wizard

The same grammar H-62 gave the evening: day zero is a **state** of `/shop/[shopSlug]`, not a
mode, not a wizard, not a separate surface. `FirstRunChecklist` keeps everything that already
works — its five persisted facts, its `countShopTrips === 0` condition, its demo exclusion, its
step targets and test hooks — and sheds its skin: the primary-tinted card of nested step boxes
becomes one **First morning** ledger group at the top of the day spine, done steps as settled
lines, exactly one open step carrying the page's one primary. Every fact is presence-derived
(**zero new columns**); a completed step is a settled line, and the whole group leaves at the
first departure. Its one unfinished thread — payments — does not vanish into surfaces a new
owner never visits: while trips exist, Stripe is unconnected, and no order has ever been taken,
the day spine's desk group carries one quiet presence-derived row ("Payments aren't connected —
divers can book, and pay at the counter" → settings), gone forever at connection, which also
keeps the quiet day's "nothing is waiting on you" honest; the settings rail's badge and the
orders empty state stay the standing carriers after that. While the group renders, the
quiet-day collapse never does; the two compositions are exclusive by rule. And when the first
real booking arrives, it takes the coral mark — the staff side's once-in-a-shop's-life entry in
the coral budget ([20260827-clearwater-surface-language](20260827-clearwater-surface-language.md),
decision 11) — gone forever at the second.

## Alternatives considered

- **An onboarding wizard or setup-checklist surface.** Rejected on the standing fewer-surfaces
  direction and on H-62's grammar: a wizard is a mode, it rots the moment the product changes,
  and it teaches a new owner a surface they will never see again. The home teaching its own
  first state costs zero navigation and disappears by itself.
- **Storing first-run progress.** A `setup_steps` table (or a dismissed flag) was rejected:
  every fact the first morning needs is already persisted and re-derived (`FirstRunChecklist`'s
  five reads), presence-derivation is the gear register's proven pattern, and stored progress
  lies the moment data changes underneath it.
- **Replacing `FirstRunChecklist` with a smaller invention.** An earlier draft of this record
  designed a three-row group from scratch; rejected on contact with the code — the shipped
  checklist already owns the right facts, condition and tests, and the design's job is to give
  it the ledger grammar, not a rival.
- **A new door shell.** Rejected — `EntryShell`/`EntryDone` already are the one door across
  eight pages; replacing a working chokepoint to change its clothes would be churn (the same
  reasoning that kept `SectionCard` radius-prop-free).
- **Leaving the doors out of the program.** Rejected: they are the first pixels every owner,
  staffer and party diver sees, and a redesign that starts one page *after* the first impression
  reads as unfinished from the outside.
- **Claim as a first-light surface.** It is drawn here for the census, but its grammar belongs to
  the diver's thread (decision 4) — a claim is the thread's first page, not a door into DiveDay.

## Consequences

- `EntryDone`'s `glyph` prop changes type (emoji string → `DoorGlyphId`); all eight callers move
  in the same change. `ExpiredLinkCard` keeps its contract.
- `/claim/[token]` recomposes onto `ThreadShell`; the diver's-thread SPEC lists it as an adopter.
- Onboard recomposes (group labels, one-line footnote, live slug hint); no field changes, no new
  `?error=` codes.
- `FirstRunChecklist` recomposes onto the ledger primitives (its facts, condition, targets and
  test hooks unchanged); `assembleDaySpine` renders it as the spine's leading group, and the
  Clearwater SPEC's 6c/6d sections carry the precedence rules against the quiet-day collapse.
- The first-booking coral mark derives from one read (live bookings count exactly 1, trip
  upcoming within the standing buffer); a walk-in counts, imported prior visits never do.
- Slices live in `roadmap.md` section 10; artboards, journeys, tests and interface contracts in
  the canvas and its `SPEC.md`.
- Marketing pages are deliberately untouched — they keep their own voice (the **marketing-page**
  and **brand-voice** skills own them). `/offline-manifest` keeps staff chrome; it converges only
  by inheriting the components it already uses.
- No schema change anywhere in this record.
