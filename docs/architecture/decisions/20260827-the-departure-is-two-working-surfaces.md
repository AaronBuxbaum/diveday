# 20260827-the-departure-is-two-working-surfaces — Overview folds into Trip, the Manifest becomes a boat instrument, and emergency numbers are buried reference

- **Status:** Accepted
- **Date:** 2026-08-27
- **Design:** [the canvas](../../design/canvases/20260827-the-departure-is-two-working-surfaces/README.md)
  — twelve artboards on two pages: **Surfaces** (Trip and Manifest at desktop and phone, plus the
  design language) and **The boat flow** (a flow map and the day storyboarded in five beats).
  Published at https://claude.ai/code/artifact/17ad2d81-4c8a-45fe-8cf3-c0d972469bd4. Those pictures
  are illustrative and this record is normative — the split, and the conventions the canvas follows,
  are [design/design-artifacts.md](../../design/design-artifacts.md), written with this ADR as the
  first of its kind.

## Context

The four trip surfaces — Overview, Guests, Manifest, Prep — are the deepest pages in the staff app
and two of them are where a shop actually lives. Both had grown by accretion rather than by design,
and the growth is measurable rather than a matter of taste:

- **Guests** renders every diver as a card. On a ten-person boat with three blocked divers, the
  blocked rows expand into ragged stacks of links and headings while the settled rows collapse to a
  quiet line, so the list has two visual grammars at once and the page reads as a pile. Capacity is
  stated three times on one screen (the tab badge, the header pill, the roster heading).
- **Manifest** puts an emergency contact block, a five-item pre-departure checklist, a checkpoint
  strip, a summary panel, a per-row two-button cluster, a buddy-team panel and a three-control
  device-housekeeping card around a head count. On a 390px phone the seeded departure is **5,731px
  tall**, and every diver row carries two disclosure lines plus a button pair.
- Status is carried by emoji (`🌊`, `❌`, `▲`, `🎂`, `🏨`) — which renders differently on every
  platform and cannot be styled, on the one surface read in direct sun.
- **Overview is not a working surface.** It is where a departure is configured — plan, conditions,
  requirements, crew, cadence — read rarely and edited rarer, and it costs a permanent quarter of the
  tab strip on the two surfaces that are worked all day.

Two further facts about the manifest were established with the owner while this design was drawn,
and they are what separate it from a phone-shaped copy of the desk:

1. **It is used on a boat**: one hand, wet fingers, glare, motion, often no signal. Reach and
   mis-tap cost are design inputs, not accessibility footnotes.
2. **DiveDay is not an emergency dispatcher.** No Coast Guard call will ever originate from this
   app. Its emergency role is a *reference card* — DAN, the recompression chamber, the shop's own
   response plan — consulted calmly and **less than once a year**. A real response starts with the
   radio and the O2 kit. Nothing about it is seconds-urgent, and an accidental call is strictly
   worse than a slow one.

## Decision

**A departure has two working surfaces and one configuration panel, and the boat surface is an
instrument rather than a console.**

### 1. Three tabs, not four — Overview folds into Trip

`Trip` (what it is *and* who is coming), `Manifest` (who is aboard), `Prep` (what is loaded).
Everything Overview carried moves into an **About this departure** panel on the Trip page — plan,
conditions, who-can-book, boat and crew, cadence, print packet, cancel — as label/value rows with
inline edits, collapsed to a one-line summary at rest. Configuration lives with the thing it
configures instead of occupying a permanent destination.

The Guests roster becomes the Trip page's body: one ledger, grouped **Still to clear → Ready →
Waiting for a seat**, with the group header carrying the count and the state word. A row at rest is
a **name, at most one exception capsule, and a mark** — no monogram, no per-row certification line,
no filter chips. Open work expands inline: one line per blocker with its one fix beside it.

### 2. The manifest is tiered by when a thing is needed at the rail

- **Always on screen** — names in manifest order, one 56px tap each, the count, who is still to
  call, the checkpoint.
- **One tap away** — a person's sheet (emergency contact, medical, notes, today's audit trail), the
  boat checklist's items, buddy-team editing, the executed-dive record (see below), and — behind a
  `⋯` in the top bar — the emergency numbers, the response plan, and device settings.
- **Ashore, not here** — clearing readiness blockers (the Trip tab), the **departure** log, anything
  that edits the departure.

