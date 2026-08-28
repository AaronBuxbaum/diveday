# 20260827-the-divers-thread — One link from booking to afterglow: the diver's thread

- **Status:** Proposed
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-the-divers-thread/README.md) — six
  artboards: the thread map, the booking page at phone and desktop, the thread page in its prep and
  after states, and the waiver's paced flow. The canvas carries a `SPEC.md` (journeys, acceptance
  tests, interface contracts) per
  [design/design-artifacts.md](../../design/design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way).
  This record extends [20260827-clearwater-surface-language](20260827-clearwater-surface-language.md)
  (the language) and [20260820-one-page-after-booking](20260820-one-page-after-booking.md) (the one
  page) to the diver's whole journey. It is normative; the pictures argue.

## Context

A diver's relationship with a shop is one thread — choose a boat, book it, get ready, dive, glow —
but the surfaces that carry it were built in separate sessions and read like it (measured
2026-08-27, full-page captures plus code inventory):

- **The measure changes at every step.** Schedule `max-w-6xl` → trip page `max-w-2xl` → ready /
  waiver / recap `max-w-xl` → account pages `max-w-md`. A diver moving down their own thread
  watches the column width change three times.
- **The booking card is boxes inside boxes, and the money story is in five pieces.** The
  requirement note is a sunken box inside the raised form card; each gear picker is a bordered
  fieldset inside the same card; the price appears as a hero figure, a card caption, a party total,
  a fee line and a tax line — five `text-sm` siblings the diver must assemble.
- **The primary is mid-page.** After the form, ~1,000px of forecast, packing and briefings follow,
  so the page's one act sits in the middle of its scroll, with a sticky pill duplicating the
  card's own seat count. Packing is *preparation*, not pitch — it belongs after booking, not
  beside the Book button.
- **`/ready` is a form dump wearing a checklist's clothes.** 1,828 lines; nine rows of which five
  are inline forms; a progress bar whose own copy admits it "can never fill"; the trip's status
  stated three or four times in one screenful (earned moment, emails line, receipt panel, header
  count, payment row).
- **The waiver is a wall.** The full release, then eleven medical questions, before the diver
  reaches anything they can finish; four different banner treatments for four adjacent messages;
  two submits sharing one row with inverted weight on a phone.
- **The recap says its facts twice and asks five things.** Conditions and sites each render twice
  (stat row + keepsake card); review, Google share, tip, photos and "bring a buddy" compete below
  the fold, three of them at CTA weight.
- The roadmap's concept-model work already decided the thread's spine — booking and Stripe both
  land on `/ready` (ADR 20260820) — and left one half explicitly open: *"folding recap into the
  same link as a post-trip state."* Aaron's 2026-08-27 direction (H-62's preamble) is to reduce
  the number of surfaces and make every remaining one's next action obvious.

## Decision

**The diver has one thread, at one measure, in the Clearwater grammar — and after the dive it is
still the same link.** Six decisions.

### 1. One measure for the thread

Every page a *booked* diver walks — the trip page, `/ready`, the waiver, the after-state — reads at
**`max-w-xl`**. Browsing surfaces (the schedule, the course catalog) keep their own widths; the
account pages keep `max-w-md`. The thread pages share one shell: shop-name eyebrow, page title,
one state slot — the existing `TokenPageHeader` / `EntryDone` / `ExpiredLinkCard` family converges
on it, flat and hairlined per Clearwater.

### 2. The trip page sells, then closes

