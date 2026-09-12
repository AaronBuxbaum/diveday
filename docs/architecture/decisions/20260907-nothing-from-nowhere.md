# 20260907-nothing-from-nowhere — Every change on screen comes from somewhere, anything a finger is on obeys it, and one physics governs all of it

- **Status:** Proposed — pending H-69 a and c (the spring's ration, and whether structural motion
  reaches the roll call). **H-69 b decided 2026-09-07 (Aaron Buxbaum, in session): yes, the Wallet
  pass** — built now and shipped dark until the credentials are held; the implementation spec is
  [SPEC.md](../../design/canvases/20260907-nothing-from-nowhere/SPEC.md). Slices 18a–18f in the roadmap; **18a–18d shipped 2026-09-07**,
  taking H-69 a's recommended answer, holding H-69 b and c
- **Date:** 2026-09-07
- **Design:** [the canvas](../../design/canvases/20260907-nothing-from-nowhere/README.md) — seven
  artboards on two pages: the cover and the Physics sheet; then the roll, the counter, the sheet,
  the title and the pass
- **Scope:** [principles.md](../../design/principles.md) §5 and the motion tokens in
  `src/app/globals.css`; every tappable control; every count that changes in place on a staff
  surface; every list a row leaves or re-enters; the More sheet (`StaffTabBar`) and the embed
  lightbox; the staff header on a phone; the thread (`/ready/[token]`)

## Context

The owner's brief on 2026-09-07: another look at the design; clever decisions that are delightful
and elegant; think Apple, in animations and features.

Three canvases in the last week spent their budgets on warmth
([20260901-diveday-reimagined](20260901-diveday-reimagined.md)), on composition and on time
([20260904-reef-all-the-way-down](20260904-reef-all-the-way-down.md)), and on the product filling in
what it knows ([20260906-before-you-ask](20260906-before-you-ask.md)). None of them touched how the
interface *moves*, and the repository's motion rules, which are good, were each written the day one
thing was fixed: the bar that scales, the exit curve, the disclosure body, the unfolding menu. Read
from the running app on the day, with the whole tree inventoried (seventeen keyframes, three curves,
one duration token):

1. **A fact that changes in place swaps.** "6 of 10 here" becomes "7 of 10 here" in one frame.
   The dial's water rises over 300ms and the figure beside it jumps, so one change gets two
   answers, one of which moves. There is no count that rolls anywhere in the tree.
2. **A row that leaves takes 200ms and the gap closes in none.** The counter row sinks
   (`CounterQueueRow`, `animate-fade-out`) and the roster row departs on the exit curve, as
   principle 5 asks. The rows beneath jump a row height in a single frame, so the eye watches the
   wrong thing move.
3. **The sheet arrives on a timer and leaves on a tap.** The More sheet rises over 200ms
   (`rise-in`) and cannot be dragged; it dismisses on a `pointerdown` anywhere on the scrim, which
   on a phone is the top of the screen, reached by the thumb that opened it from the dock. The
   dock test forbids that reach. `PullToRefresh` and `BuddyDragGroups` already carry gesture
   physics under one written contract; the sheet is the third gesture and does not have it.
4. **Timing is ten numbers in two languages.** Durations run 150, 180, 200, 220, 260, 280, 300,
   320, 360 and 520ms with one token among them, and every JS timer (`MENU_CLOSE_MS = 390`,
   `EXIT_DURATION_MS = 200`, `useExitAnimation(open, 180)`) is a CSS number copied by hand, each
   with a comment saying the two must move together.
5. **The press is a 2% shrink that eases.** `buttonClass` carries `active:scale-[0.98]` on the
   default 200ms transition, so a 90ms tap barely sees it; a row, a chip, a dock tab and a ledger
   line do nothing under a finger at all.

An Apple interface moves little, and this repository declined page transitions on 2026-08-27 for
two reasons that still hold. What such an interface does is behave as a physical thing: it
acknowledges the finger at once, it stays under the finger for as long as the finger stays, and a
change on screen comes from somewhere.

## Decision

Proposed, in six parts. Parts 2, 3 and 6 carry the three owner calls recorded as H-69.

### 1. The rule, and what renders when it fails

Every move below passes four tests, and each names what renders when it does not:

