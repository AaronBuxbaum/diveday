# 20260827-people-not-lists — The diver record has one idea, and the people surfaces become worklists

- **Status:** Proposed
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-people-not-lists/README.md) — six
  artboards: the diver record at desktop and phone, the roster, reviews as a worklist, the waiver
  surface, and requests. `SPEC.md` beside them carries journeys, acceptance tests and interface
  contracts per
  [design/design-artifacts.md](../../design/design-artifacts.md#the-spec-is-the-implementation-half-and-it-expires-the-same-way).
  Speaks the Clearwater language
  ([20260827-clearwater-surface-language](20260827-clearwater-surface-language.md)); this record is
  normative.

## Context

The staff surfaces about *people* — the diver record, the roster, reviews, waivers, requests —
share one disease in different strengths (measured 2026-08-27):

- **The diver record's one idea is officially unanswered.** `surfaces.md` records it as
  "everything about this person — a container, not an idea" (issue #780). The page is ten sections
  under a jump nav, ~6,400 lines across 21 files, with a **514-line component whose only job is
  deciding which of ten forms a notice sentence belongs to** — the strongest possible signal that
  one page is several. Level and specialty certifications are two near-identical 300-line
  components; payments, upcoming and history are three divided lists of near-identical rows; three
  to four primary-weight controls coexist; and the page *leads* with money while its heaviest
  control is Book-an-activity.
- **The roster and the record disagree about width** (6xl table vs 4xl record) and the roster
  renders the same list twice (phone cards + desktop table).
- **Reviews reads as a feed, works as a queue.** Four stat tiles restate two facts a banner then
  restates in words; the rows a staffer must act on are mixed among the ones they don't.
- **The waiver template's two-path publish is two equally-weighted near-destructive buttons with
  no default** (a material republish invalidates every standing signature); the signatures log
  writes integrity state as bare coloured text beside a badge — two grammars in one row.
- **Requests is closest to right** (day groups, advice, one act per group) and merely speaks the
  old chrome.

## Decision

**A person page answers one question — "can this diver dive with us, and what's the story so
far?" — and every people list is a worklist whose actionable rows lead.** Six decisions.

### 1. The diver record leads with readiness

The record's one idea (closing issue #780): **this diver, ready or not — and the one fix if not.**
Composition: a masthead (name, contact chips, quiet identity facts), then **the status ledger** —
zero or more open items in the same row grammar as the home's stations (kind word · sentence · the
one fix), rendering *nothing* when the diver is clear — then the rest of the record in exactly
three parts:

- **The story** — one chronological ledger of bookings (upcoming first, then past, imported visits
  interleaved and marked), each row carrying its own money state; the separate Payments, Upcoming
  and History sections fold into it. Orders remain first-class on the Orders ledger; here they are
  the row's money facts.
- **The file** — inset groups (the settings grammar): Certifications (all three kinds as one group
  of card rows, one add flow), Waiver (state + the four send routes as one row's actions), Gear &
  sizes (edit in place), Identity & emergency contact (the masthead's edit disclosure).
- **The acts** — Book them on a departure is the page's **one primary**, in the header. Notes stay
  a quiet group; export, merge, restore, remove and erase sit at the foot, quiet; erase keeps its
  owner-only, removed-first, typed-name guard (ADR 20260802).

The jump nav retires (the page is short enough to scroll); the notice router retires (notices
route to their group by the standard `noticeForForm` mechanism); the "Connect payments" CTA leaves
the person page (it belongs to Orders/Settings).

### 2. The roster is one ledger

`/shop/[shopSlug]/divers` renders one composition at every width: search + the open ledger,
**grouped by initial letter** (the shared fact the rows already sort by), rows = name (the row is
the door) + only exceptional badges (a blocker, a removed state) + quiet last-visit fact. The
duplicate phone-card rendering deletes. Quick-add keeps its slot beside search; "Add diver" stays
the page primary in the header.

### 3. Reviews is a worklist first

"Waiting on you — N" is the first group, rows carrying publish/hide inline; "Published" and
"Hidden" follow as quiet groups. The four stat tiles collapse to one aggregate line under the
title (the public page shows the stars; this page does the work). The withheld state stays a tone
panel (the card's surviving job). The suppression floor's arithmetic is untouched.

### 4. The waiver publish is one decision, then one act

The template card keeps its textarea; when standing signatures exist, materiality becomes an
explicit **choice** (two radio rows, the material one stating the at-risk count, per H-54's
"two explicit choices"), and **Publish** is the single button beneath — a default-less pair of
destructive-adjacent buttons becomes a form that cannot be submitted without choosing. The
signatures log becomes a day-grouped ledger; integrity renders as a `Badge` word, and the flagged
medical prompt keeps its disclosure.

### 5. Requests keeps its shape, in the language

Day groups with the count and the advice line in the group header, request rows as ledger rows
(soft matches quiet, not tinted), "Add a departure" one secondary per group. No new mechanics.

### 6. People surfaces share the record's vocabulary

The same certification card row, waiver-state row and money fact render on the record, the
counter, and the trip roster — one component each, so "verify a card" looks identical wherever a
staffer meets it. (The trip surfaces themselves stay ADR
20260827-the-departure-is-two-working-surfaces territory; this decision only sources the shared
row components both speak.)

## Alternatives considered

**Split the diver record into sub-pages** (profile / money / history tabs). Rejected: the record
is a depth-2 reference page reached mostly by a deep link with one job; tabs would trade one long
scroll for navigation state and three more destinations — the opposite of the standing direction.
The fix is fewer, merged sections, not more pages.

**Interleave orders, notes and activity into one grand timeline.** Rejected: a booking is the
unit a staffer reasons in; money is a fact *of* a booking here; notes and the audit trail are
reference, not story. A single mixed feed reads busy and answers no question faster.

**Keep the stat tiles on Reviews.** Rejected under principle 9 — "Waiting on you: 3" as a tile
beside a queue whose first group is titled "Waiting on you — 3" is the same fact at two volumes.

**A confirm dialog on material waiver publish.** Rejected: H-54 wants an explicit recorded choice,
not a speed bump; the radio *is* the record's input, and InlineConfirm survives only as the
existing double-tap on the single Publish.

## Consequences

- **Slices** (roadmap section 8): (a) the shared person-row vocabulary (certification card row,
  waiver-state row, booking-story row); (b) the diver record recomposition; (c) the roster ledger;
  (d) reviews as a worklist; (e) the waiver surface; (f) requests restyle. The record slice (b) is
  the largest single-page change in the stack and deletes the notice router, the jump nav, and the
  twin certification components (H-49 — no legacy).
- The record's one-idea answer lands in `surfaces.md` (replacing the "unanswered" entry) and gets
  the doc-comment + rule-test treatment the shop home has: **a test fails if the status ledger
  renders anything when the diver is clear, or if a second primary joins Book.**
- Merge candidates, restore, export and the erasure path keep their exact gates
  (`security-reviewer` review required — personal data surfaces).
- The reviews floor (`MAX_SUPPRESSED_SHARE_FOR_RATING`) and H-54's materiality semantics are
  behavior contracts; only their rendering moves.
- Copy shrinks again: the record's ten section headings become four; deletions land in every
  locale per the standing rule.
