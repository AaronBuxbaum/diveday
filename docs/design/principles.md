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

**Haptics are an Android-only channel, and the screen carries the same job everywhere.**
`navigator.vibrate` — the tick when a roll-call tap lands, the triple buzz when one is refused, the
pattern as the head count crosses each quarter — is **not implemented in Safari on iOS at any
version**, so on an iPhone none of it has ever fired. The call sites feature-detect correctly and do
nothing, which is why nobody noticed for as long as they did (issue #817). There is no sound
anywhere in the app either, so on iOS the whole feedback layer is visual.

What follows from that, for anything built on the channel: **a haptic is never the only carrier of
a state**, and least of all a refusal, which is the one with a safety-adjacent job. The roll-call
row changes under the thumb that pressed it and a refusal renders `role="alert"` text beside the
control; the buzz confirms what the screen already said. The channel also has an off switch —
per device, beside boat mode, because `prefers-reduced-motion` is about animation and does not
reach vibration ([accessibility-tradeoffs.md](accessibility-tradeoffs.md)). One module,
`src/components/haptics.ts`, holds the availability check, the preference and the platform note, so
none of this has to be rediscovered at a call site.

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

**Every sentence earns its place, or it goes.** Brevity is not "write it shorter" — it is a
standing question asked of each string: *would the reader get something wrong without this?* If
no, delete it, and delete the element that held it. Two kinds of sentence survive the question —
one carrying a state or consequence the surface cannot show on its own, and one that is a real
moment of delight. A caption restating its own heading, a clause explaining which rule won, a
second manual path to what a button beside it already does, and an apology for a refusal are all
noise wearing the costume of helpfulness. The filter, its five deletions, and the sweep are in the
[copy-restraint](../../.claude/skills/copy-restraint/SKILL.md) skill; apply it whenever you write,
edit, or merely read past a user-facing string.

**Accessibility is not the tiebreaker.** Where a genuinely more accessible option and a genuinely
better standard-user experience conflict, build the standard-user one and record the trade in
[accessibility-tradeoffs.md](accessibility-tradeoffs.md). That register is narrow on purpose: it
covers visible prose and presentation, never keyboard reach, never a mutating control's accessible
name, and never a safety surface — principle 6 holds on manifests, roll call, cert gating, and
medical flags without exception. A choice that costs the sighted mouse user nothing (an
`aria-label`, a role, a focus ring) is not a trade at all; skipping it is a defect.

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
kill-switch in `globals.css` stays, and it kills `animation-delay` as well as duration, so a
stagger cannot survive it.

**Motion that leaves does not use an ease-out curve.** `--ease-out-soft` front-loads almost all of
its travel, which is right for something arriving and wrong for something departing: an exit on it
reads as an instant jump, a long dead pause, and then a hard cut. Exits take `--ease-in-soft` —
slow off the mark, then away — which is why the schedule board's row menu could feel
simultaneously too fast to see and 450 ms long.

**A disclosure's body arrives rather than appearing.** `<details>` is this app's most-used
interaction — 70 of them — and its caret rotated over 200 ms while the content it pointed at landed in
a single frame: the affordance animated and the payload not, which reads as the opposite of what
happened (issue #831). `details::details-content` in `globals.css` fades and rises it, once, so all 70
inherit it the way the 21 carets inherit their rotation from `DisclosureCaret`.

**Not its height**, and that is this principle applied rather than an omission: interpolating a
disclosure's height animates *layout*, costs a reflow per frame on each of the seventy, and needs
`overflow: hidden` on the content — which on these surfaces means clipping the roll call's controls,
the board's inline panels, and every menu that opens inside a disclosure. The quarter-rem rise says
"this came from the summary above" and moves nothing the browser has to lay out again.

**One earned exception to the 250 ms ceiling: a disclosure that unfolds.** A group of controls
revealed on request (the board's "⋯" row menu) animates per child with a stagger, so the sequence
runs longer than any one element's motion — 260 ms in and 280 ms out, staggered 50 ms, so the
whole gesture lands inside principle 3's 400 ms. The stagger *is* the effect; without it the same
motion is a 16 px nudge nobody notices. A spring (`--ease-spring`, which overshoots and settles) is
rationed like `--accent`: it claims the thing has weight, which is true of something being unfolded
and a lie about anything that merely appears. A JS unmount timer paired with an exit animation
names the CSS it must outlast, and vice versa.

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
- **A page confirms you arrived, in the word you tapped.** The first thing anybody looks for on
  arrival is that they got where they meant to go — so a staff surface's eyebrow is its
  *destination's* name, read from `STAFF_DESTINATION_LABEL_KEYS` in
  `src/lib/staff-destinations.ts` so it is literally the string the nav tab, the More menu, the
  phone dock and ⌘K all render. Never a second copy of that word in the page's own bundle, and
  never the nav *group* it belongs to: `/reports` said `OWNER` above "How's your month", so
  neither line said "Reports".
  The `<h1>` keeps its voice. "How's your month" and "What divers said" are better writing than
  the tab labels and they stay; the eyebrow is what lets a page say both things at once, at no
  cost in height. Where a headline is genuinely a *state* rather than a name — Close-out's "A few
  things are still open", Today's greeting — the eyebrow is the only stable name the page has, so
  it is not optional there. And where the headline is a stable name of its own, it goes in
  `STAFF_DESTINATION_TITLE_KEYS` so ⌘K finds the page by it: a staffer who thinks of Reports as
  "how's my month" and types that used to get nothing back (issue #824).
- **A surface below depth 1 names its parent and links to it.** Through the page's eyebrow where it
  has one — `ShopPageHeader`'s `eyebrowHref`, or `EyebrowBackLink` for a header that is not that
  component — and through an explicit "← Parent" link only where the page has no eyebrow to spend
  (the diver record's "← All divers", the course editor's "← Courses"). Two forms, chosen by whether
  the header has an eyebrow, and never a third: three ways up existed before this rule and which one
  a page got was a function of when it was written (issue #823).
  The four trip surfaces were the case that named it. They are the deepest pages in the staff app,
  and their first header link was the Overview/Guests/Manifest/Prep strip — which moves you
  *sideways* between one departure's own pages and never back to the board. A crew member finishing
  a roll call had the global nav, which on a phone is the dock at the bottom of the screen: a jump
  out of the departure rather than a step up from it.
  The word is the parent's own, from `STAFF_DESTINATION_LABEL_KEYS`, for the same reason the eyebrow
  is. And no breadcrumb *trail*: chrome defers, the eyebrow already carries the parent's name, and a
  two-level app does not need one.
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
  navigation into the route. `pnpm check:loading-skeletons` (in `pnpm check:repo`) enforces both
  halves — that a page *has* a sibling skeleton, and that the two containers match — because a
  route with none silently paints its nearest ancestor's, a picture of a different page at a
  different width, and that only shows up on a cold navigation over a slow link.

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
PR description. One known light-mode gap is open and deliberately deferred pending a color-guide
decision: input placeholders (3.07:1 on `--surface-sunken`), tracked in
[product/features/roadmap.md](../product/features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision).
Everything else measured clears AA, and `--focus-ring` clears WCAG 1.4.11's 3:1 in all four
palettes (worst case 4.66:1).

**CI does catch a contrast regression now**, on every surface `e2e/a11y.spec.ts` scans — the axe
scan's `color-contrast` rule was turned back on 2026-08-23 with no exclusion list at all (issue
#793). It had been off since 2026-08-01 on the belief that it fired app-wide on the frozen token
values; measured, it did not. All 24 failing nodes were one mechanism, and none of them was a
frozen value.

**That mechanism, because it is the one to know:** a `bg-<hue>/10` fill is *translucent*, so text
above it contrasts against the hue mixed over **whatever is behind the element** — and every ratio
in this palette assumed that was `--surface`. A status pill rendered straight onto `--background`
loses 0.65:1; one nested inside a tinted row loses 0.58 more, which is how a `bg-primary/10` badge
on `/check-in`'s green boarded row reached 4.09:1. So a coloured ink never sits on a `/N` fill:
it sits on the opaque `--<hue>-tint` token, which resolves against `--surface` once and is the
number the palette computed wherever the element is mounted. Reach for `Badge` and it is already
done for you. `text-success`/`text-warning` on `--surface-sunken` want the `-strong` twin for the
same reason, and dimming a row with `opacity-*` dims its contrast ratio with it — quiet ink is
`text-muted`, which is a measured token.

### Writing direction

DiveDay's layout is written to be **direction-agnostic**: logical properties (`ms-`/`me-`, `ps-`/`pe-`,
`start-`/`end-`, `text-start`/`text-end`, `border-s`/`border-e`) rather than their physical twins, so a
margin that means "after the text" stays after the text whichever way the text runs. About 190 of them
are already in `src/components` against a few dozen physical ones, and
`pnpm check:logical-properties` is what keeps that ratio moving one way — ratcheted per file like
`check:tokens`, with the existing ones grandfathered.

`<html dir>` is derived from the negotiated locale (`localeDirection`, `src/i18n/lang-script.ts`),
alongside `lang` and corrected by the same pre-hydration script. Both shipped locales resolve to
`ltr`, so it renders nothing differently today; what it changes is that `globals.css`'s `:dir(rtl)`
rule for the `<select>` indicator can match at all. It never could — somebody wrote RTL-aware CSS on
purpose and nothing in the app had ever set a direction (issue #733).

**This is not RTL support and must not be described as one.** No RTL locale ships, and nobody has
looked at this app in one. The honest statement is the one above: the layout is written to be
direction-agnostic and is untested in an RTL locale — the same care the WCAG AA wording takes in
[product/features/roadmap.md](../product/features/roadmap.md).

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
- [ ] Motion ≤ 250 ms (a staggered disclosure may reach 400 ms), transform/opacity,
      exits on `--ease-in-soft` not `--ease-out-soft`, reduced-motion respected
- [ ] Copy: verbs on buttons, teaching empty state, actionable errors
- [ ] Every remaining sentence survives the copy-restraint question — no caption restating
      its heading, no clause explaining which rule won, no apology, no second path to a
      button already on screen
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