| Test | What | Otherwise |
| --- | --- | --- |
| Source | Every motion answers where a thing came from or what changed: a digit from below, a row from the place it held, a sheet from the dock, a title from the top of the page. Motion that answers neither has no job (principle 5) | the cut, as today |
| Finger | Anything a finger is on goes down with no easing, follows the finger one for one while it holds, and takes the finger's speed when it lets go. No timer runs while a finger is on the thing | the tap, as today |
| Silence | At rest nothing moves: no idle animation, no loop, no standing effect. A reduced-motion reader gets the swap and the cut everywhere through the existing kill-switch; a thing under their own finger still follows it, because tracking a finger is not animation | nothing |
| Safety | Motion follows the commit and never leads it. On the counter the roll follows the optimistic commit principle 1 grants it; on the roll call a state changes on screen when the server has it. A head count never rolls: a digit mid-roll is neither number for 200ms, on the one figure a crew reads in glare to decide. Every ban stands: no drawing, coral or drawn motion on a manifest, roll call, cert check, waiver or payment, or beside a refusal | the swap |

### 2. One physics, written once (H-69 a)

Principle 5 gains a ladder and a table, both on the canvas's Physics sheet, and loses nothing:

- **Three rungs as theme tokens** beside the three curves: `--motion-quick` 150ms (a scrim, a
  control letting go), `--motion-base` 200ms (the default, unchanged: a figure, a row, a body
  arriving, a toast, a sheet leaving, a panel opening from its control), `--motion-unfold` 280ms
  (a group of controls unfolding per child; the board's menu moves from 260/280 to one rung). The
  two ceilings stand as limits and not rungs: 400ms for a staggered disclosure, 600ms for a drawn
  moment (budget rule 2). `motion-tokens.test.ts` extends to refuse a bare millisecond in a
  component, and one reader, `motionMs(rung)`, gives JS the same number, so a timer names a rung.
- **The press.** Every tappable thing (button, row, chip, dock tab, ledger line, segmented pill)
  is at 97% and on the tideline in the frame the finger lands, with no transition on the way
  down, and lets go over `--motion-quick`. Transform and background only. The `:active` rule lives
  in the primitives (`buttonClass`, `LedgerRow`, `FilterChips`, `StaffTabBar`, `SegmentedControl`),
  never at a call site.
- **The event table** on the Physics sheet is the contract: what happened, what moves, on which
  rung, on which curve. A new kind of motion takes a row there before it takes a keyframe.
- **H-69 a: the spring.** `--ease-spring` is rationed today to the one menu that unfolds, because
  it claims the thing has weight. Two more places have weight because a finger gave it to them: a
  sheet settling back from a short drag, and a pressed control letting go. **Recommended:** yes,
  those two and no other; declined, both take the arrival curve and nothing else changes.

### 3. A figure rolls, and a row closes its own gap (H-69 c)

- **The roll.** A count that changes in front of a person rolls: only the digits that changed
  move, the old one up and out on the exit curve, the new one in from below on the arrival curve,
  over `--motion-base`; direction follows the sign of the change. One primitive, `RollingFigure`,
  renders a number's digits in clipped slots, takes its previous value from its own last render
  (so a figure that mounts swaps), reserves the widest width for its context so a new digit never
  pushes the word beside it, and exposes the new value alone to assistive technology. Where it
  lands: the counter's instrument line and settled-group count, the station chip's boarding count,
  the palette's answer count, the held send's seconds, the booking form's gear price. Where it
  never lands: a figure's first paint, any figure the page loaded with and nothing changed, money
  on a report, a figure inside a refusal or beside a focused field, a fact of scale, and the head
  count on the roll call and the manifest's dial under every answer to H-69 c.
- **The slide.** When a row leaves, re-enters or changes place, the rows around it slide to where
  they now belong, by transform, over the same `--motion-base` the row took to go, so the gap and
  the row close together. Positions are read before the change and set back after it, and released
  (the segmented control's pill already does this for one element); nothing the browser lays out
  is animated, which is the rule the disclosure and the bar keep. Undo runs the same path reversed.
  Where it lands: the counter queue, the home's station when a blocker clears, the wait list when
  a seat is offered, the board's day when a departure moves.
- **H-69 c: the roll call.** Budget rule 8 bans *drawn* motion on the manifest and the roll call;
  the diver row leaving the roster already moves there (principle 5 names it the one exit doing
  explanatory work), and the rows beneath it jump. Whether the slide may close that gap, after
  the server commit and never before, is the owner's. **Recommended:** the slide yes, after the
  commit; the head count never rolls, whatever is decided. Declined, the roster keeps the jump.

### 4. The sheet follows the thumb

The More sheet and the embed lightbox take a drag under the contract the two shipped gestures share
(unified pointer and touch events, no gesture library, resistance past the edge, a cancel curve
when released short, no interference with a scroll): the sheet tracks the finger one for one
downward, resists upward at the pull-to-refresh's own damping, and the scrim's opacity tracks the
sheet's position; released past 40% of its height or with a downward flick it leaves from where it
is on the exit curve, released short it settles back (on the spring under H-69 a). A drag begins
only on the handle, or when the sheet's own list is at its top and the finger moves down. The
sheet gains a grab handle at rest, the one thing added. The scrim tap and Escape stay, so nothing
a keyboard or switch user does changes; a mouse gets the tap and the button as today. Never the
palette on a desktop, and never a sheet carrying a form mid-fill, which keeps its button. One
hook, `PullToRefresh`'s generalised, holds the numbers for all four gestures.

**Amended 2026-09-11 (#1512): once the sheet's list can scroll, the handle is the only drag
surface.** Measured on the seeded demo shop at 390x844: the sheet's content stands at 730px against
the `max-h-[calc(100dvh-8rem)]` cap of 715, so the list scrolls, and a press on a row produced
exactly one `pointermove` and then nothing — the browser claimed the scroll and the gesture died
mid-flight, leaving the sheet open under a thumb that meant to close it and saying nothing about
why. "A drag begins … when the sheet's own list is at its top" was written about a finger starting
near the sheet's bottom *edge*; on a full sheet that edge is a row, and a list at its top is the
state every sheet opens in. The clause now reads: a drag begins on the handle, or on a sheet whose
list does not scroll at all. The handle's press area grows from the 6px bar to the strip around it,
because the sheet's only dismissal by thumb now depends on hitting it.

Two alternatives were declined. `touch-action: none` on the sheet keeps the browser's hands off the
press, but then the hook drives the list's scrolling itself — a re-implementation of a browser
behaviour, on the surface a crew uses one-handed at the rail, to buy a second way to do what the
handle already does. A non-scrolling drag zone across the sheet's chrome is the handle under
another name and another 40px of sheet. Trimming destinations so the list fits was rejected
outright: the sheet is where a shop's menu *goes* to grow, and the count only rises.

The cost is real, and is why this is written down rather than fixed quietly: a thumb on a row of a
full sheet now does nothing dismissal-wise, and a reader who has not seen this paragraph will read
that as a regression. It is the scrim, Escape, and the handle — three ways out, one of them under
the thumb that opened it.

### 5. The title folds into the bar

On a phone the page title folds into the 56px staff header as the page scrolls, driven by the
scroll position (`animation-timeline: scroll()`, `animation-range: 0 120px`, opacity and translate
only, inside `@supports (animation-timeline: scroll())`): at the top the bar holds the shop's name;
by 120px it reads the page's title at 17/600 and the shop's name has given way, the mark staying
and still opening the shop menu. Two labels cross rather than one heading shrinking, because a 34px
heading scaled to half is a blur on a phone. Every staff page with a page title on a phone takes it;
the public storefront keeps Harbor's header and does not fold. A browser without scroll-driven
animations, a reduced-motion reader and every desktop get the bar as it ships today.

### 6. The departure on the lock screen (H-69 b)

The thread gains one line beside Add to calendar: **Add to Wallet.** The pass wears the shop's
brand (Harbor's derivation, or DiveDay's tokens for a shop that set none), carries what the
thread's top card says (title, date, dock call, departure, boat, meeting place, the diver's name,
the crew-set stage per budget rule 4), is relevant from the morning of so the phone surfaces it
unasked, and updates when the plan moves from the same `trips.revision` the calendar's SEQUENCE
reads. It carries no barcode, no booking id, no price, no waiver or medical state, no emergency
contact, and never the thread's URL: that URL is the diver's own capability and a pass is a thing
that gets shown to people. The counter keeps checking people in by name.

**H-69 b:** whether DiveDay signs passes at all. It needs an Apple Developer Program membership and
a Pass Type ID certificate, an Apple push credential so a pass can be told it changed, and a Google
Wallet issuer account for the Android half: each an account, a yearly fee and a signing secret only
a human can hold. **Recommended:** yes, with the slice filed `waiting-on-external` until the
certificate exists, and nothing built ahead of it. Declined, the thread stays as it ships and the
Pass board renders nothing.

**Decided 2026-09-07: yes** ("we definitely want the wallet pass"), and one step further than the
recommendation: the slice is **built now and ships dark**. With no credential configured the thread
renders as it does today and every pass route answers 404, which is the same escape hatch every
move on this canvas has; the credentials are manual steps in §17's registry and the feature lights
up the day they are pasted in. The signing library is named: `passkit-generator` 3.5.8 (MIT).
Apple's push for passes uses the Pass Type ID certificate itself over HTTP/2, so no separate push
credential is needed; the Google half is signed with `node:crypto`. The full contract — journeys,
the content table, interfaces, routes, configuration, acceptance tests and must-nots — is
[SPEC.md](../../design/canvases/20260907-nothing-from-nowhere/SPEC.md), section 18f.

## What building it settled (2026-09-07)

Slices 18a–18d shipped the same day the canvas was drawn. Three things the boards did not
anticipate, recorded here because the ADR is what code obeys:

1. **The press has two spellings, and they are one behaviour.** The boards drew every tappable
   thing at 97%. Three percent of a 390px row is six pixels of travel on each edge, and a
   full-bleed row that scales reads as the page flinching rather than as the row taking a finger's
   weight. A discrete control scales (`.pressable`); a full-bleed row tints
   (`.pressable-row`). The timing is identical — instant down, `--motion-quick` back up — which is
   what keeps it one press rather than two conventions.
2. **The roll compares a sentence, not a number.** If anything but the digits differs between two
   renders — a plural form flipping, a remainder line rewriting itself — the figure swaps. Rolling
   digits inside a line that rewrote itself claims a continuity that is not there.
3. **The gesture's judgement is pure, and needed a guard.** `dismissOnRelease` is separated from
   the hand that produced its numbers, because a hand's *speed* is the one input a DOM test cannot
   express. Writing it exposed a real failure: a release landing in the same millisecond as the
   last move divides by nothing and reads as a flick, so the sheet leaves from under a hand that
   was putting it back. Below `MIN_VELOCITY_MS` a release is read as a distance.

**18e took the portal, and building it settled four things the drawing left open** (issue #1422).
The title fold needs the page's title inside the shell's bar, and this app renders the bar
(`ShopNav`, in the shop layout) and the title (`ShopPageHeader`, in the page) in two different
trees. The page now delivers it into an `aria-hidden` slot through `createPortal`
(`FoldedPageTitle`), which leaves the layout's shape alone; a title slot on the layout would have
needed a mechanism plus a decision about what a page with no title renders, for a motion slice.

4. **The heading has to get out of the way, and the boards were right to draw it.** The bar is 85%
   of the page behind a blur, so a 34px heading passing under it stays legible *through* it — the
   first build without the fade put the word "Divers" on screen twice, once ghosting through the
   chrome at full size and once as the folded label on top of it. It fades from 40px on, opacity
   only: the page is already carrying it upward, and translating it too would move it at two speeds.
5. **The gate is a slot with something in it, not a slot.** Every staff page renders the bar, but
   the four departure surfaces carry their own `TripPageHeader` and fill nothing. Gating on the
   slot's existence alone would have faded the shop's name away on those and left a bar holding a
   mark and a blank. `:has([data-chrome-title-slot]:not(:empty))` also means there is no flash
   before hydration, when no page has filled it yet.
6. **A bare `scroll()` is not the page.** It binds to the *nearest scrollable ancestor*, which is
   not the same scroller for a label in a sticky header and a heading in the page. Measured on a
   freshly onboarded shop, the unqualified form had the label already 47px wide on arrival — a
   fifth of the way through a fold nobody had scrolled. `scroll(root block)` names the one scroller
   the reader is actually moving.
7. **The reduced-motion kill-switch does not reach a scroll-driven animation.** `globals.css`'s
   universal block overrides `animation-duration`, `-delay` and `-iteration-count`, every one of
   them a statement about *time*, and an animation on a scroll progress timeline takes no progress
   from time. Stilling this one needs a rule that names `animation-timeline`; without it a
   reduced-motion reader keeps the fold, and at a 0.01ms duration it snaps in within the first
   fraction of a pixel of scroll — louder than the motion the setting asked to remove.

## Alternatives considered

- **Motion between pages: a shared-element morph or a cross-fade.** Declined on 2026-08-27 (issue
  #795) for two reasons that both still hold: every route paints its own body-shaped skeleton first,
  so there is nothing for a name to morph into, and React 19.2.8 stable has no `ViewTransition`.
  Nothing in this ADR is between pages; every move is inside a surface that already has its data.
- **A motion library** (a spring physics package, an animation runtime). Rejected as a new runtime
  dependency spent on what CSS transforms, two existing gesture contracts and one FLIP helper
  already do; a spring the browser cannot express as a curve is a spring this design does not need.
- **Springs everywhere.** Rejected: principle 5's line stands, a spring claims weight and is a lie
  about anything that merely appears. H-69 a widens the ration from one use to three, each of them
  a thing a finger held.
- **A count-up on money and on reports.** Rejected: a figure counting up to a value the page loaded
  with is a claim of scale, which the fact-of-scale rule reserves for divers and boats and renders
  once. The roll is for a change that happened in front of the reader.
- **Sound.** Still none; the boat deck is the wrong place to start (ADR 20260904, alternatives).
- **A native app** for the Wallet and the haptics. Rejected: a pass is a signed file any server
  can issue, and the haptic channel's platform hole is documented and stays.
- **A ticket with a barcode.** Rejected: the counter's flow is by name and works; a scannable pass
  either carries the capability URL, which must not be shown around, or a second identifier that
  exists only to be scanned, which is a new table for a flow nobody asked for.

## Consequences

- **Tokens** land in `@theme` beside the curves and `motion-tokens.test.ts` extends; the JS reader
  replaces the three copied numbers and `useExitAnimation` takes a rung. The exit-curve check is
  unchanged.
- **`RollingFigure`** is a `src/components/ui` primitive; a test walks the roll call's and the
  manifest's component trees and fails on any import of it, which is the never-list held by test.
- **The slide** is one hook, `useSettledRows`, used by the lists named in part 3; a test pins that
  it writes only `transform` and never a layout property.
- **The sheet's drag** generalises `PullToRefresh`'s hook into `useDragSheet`, with the threshold,
  the damping and the velocity in one place; `StaffTabBar` and the lightbox read it; a test pins
  that a drag never begins while the sheet's list is scrolled.
- **The title fold** is two keyframes in `globals.css` under `@supports`, a `data-page-title` on
  `ShopPageHeader`, and nothing in JS; the visual spec captures the folded state at 390.
- **The pass** is a new runtime dependency, `passkit-generator` 3.5.8 (with `node-forge`, `joi`,
  `do-not-zip` and `tslib` beneath it), plus the PassKit web service under `/api/wallet/v1/**`, whose
  routes answer only to a pass's own authentication token and carry no shop data beyond the pass;
  the Apple certificate and key and the Google issuer credentials enter `config/env-registry.mjs`
  as `manual` values, and the two accounts enter §17's manual-actions registry. The security
  reviewer reads the slice. *Amended 2026-09-07 on H-69 b:* the slice ships dark rather than
  waiting — a DiveDay with no credentials configured renders the thread as today and 404s every
  pass route — so it lands ahead of the certificate and needs nothing from a human to merge.
- Each slice ends in the standing obligation from
  [design-artifacts.md](../../design/design-artifacts.md): the component names this ADR and a test
  pins the rule. The escape hatch is the same as the last three ADRs': every move renders the cut,
  the swap or the tap the app has today when it is not true, so reversing any one of them is
  deleting a class, not redrawing a surface.
