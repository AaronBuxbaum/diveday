# Delight-first design principles

Delight is this product's differentiator (see [product/vision.md](../product/vision.md)). These
principles are testable rules, not vibes. The `design-review` skill checks against them.

## 1. Speed is the first delight

Nothing charms like instant. Navigation feels immediate (prefetch, server components); mutations
are optimistic where safe; loading states are skeletons shaped like the content, not spinners.
If an interaction needs a spinner for more than a beat, redesign the interaction.

## 2. Pass the dock test

Primary flows work one-handed on a phone, in glare, with wet fingers: touch targets ≥ 44 px,
critical text ≥ 16 px, strong contrast (AA — 4.5:1 text, 3:1 focus rings and control borders — is
the bar every new surface must clear, and manifest/roll-call surfaces aim higher),
forgiving inputs (autocomplete, sensible defaults, no precision gestures). A 44 px target must
center its own label, and fields in a row must share one baseline no matter how their captions
wrap — both come free from the primitives in
[forms-and-controls.md](forms-and-controls.md). Roll call gets the
most extreme version of this. Live and offline boat surfaces run in `boat-mode`, which follows the
device's own light/dark preference — bright by day so the manifest reads in full sun, dark for a
night dive when a white screen would blind the deck — while boosting ink, border, and action
contrast well past the app palette in both schemes: every boat-mode ink and action token clears
6.2:1 against its own surfaces, where the app palette's weakest token sits at 4.4:1. Visible
connectivity/freshness states, a sticky progress cue, and an accessible skip link keep any
operational state from hiding behind deck glare.

## 3. Calm surfaces, earned moments of joy

The everyday UI is quiet: generous whitespace, few borders, muted ink for secondary text. Joy is
concentrated where the user finishes something — booking confirmed, waiver signed, roll call
complete — as a small, fast, coral-accented moment (≤ 400 ms). Delight loses meaning if it's
everywhere; `--accent` is rationed on purpose.

## 4. Words sound like a good dive briefing

Microcopy is warm, plain, and brief — a competent divemaster, not a lawyer or a mascot. Empty
states teach ("No trips yet — schedule your first charter"); errors say what happened and what
to do next; buttons are verbs ("Add diver", not "Submit"). No jargon divers don't use; correct
use of the jargon they do (see [product/glossary.md](../product/glossary.md)).

**Never surface the implementation.** Encryption, sync, snapshots, envelopes, reconciliation,
tokens, caching, tenancy, "fail-closed", and database words stay out of user-facing copy. The same
goes for our own process artifacts — ADRs, "requirements," specs, tickets, and any other
engineering-doc vocabulary have no place in anything a shop owner or diver reads; those words
belong in `docs/`, commit messages, and code comments, never in a page, email, or error message.
Say what the person gets — "saved on this phone", "works without signal", "DiveDay double-checks
it when you're back in service" — not how we built it, and not what we wrote down to decide to
build it. Three carve-outs:

- **Payment** may say "pay securely" — that is the reassurance people expect at a checkout, and
  nothing more technical than that.
- **Safety surfaces keep their precision, in human words.** A stale device copy must never look
  current — but the label is "Saved 4 hours ago — refresh before you rely on it", not "stale
  snapshot". Translating jargon is never license to blur an operational state.
- **`/privacy` may name the protection, because that is the question its reader came with.** On a
  page whose whole subject is who can read a shop's divers' data, "encrypted" is the answer rather
  than the machinery — it is why that page already says a push service gets "an encrypted payload
  it cannot read", and why it says the same of the copy a crew phone holds. This is a carve-out for
  a **disclosure**, never for a capability claim: the same fact is refused on `/product`, where the
  offline line says a head count works with no signal and never that a snapshot is encrypted. A
  disclosure also has to be honest about where the protection stops — the phone copy is encrypted
  against a reader of the device's storage, not against someone holding the unlocked phone, and the
  page says so.

**The name is DiveDay** — one word, two capitals. Use it as the actor when the system does
something on the user's behalf ("DiveDay will catch up when you're back in service"), and
otherwise stay out of the way: the product speaks as the shop's own tool, not as a character
with a personality.