Composition order: the hero (what, when, where, the price said **once** at figure scale), the
pitch (sites and what you'll see, conditions, crew languages — the content that answers "is this
my day?"), who it's for (the requirement, one line, no box), then **the form, terminal** — nothing
below it but the fine print it already owns. Inside the form card there are no nested boxes: party,
contact and gear are hairline-separated steps of one sheet, and the money resolves in **one total
block** directly above the pay button — fare × party, gear, fee, tax, deposit split, one "due
now" figure. **Packing moves to the thread's prep step**; the briefing digest stays here, because
what you'll see is pitch and what to bring is prep. The sticky phone pill keeps only the verb.

### 3. The thread page is a step spine

`/ready` recomposes on the same spine grammar as the staff home: steps in order — **Sign · Prove
your certification · Pay · Gear and sizes · Day-of details** — where a settled step collapses to a
check line, the current step is open with its form inline, and future steps wait quietly. One
status statement leads (a "N of M" figure and the next step's name); the earned moment fires only
at `?booked=1` and at all-set; the receipt, the emails line and the per-row "Done" states collapse
into their steps. Party seats, self-cancel and the shop card keep their places at the foot.
Recency, the note, hotel pickup and the support-needs question
(ADR 20260827-support-needs-are-a-record-about-the-dive) fold into Day-of details; support needs
stays optional and never gates the step's settling.

### 4. After the dive, the same link (the after-state)

The thread page has a third state: **after**. Once the departure ends (the standing one-hour
buffer), the same `/ready` link renders the afterglow — the keepsake log card (the *only* place
the day's facts render: sites, conditions, crew, the diver's dive count), the review ask as the
page's one primary, then tip, photos and the Google share as quiet ledger doors. `/recap/[token]`
stops being a page of its own: existing recap links keep working by rendering the thread's
after-state (same data, one surface), and recap emails keep their `/recap` URLs, which render the
thread's after-state. This closes the
concept-model row's open half ("folding recap into the same link"); the row's *other* open half —
whether the second booking-time email survives — stays an owner call and is not settled here.

### 5. The waiver paces itself

The three steps stand under a quiet step rail (Release · Medical · Sign) that says where you are;
the release keeps its full text (typed-consent needs it present, not summarized); the four banner
treatments converge on the one notice grammar; "Save and finish later" demotes to a text link with
the expiry line beside it, leaving **Sign** as the page's one primary. Refusals keep their current
routing (field-side where the field is, banner where it is not).

### 6. Delight stays earned

The thread keeps exactly three coral moments — booked, paperwork done, and the after-state's
greeting — and loses the rest. A bar that cannot fill is not rendered: the spine's figure counts
only steps a diver can finish.

## Alternatives considered

**Keep `/recap` as its own page and merely restyle it.** Rejected under the standing direction:
it is the same booking, the same reader, the same link discipline (a capability the diver already
holds), and its content is the thread's natural third act. Two pages meant the day's facts and the
shop's asks were split across two URLs with two styles of the same card.

**Fold the trip page into the thread too.** Rejected: the trip page is public and indexed — it
sells to divers who hold no capability — and its embed mode is a contract. The thread begins at
booking; the pitch page stays a pitch page.

**Collapse the release text behind a disclosure.** Rejected for the signing step: presenting the
full text is part of what typed consent means here (H-01/H-03 pending), and a summary a diver can
sign without scrolling past the terms is a legal posture change, not a design choice.

**A per-step wizard for booking** (one field-set per screen). Rejected: the party form is short,
the phone is the primary device, and a wizard turns one honest scroll into four taps with state to
lose. The step grammar lives inside one sheet instead.

## Consequences

- **Slices** (roadmap section 7; tracked in the canvas README): (a) the thread shell and measure;
  (b) the trip page recomposition, packing's move, the one money block; (c) the thread page's step
  spine; (d) the after-state and the `/recap` fold; (e) the waiver's pacing. Each carries the
  standing obligations (ADR named in a doc comment, a rule test, slice table, screenshots), and
  the canvas's `SPEC.md` carries the journeys, acceptance tests and interface contracts per slice.
- **Slice (d) is the one route change**: `/recap/[token]` renders the after-state (no 404s, no
  dead emails); the recap-specific components and the second copy of the day's facts delete
  (H-49). `MAX_RECAP_PHOTOS_PER_BOOKING`, tips, review moderation and the suppression floor are
  untouched — this moves where they render, not what they do.
- **Safety and legal surfaces are not relaxed**: waiver/medical wording stays English pending
  H-01/H-03; the medical questionnaire's outcomes and the integrity trail are untouched; the
  release text remains fully presented.
- The dead `TripTerms cancellationOnly` prop (the cancellation window never actually moved to
  `/ready` — found 2026-08-27) is resolved by slice (c): the window renders in the Pay step's fine
  print, where the ADR 20260820 intended it.
- Conversion surfaces get the `conversion-reviewer` pass (trip page, after-state's review ask);
  the booking flow's e2e suite (booking, trip-admission, promo, keyboard, embed) is the regression
  net every slice must keep green.
- `surfaces.md` gains entries for the trip page (public), the thread, and the waiver; the recap's
  entry is the thread's after-state paragraph.