*Amended 2026-08-27 (issue #1055).* "The dive log" above meant the **departure** log — the evening
write-up at `/shop/[shopSlug]/trips/[id]/log`, owner-only and reached from close-out (ADR 20260812).
It did not mean `ExecutedDiveLog`, which records what actually happened underwater: actual site,
times, depth, conditions. Those are two different documents and the line read as though it covered
both, which left the manifest carrying the largest form in the trip namespace — about a third of a
390px screen — permanently open at every after-dive checkpoint.

The executed-dive record **stays on the boat** and moves to the one-tap tier. The surface interval
is when a divemaster still has the numbers in their head and the shop has no signal; asking them to
write it up ashore is asking them to remember it twice. It now shows one line per dive — "Dive 1 —
not recorded yet", or "Dive 1 — Molasses Reef, 18 m, 8:05 – 8:47" — with the form behind the tap,
the same treatment the boat checklist took in slice 5a. Paper carries that line rather than the
blank form it used to print.

Paper is unaffected: the printed manifest keeps every contact, number and advisory in full. Screens
hide; the sheet that goes ashore never does.

### 3. Consequence decides the gesture

- **Aboard is a plain tap**, on the row's trailing edge — high frequency, reversible by re-tap.
- **Not back is a deliberate two-step**, recorded from the person's own sheet. It is rare, it is the
  highest-consequence claim the app can make, and it must be impossible to brush past with a wet
  thumb.
- **There are no call buttons anywhere on the boat.** Phone numbers render as reference text. This
  is the direct consequence of the context above: a control that can dial by accident buys nothing
  on a path used once a year and costs a false alarm the one time it misfires.

### 4. The screen worries only with reason

A crew starts the after-dive count believing everyone is back, so an **open circle mid-count means
"not yet"** — no red, no warning words, no standing alarm. Red exists on screen only *after* a human
records someone not back; that is when the alarm pins, the split buddy team is named, and the row
sorts to the top. When they surface, a re-tap returns the screen to calm.

This is the one genuinely new rule, and it generalises: **an alarm is earned by a recorded fact, not
by the absence of one.** A surface that shouts about a state nobody has asserted teaches its readers
to ignore it.

### 5. Status is drawn, never typed as emoji

Every mark is inline SVG on the 16/20/24px grid, and every colour-carried state also carries a word
(ashore is an amber minus *and* "Ashore since the dock"; not-back is a red cross *and* the words).
The existing token palette is unchanged — boat mode's contrast-boosted ink still governs the
manifest.

## Alternatives considered

**Polish the four tabs in place.** Rejected as the round that produced the current state. The
tab strip is not the cost; the cost is that a departure's *configuration* holds a permanent seat
beside its two working surfaces, which no amount of restyling repairs.

**A prominent SOS control.** Built, reviewed, and deleted — twice. First as a filled red pill pinned
bottom-right, then demoted to a hold-to-fire pill parked bottom-left away from a right thumb. Both
were still wrong for the same reason: they design for an emergency dispatcher this app is not, and
they spend permanent screen weight and permanent mis-tap risk on a path used less than once a year.
The surviving shape is a `⋯` menu and reference text. Recorded here because the wrong version is
plausible enough that someone will propose it again.

**A per-row "Not back" button beside every open circle.** Rejected: it renders the alarm vocabulary
during the ordinary case, which is the failure mode decision 4 exists to prevent.

**Monogram avatars on each row.** Rejected under principle 9 — DiveDay holds no photos, so a circle
can only carry initials of the name printed beside it, which is one fact rendered twice.

**A separate emergency screen.** Rejected: it would be a fourth destination for the least-used
content in the product, and the `⋯` menu reaches it in the same two seconds without the tab.

## Consequences

- The trip layout drops from four tabs to three, `TripSubNav` loses a destination, and
  `/shop/[shopSlug]/trips/[id]` (Overview) becomes the Trip page with the roster as its body. The
  old Overview route redirects rather than 404s.
- **Two open questions are deliberately not settled here.** Folding Overview into Trip brushes the
  one-home-per-action rule that gave each trip action a single destination, and whether boat mode
  should hide the phone dock entirely is untested with a real crew. Both want an owner call and a
  `dive-domain-expert` review before the surfaces they affect are built; neither blocks the ledger
  and roll-call work, which is why this ADR is **Proposed** rather than Accepted.
- Decisions 3, 4 and 5 are safety-surface behaviour and get the `dive-domain-expert` and
  `security-reviewer` treatment the hard rules already require of manifests and roll call.
- When a slice ships, its constraint moves next to the code that must not drift from it, per the
  rule [design/surfaces.md](../../design/surfaces.md) already sets — an entry in a document is an
  index, a doc comment and a test are what stop it rotting. The specific obligations are listed on
  each roadmap slice in
  [product/features/roadmap.md](../../product/features/roadmap.md#5-the-departures-two-working-surfaces-design-complete);
  in short: `RollCallControls` defers to decision 3 by name and a test fails if the not-back path
  becomes a single tap; the manifest page defers to decision 4 and a test fails if any danger-toned
  element renders at a checkpoint with no recorded exception; `check:repo`'s existing tinted-ink and
  logical-property gates already cover decision 5's mechanics.
- Once built, decisions 2–4 graduate from this record into
  [design/principles.md](../../design/principles.md) as rules that apply to any future boat-worked
  surface. Until then they are a proposal with a picture, and principles.md stays the register of
  what the app already does.