**Empty states follow one rule: terminal vs. section.** A **terminal/whole-page** empty state —
nothing else renders on the page (see `src/components/OfflineManifestView.tsx`, whose "no saved
manifests" and "nothing here offline" screens are the whole page) — uses the
bespoke warm pattern: a large emoji in a rounded circle, a heading, and subtext, with no card
border. An **empty section within an otherwise-populated page** — a list or panel sitting below
filters, a header, or other real content — uses the shared `EmptyState` component
(`src/components/EmptyState.tsx`), the dashed-border card. Never a bare `<p>`/`<li>` styled
ad hoc for either case, and never the bespoke emoji pattern for a section that isn't the whole
page — the emoji circle reads as "you've reached the end," which is false when siblings above it
still have content.

**A long list gets one pager, not a per-surface invention.** Every paged staff list renders
`src/components/Pager.tsx` — previous, "Page 3 of 7", next — with its words from the one shared
`shared.pager.*` key set and its data from `offsetPage` (`src/db/paging.ts`). Both directions
always work and the reader is always told where they are; the pager draws nothing at all when
there is only one page. Four grammars for this used to coexist, and the most common of them was
forward-only — a staffer three pages into the roster could only start over (ADR
[20260803-one-pagination-model](../architecture/decisions/20260803-one-pagination-model.md)). The
one exception is a list that is a genuine **stream** with no end to count (the schedule board's
upcoming departures), which pages by cursor and says so in direction words rather than page
numbers. A list that must be bounded to stay usable gets a **stated** default window with a
visible way out — never a silent truncation.

## 5. Motion has a job

Animation exists to explain (where did it go, what changed), 150–250 ms, ease-out
(`--ease-out-soft`), transform/opacity only. Everything respects `prefers-reduced-motion` — the
kill-switch in `globals.css` stays.

## 6. Trustworthy by inspection

This app handles safety documents. Manifests and cert checks look exact: tabular numbers for
counts, unambiguous states (never color alone — icon + label), timestamps with timezone, print
output as considered as screen output.

## 7. Undo over confirm — one model everywhere it's safe

A reversible mutation gets an **undo**, never a blocking `confirm()` dialog. Two shapes:

- **High-frequency toggles** (board / not-board / aboard, counter check-in) use **re-tap**:
  tapping the confirmed "Aboard ☑️" state clears it. The correction is its own event, so the audit
  trail keeps it (never a delete). **The settled control is the affordance — don't print a "tap
  again to undo" line under it.** A button a finger just put into "Boarded ☑️" already reads as a
  state you can leave, its accessible name already says "Undo", and a sentence repeating that under
  every settled row is one line of chrome per person down a full boat (principle 9). The one
  exception is a settled state whose control carries **no done-check to point at** — "Not back
  aboard", where the sentence names the control instead ("Tap 'Not back aboard' again to undo"),
  because the alternative is a crew member reading a danger-toned button as a claim they cannot
  take back.
- **Destructive or rare** actions (delete a diver) confirm *after* the fact with an **Undo
  banner** — the action lands immediately and the banner offers a one-tap reversal.

A blocking `confirm()` is reserved for what is genuinely **irreversible or a send** — issuing or
reissuing a waiver link (the old link stops working, an email may go out), removing a booking
(inside the shop's refund window it fires an automatic Stripe refund; undo restores the seat but
can't claw back money already sent), or resending a waiver to someone already notified. A
`confirm()` on a purely reversible action is a bug: it slows the common path to guard against a
mistake that undo already handles calmly.

Three narrower carve-outs, found while sweeping the app's `confirm()` sites onto this rule — each
looks like it should be undo-able on its face, but isn't, for a concrete reason rather than "hard
to implement":

- **Sign out** stays a two-tap confirm, not an undo banner. An undo window means the session (or a
  passwordless resume) has to stay valid for a few seconds after the person walked away — on a
  shared boat or front-desk device, that's a real window for whoever touches the device next to
  reclaim the previous login, not just an inconvenience.
- **Removing a trip from the schedule board** (the builder's "remove", for a departure nobody has
  touched yet — distinct from cancelling one with a roster) stays a confirm. It deliberately hard-
  deletes across several related tables rather than leaving a cancelled ghost behind ("clutter, not
  history" — `src/db/trips.ts`); reconstructing that from an undo-toast payload would just
  reintroduce the ghost-row problem it was built to avoid.
- **Removing a recap photo** stays a confirm. The delete queues the stored image for deletion in
  the same step; a true undo would mean holding that deletion back until the undo window passes,
  which needs storage-layer support the surface doesn't have today.

Everything else — a private note, a promo code that never went live, hiding a review, a staff
member's roles and access — recreates cleanly from what the undo action already has on hand, so it
gets the banner.

## 8. Fewer controls, one obvious action

Every screen should tell the user what to do next without making them choose among equals. A row
of same-weight buttons is the user doing triage work that the design should have done for them.

- **One primary per view.** At most one primary-weight control rendered at a time (no explicit
  `variant`, an explicit `variant: "primary"`, or `variant: "danger-solid"`) per screen or
  section — count what's actually on screen together, not `buttonClass()` call sites: mutually
  exclusive branches don't stack, a call inside a loop can render many. Everything else competing
  for the same moment is `secondary`, `ghost`, `link`, or `danger` weight, not a second primary.
  If two actions feel equally important, one of them isn't as important as it feels; demote it.
- **Merge before you stack.** Three buttons that do variations on one action ("Approve",
  "Approve & note", "Approve & notify") are usually one button with good defaults — approving
  always notifies, and a note is a follow-up affordance, not a fork in the primary flow. Before
  shipping a row of buttons, ask what it looks like as one button plus sensible defaults.
- **State toggles, don't duplicate buttons.** Two buttons for opposite states ("Board" / "Remove
  from boat") are one re-tap control that reflects current state (principle 7) — never a pair
  that both stay visible.
- **Collapse the rare path.** An action used by a minority of users at a minority of moments
  (advanced filters, rare settings, "more options") sits behind progressive disclosure, not at
  equal visual weight to the common path. The default state should be good enough that most users
  never open it.
- **Test it by counting.** Look at a section at rest: more than two or three controls competing
  for attention is a finding. The fix is a merge, a demotion, or a disclosure — never a new
  wrapper that makes three buttons look tidier.

## 9. Say a shared fact once

A fact shared by every row belongs to the group, not the rows — repetition at equal weight is
noise pretending to be information. Row ink is reserved for what *differs* between rows; when a
column or badge would render the same value on nearly every row, that value either moves up to a
group header, or disappears until it has something to say.

- **Group what repeats.** A queue of people on the same boat states the boat — title, time,
  progress — once, in a group header; each row is just the person (the counter check-in works
  this way). A list that would repeat a warning per row states it once above the list.
- **"None" is not a status.** A column whose usual value is "None", "—", or an all-clear badge is
  the absence of information formatted as information. Render attention markers only on the rows
  that need attention; an empty cell says "nothing to see" better than a word does.
- **Don't say what the control already says.** A "Ready" badge beside an enabled "Check in"
  button states the same fact twice; the affordance is the status. Badges mark the exceptional
  state (Blocked), not the expected one.
- **Counts are facts, not alerts.** A per-row count that merely differs (cards on file, seats
  sold) is quiet muted text, not a pill — pills and badges are spent on the rows that need a
  staffer, so that when one appears it means something.
- **Collapse the settled row.** In a working list where each row can carry open work (the trip
  roster), a row with nothing left to do collapses to its header behind a labeled disclosure —
  detail at the moment it's needed, not on every row — while any open question keeps the row
  fully expanded. A deep link into a collapsed row must open it (`AutoOpenDetails`), so the
  collapse can never swallow what a link promised.

The test: read a list top to bottom and cross out every word that repeats an earlier row. What
survives is the list; what's crossed out belongs to a header or nothing.

## 10. The surface is the interface

The cleanest screen is not the one with the fewest pixels — it's the one where the user never has
to *look for* anything. Content leads; chrome defers. Concretely:

- **Show the answer, not a door to it.** If the app already knows the datum a user came for
  (seats left, next departure, who's still blocked), render it where the question arises —
  inline, on the row, on the tab — instead of behind a click. Navigation is for changing
  subject, not for fetching a fact the screen could have carried.
- **Actions ride on their objects.** An action belongs on the thing it affects — the row's own
  tap, a control revealed on hover/focus, the natural next step at the end of the card — not in
  a toolbar of detached buttons the user must map back to targets. A screen that needs a legend
  to connect its buttons to its content has the buttons in the wrong place.
- **Edit in place where safe.** A value a staffer corrects often (a note, a count, a name)
  invites editing where it's displayed, saving on blur/enter with undo (principle 7), rather
  than an "Edit" button that swaps the page for a form. Full forms are for creation and for
  changes with real consequences — not for every touch.
- **Hierarchy by type and space before boxes and buttons.** Reach for type scale, weight, muted
  ink, whitespace, and alignment first; borders, fills, and buttons are the *last* tools, not
  the first. When tempted to add a control or a card, first ask whether layout could make it
  unnecessary.
- **Remove until it breaks.** The test for every control and border on a finished surface: take
  it away — if the screen still works, it was noise. What survives is what the screen is.
- **Page width says what kind of surface this is.** Staff work surfaces (the shop home, orders,
  reports, close-out) default to `max-w-5xl`; a wide board or dense table (the schedule board, the
  divers roster, staffing) earns `max-w-6xl`; a reading or settings surface (Settings, the course
  catalog and editor) stays at `max-w-3xl`, a comfortable line length. Don't pick a width per
  page from scratch; a page still sitting between tiers (check-in's `max-w-4xl`) is legacy —
  move it to a tier when redesigning that page, never in passing. And a route's `loading.tsx`
  wears the **exact same width** as its page,
  because a skeleton narrower or wider than what replaces it is a sideways layout jump on every
  navigation into the route.

## 11. Creative within the system

The tokens and primitives are a vocabulary, not a template. A default stack of bordered cards
with a button row is the *fallback* composition, never the target — a surface whose content has
its own shape (a day's schedule, a boat's manifest, a diver's history) deserves a composition
designed for that shape. Creativity here is judged by one measure: does it make the surface more
instinctive — clearer hierarchy, fewer controls, answers closer to the questions? Novelty that
adds chrome or asks the user to learn a new grammar fails this principle even when it looks
striking. When designing a significant new surface, sketch at least two compositions before
building, and keep the one that survives principle 10's remove-until-it-breaks test. Bespoke
composition never exempts a surface from the mechanics: tokens, the form/button primitives, the
dock test, and one-primary all still apply.

## Tokens (the mechanics)

Defined in `src/app/globals.css`, bound to Tailwind — see
[ADR-0004](../architecture/decisions/0004-design-tokens.md) for the rules. Palette story: sunlit
sand (light) / open ocean at depth (dark); **lagoon** (`--primary`) is the action color;
**coral** (`--accent`) is rationed for earned moments; feedback colors (`--success`,
`--warning`, `--danger`) never carry meaning alone.

**Where the palette actually stands.** AA is the bar, and the light palette does not clear it
everywhere yet — so do not describe the app as WCAG AA conformant, in docs, in a page, or in a
PR description. Two known light-mode gaps are open and deliberately deferred pending a color-guide
decision: `--success`/`--warning` text on their own 10% tinted fills (4.38:1 and 4.39:1, against
AA's 4.5:1) and input placeholders (3.07:1 on `--surface-sunken`). Both are tracked in
[product/features/roadmap.md](../product/features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision),
and until they land the axe scan in `e2e/a11y.spec.ts` keeps its `color-contrast` rule excluded —
so CI will not catch a new contrast regression for you. Everything else measured clears AA, and
`--focus-ring` clears WCAG 1.4.11's 3:1 in all four palettes (worst case 4.66:1). New surfaces are
still held to the full bar; the exceptions are a documented backlog, not a lowered standard.

## The holistic pass (run it before any checklist)

Every design review starts holistic, before the itemized criteria — a surface can pass every
mechanical check and still be a pile of well-formed cards with no point of view. Answer, in
writing, one sentence each:

- What is this surface's **one idea**? If you can't say it, the surface doesn't know either.
- What **question does its user arrive with**, and is the answer already on screen — or behind a
  click the app didn't need to charge (principle 10)?
- Which **controls could dissolve** into the objects they act on — a row's own tap, a
  hover-revealed control, an in-place edit with undo, a good default — instead of standing as
  buttons?
- **Remove until it breaks**: what would you take away first? A control or border nobody would
  miss is a finding.
- For a significant **new** surface: does the composition fit this content's own shape, or is it
  the default card stack (principle 11)? If the default, sketch one alternative in prose — what
  moves where, what it buys — and either adopt it or say why the default genuinely serves better.

The same pass applies, in prose form, to persuasion surfaces and collateral: a marketing page has
one argument and a scrolls-until-answered count; a one-pager has one ask.

## Review checklist

- [ ] Semantic tokens only (no raw hex / palette-scale classes)
- [ ] Light **and** dark verified (screenshots)
- [ ] Dock test: targets ≥ 44 px, text ≥ 16 px, AA contrast (4.5:1 text, 3:1 focus ring/control
      border) — measured, not eyeballed; the axe scan does not check contrast today
- [ ] Buttons and button-shaped links via `buttonClass()`; labels centered in the target
- [ ] Stacked form fields via `<Field>`/`<FieldGrid>`; controls aligned across columns
- [ ] Loading = content-shaped skeletons; no layout shift
- [ ] Motion ≤ 250 ms, transform/opacity, reduced-motion respected
- [ ] Copy: verbs on buttons, teaching empty state, actionable errors
- [ ] State never conveyed by color alone
- [ ] Keyboard reachable, focus visible, semantic HTML
- [ ] One primary action per view/section; the rest are demoted, merged, or disclosed — not a
      row of same-weight buttons
- [ ] Empty-state pattern matches terminal-vs-section (bespoke emoji pattern for a whole empty
      page, shared `EmptyState` for an empty section within a populated page)
- [ ] No fact repeats at equal weight down a list: shared facts sit in a group header, "None"
      columns and all-clear badges are absent rather than rendered, and a badge marks only the
      exceptional state
- [ ] The screen carries the answers its users come for — no click to fetch a fact the app
      already knows
- [ ] Actions sit on the objects they affect, not in a detached toolbar; frequent small edits
      happen in place where safe
- [ ] Hierarchy is carried by type, weight, and space before borders, fills, and buttons; every
      remaining control and border survives the remove-until-it-breaks test
- [ ] A significant new surface got at least two sketched compositions, and the shipped one is
      shaped by its content, not the default card stack
