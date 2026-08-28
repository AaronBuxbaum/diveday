# Delight-first design principles

Delight is this product's differentiator (see [product/vision.md](../product/vision.md)). These
principles are testable rules, not vibes. The `design-review` skill checks against them.

## 1. Speed is the first delight

Nothing charms like instant. Navigation feels immediate (prefetch, server components); mutations
are optimistic where safe; loading states are skeletons shaped like the content, not spinners.
If an interaction needs a spinner for more than a beat, redesign the interaction.

**Optimistic mutations earn their keep on three conditions: reversible, screen-local, and high frequency.**
Counter check-in (`CheckInActionForm`) is optimistic: it is staff-local at the front desk, high frequency during morning check-in rushes, and carries an immediate undo path.
In contrast, **roll call on the manifest remains strictly non-optimistic**: marking a diver aboard without confirmed server/store commit is how a boat sails with a ghost count. Safety-critical head counts require verified persistence before settling state.

## 2. Pass the dock test

Primary flows work one-handed on a phone, in glare, with wet fingers: touch targets ≥ 44 px,
critical text ≥ 16 px, strong contrast (AA — 4.5:1 text, 3:1 focus rings and control borders — is
the bar every new surface must clear, and manifest/roll-call surfaces aim higher),
**Critical text is any text a person reads to make a decision or to identify a record** — a person's
name, a trip title, a time, a money amount, a status word, or a control's own label. Text that
supports one is not critical: a caption, a timestamp beside a name already stated, a column header,
or small print.

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

**Gestures are strictly limited to where they earn their keep.**
The app is tap-first; precision swipe and drag gestures are avoided unless they provide clear ergonomic value over small controls in the field. Exactly two gestures exist:
1. **Buddy pairing drag** (`BuddyDragGroups`): drag a diver onto a buddy to form a pair, backing the exact same form checkboxes.
2. **Pull-to-refresh** (`PullToRefresh`): pulling down at the top of the offline manifest (`OfflineManifestView`) or check-in queue to force a sync without hunting for a small text button on a sunny dock.

Both share the exact same contract: unified touch + pointer events (zero third-party gesture libraries), visual progress feedback with resistance dampening, cancel curves when released below threshold, and zero interference with ordinary vertical scrolling.
A directional swipe never commits a head-count change; only the explicit check-in tap/re-tap or
roll-call tap changes that count.

## 3. Calm surfaces, earned moments of joy

The everyday UI is quiet: generous whitespace, few borders, muted ink for secondary text. Joy is
concentrated where the user finishes something — booking confirmed, waiver signed, roll call
complete — as a small, fast, coral-accented moment (≤ 400 ms). Delight loses meaning if it's
everywhere; `--accent` is rationed on purpose.

**The shop home's good news is not a row kind, and that is settled.** Today's queue has twenty-two
action kinds and every one is a problem — its tone map resolves only to danger, warning or neutral,
because a work queue that surfaces work has nothing else to say. The right reading of that is not
that the surface is joyless (issue #808): the warmth lives *outside* the rows, in two places that
render **nothing at all** when they are not true.

- **"Today's boats are all clear 🤙"** — an accent-toned line above the queue, shown once the
  imminent and next-24-hour bands are empty while later work remains. The last blocker of the
  morning clearing is a finish, which is exactly what §3 rations joy to.
- **"Nothing is waiting on you"** — the queue's own empty state, for when the whole week is in order.

Both are already built, both are tested, and neither fires on a shop with a full queue — which is
the discipline §9 applies to a column with nothing to say, applied to a compliment.

So a *standing* good-news line, below the queue and present whether or not the day earned one, is
declined rather than un-built. Brand's own row says it: warmth is for "real moments of progress …
avoid turning every screen into a celebration". On a bad morning a line announcing yesterday's
sold-out charter, sitting under a diver who cannot board, is the software pleased with itself; on a
good morning the two moments above already say so. If a shop ever asks for its own scoreboard, that
is a surface of its own and not a consolation attached to the work queue.

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
bespoke warm pattern: a **drawn SVG glyph** in a rounded circle (the
`src/components/StaffDestinationIcon.tsx` set is the existing source), a heading, and subtext,
with no card border. The mark was an emoji until 2026-08-27; the Clearwater ADRs forbid emoji on
anything new, so the drawn glyph is now the rule, with shipped emoji grandfathered only until
their surfaces are next touched (`OfflineManifestView` is the one standing case). An **empty
section within an otherwise-populated page** — a list or panel sitting below
filters, a header, or other real content — uses the shared `EmptyState` component
(`src/components/EmptyState.tsx`), the dashed-border card. Never a bare `<p>`/`<li>` styled
ad hoc for either case, and never the bespoke terminal pattern for a section that isn't the whole
page — the glyph circle reads as "you've reached the end," which is false when siblings above it
still have content.

**When every section on a page is empty at once, the page collapses to its own one-line state.**
The rule above picks the right component for *one* empty section and says nothing about all of
them firing together, which is a different surface: N dashed boxes and N copies of the same
decorative glyph, each saying nothing happened, and — above any of them that carries a caption —
a sentence explaining a mechanism that has no content to apply to. The premise of the section
rule ("an otherwise-populated page") is simply false there. So render the page's heading, one
sentence carrying whatever the removed boxes were carrying, and the one act still available;
drop the sections entirely. Close-out is the worked example: three sections, three empty states,
a heading reading "A quiet day at the dock" and 900px of boxes disagreeing with it
(`src/app/shop/[shopSlug]/close-out/page.tsx`'s `quietDay`). Note what makes this catchable —
the state exists only on a shop with no departures, which a seeded demo never is, so it needs a
capture of its own against a freshly onboarded shop or nobody will ever look at it.

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

**A bar that fills scales, it does not resize.** All three of this app's progress bars animated (or
failed to animate) their `width`, which is layout — the browser reflows every frame of the
transition. `ProgressBar` in `src/components/ui/` is the one primitive: each fill is a sheet scaled
with `transform: scaleX()` from the left, on `--ease-out-soft`, and stacked bands are cumulative
sheets rather than sized boxes. The output is identical and nothing is laid out twice (issue #834).

**Motion that leaves does not use an ease-out curve.** `--ease-out-soft` front-loads almost all of
its travel, which is right for something arriving and wrong for something departing: an exit on it
reads as an instant jump, a long dead pause, and then a hard cut. Exits take `--ease-in-soft` —
slow off the mark, then away — which is why the schedule board's row menu could feel
simultaneously too fast to see and 450 ms long.

**An exit says so in its name.** This rule was written here the day the row menu was fixed, and
three exits stayed on the arrival curve for weeks anyway — the undo toast, which fires on every
reversible mutation in the app; the diver row leaving the roster, which is the one exit doing real
explanatory work; and the scaled-out overlay (issue #756). Nothing swept for them because nothing
could tell an entrance keyframe from a departing one. So the convention carries weight now: a
keyframe that animates something *away* carries `out` or `dismiss` as a hyphen-separated word, and
`scripts/check-exit-curves.mjs` holds every utility that runs one to `--ease-in-soft`. It reads
names, not travel — an exit called `fade-away` is invisible to it — which is the cost of a rule a
grep can check at all.

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

**Between pages there is no motion, and that is the answer rather than a gap
(issue #795, decided 2026-08-27).** Every navigation in this app is a hard cut:
`grep -rn "ViewTransition\|startViewTransition" src/ next.config.ts` returns nothing, and it will
keep returning nothing. The case for changing that was real — this app's navigation *is* a
hierarchy (Today -> a departure -> its manifest; Divers -> a diver -> their order), a shared element
morphing across a cut is the strongest "where did it go" motion there is, and the diver's name
exists on both the roster row and the record's `<h1>`. It was prototyped on exactly that pair and
came back **no**, for two reasons that are worth writing down so nobody re-derives them:

- **The skeleton is already the answer to that question.** Every route declares `instant = true` and
  owns a body-shaped `loading.tsx` (ADR 20260804-instant-navigation), so a client navigation paints
  the *skeleton* of the destination first. There is nothing for the roster's name to morph into: at
  the instant of the transition the destination is a pulsing bar, not an `<h1>`. Making the morph
  work means holding the old page on screen until the record's data resolves — which is exactly the
  property that ADR exists to protect, and the app's best one. A content-shaped skeleton and a
  shared-element morph are two answers to the same question, and this app already shipped one.
- **It is not reachable from typed application code here.** React's `<ViewTransition>` lives only in
  the canary channel Next vendors as `react-experimental`; the installed `react` is 19.2.8 stable
  and `@types/react` describes that, so an import of it fails `pnpm typecheck` outright. Reaching it
  means an untyped import of an unstable API on a component nearly every staff page renders.

**Not proposed and not open: a blanket page cross-fade.** Motion with no job is what this whole
principle forbids, and a fade over the instant paint would blur the one thing the reader is here to
read. If this is ever revisited it needs a new fact — a stable `ViewTransition`, or a decision that
the instant paint is worth trading — not a fresh opinion.

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

**Money that is reconciled looks exact; money that is scanned does not have to.** An order's rows
and total, a refund, an invoice, the monthly report and the export carry their minor units always
(`formatMoneyCents`) — a column only aligns on a decimal point every figure has, and a ledger figure
should look like one. A price being *scanned* down a list — the public schedule, the trip hero, the
course catalog, a settings summary row — uses `formatMoneyScanned`, which drops the minor units only
when the amount is a whole major unit, so "$95" and "$62.50" both stay honest. Twelve `.00`s in one
scroll of a shop's schedule was principle 9's cross-out test failing on the largest text in the row
(issue #769).

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
- **In a progress bar, colour the gap rather than the achievement.** A bar whose *filled* part
  carries the brand hue makes the finished rows the loudest thing in the column and leaves the
  ones needing somebody as the faintest — on the owner's monthly report, fifteen of twenty-one
  waiver rows drew a full teal bar while the two at 0%, booked charters with not one signature,
  drew an empty grey track. Draw the filled part quiet at every ratio and let the **remainder**
  carry the attention tone. It needs no threshold to argue about: at 0% the whole bar is the
  warning, at 100% there is nothing left to warn about, and every value between shades itself.
  Opt in per column, because not every gap is work — unsigned waivers are something to chase,
  empty seats on a month being reviewed are a fact, and toning the second would put amber on most
  rows of a healthy report.
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
- **Page width says what kind of surface this is — four tiers.** A reading or settings surface
  (Settings, the course catalog and editor) stays at `max-w-3xl`, a comfortable line length. A
  single record's own page, or a focused list rather than a dense table — the check-in queue, a
  diver's own record, promos, requests, staff reviews, and every page under one departure (the
  trip layout, so Overview/Guests/Manifest/Prep share it) — takes `max-w-4xl`: narrower than a
  work surface with several sections, wider than a single reading column. Staff work surfaces
  with more than one section (the shop home, orders, reports, close-out) default to `max-w-5xl`;
  a wide board or dense table (the schedule board, the divers roster, staffing) earns `max-w-6xl`.
  Don't pick a width per page from scratch — pick the tier that matches the surface's shape.
  A handful of diver-facing pages (a course's own page, a shop's public reviews) and every
  marketing page already sit at `max-w-4xl` too; that is a coincidence of this tier fitting their
  shape as well, not a claim this system reaches outside staff surfaces. And a route's
  `loading.tsx` wears the **exact same width** as its page,
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

### Viewports — which devices are photographed

`e2e/visual.spec.ts` captures every surface at a phone (390x844) and a desktop (1280x800), and
`scripts/screenshot.mjs` defaults to the same pair on purpose, so a design review looks at the two
widths CI checks. That pair is the standard responsive pair and it is right for a marketing page, a
booking page and a diver's `/ready`.

It is the wrong device for the surfaces a dive shop actually works from. `/check-in` calls itself
"Counter mode", and a counter device is an iPad on a stand; the manifest is read at the rail,
frequently through a dry case, which is the entire premise of `boat-mode` above. So five staff
surfaces — the counter check-in, the live manifest, the schedule board, the trip prep list and the
departure log — are captured at a **third, portrait-tablet width of 820x1180**, named in
`TABLET_SURFACES` in that spec. `node scripts/screenshot.mjs <path> --tablet` gives a design review
the same width.

Five, not sixty-nine: a third width everywhere would be another 320 screenshots and the baseline
churn to match, and most routes have nothing new to say at 820px. The list being a constant with a
comment is what keeps the cost bounded and the choice arguable.

What that width is there to catch is the **shape change**, not the pixels. 768-1024px is where
Tailwind's `sm:`/`md:` breakpoints collapse a two-column `FieldGrid`, and where `StaffTabBar`'s
six-slot phone dock gives way to the header nav. Those two swap at `lg` (1024px) and they swap
together — the dock is `lg:hidden`, the header strip is `hidden lg:flex` — so a portrait tablet
correctly gets the touch dock with the wide content layout, and now there is a baseline that would
notice if one half of that pair ever moved without the other.

Landscape phone is a real posture at the rail and is deliberately **not** photographed. Add it when
something other than a hunch says it needs to be.

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

**Something that looks wrong and is right goes in the register.**
[settled-questions.md](settled-questions.md) is the index of those — a roll call showing two
buttons, an orders column blank on most rows, a staff surface that turns out to be *less* dense than
the diver's when you actually measure it. Each row points at the file whose comment carries the
reasoning, so the register can never become a second source of truth. Read it before a sweep and add
to it during one; it exists because every sweep re-derived the same dozen false positives.

## The holistic pass (run it before any checklist)

Every design review starts holistic, before the itemized criteria — a surface can pass every
mechanical check and still be a pile of well-formed cards with no point of view. Answer, in
writing, one sentence each — **in [surfaces.md](surfaces.md)**, which is where "in writing" goes.
Without a destination this requirement produced exactly one recorded answer in the whole repo, and
every other pass evaporated with the session that ran it (issue #825):

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

**Where the answer constrains code, say so beside the code and pin it with a test.** The shop home is
the one surface that recorded its one idea before `surfaces.md` existed, and the reason it held is
that `RoleOrientationCard` defers to it *by name* in a doc comment and a test fails if the
orientation box out-ranks the queue. An entry in `surfaces.md` is the index; a comment and a test are
what stop it rotting.

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
- [ ] Empty-state pattern matches terminal-vs-section (bespoke drawn-glyph pattern for a whole
      empty page, shared `EmptyState` for an empty section within a populated page)
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
