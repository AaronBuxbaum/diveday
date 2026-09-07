# Nothing from nowhere — six moves that make the interface behave as a thing

- **Status:** Live (its ADR is Proposed, pending H-69; slices 18a–18d shipped 2026-09-07)
- **Date:** 2026-09-07
- **ADR:** [20260907-nothing-from-nowhere](../../../architecture/decisions/20260907-nothing-from-nowhere.md)
- **Published:** https://claude.ai/code/artifact/6015f01a-ae08-4975-a122-bd270198a86b

The eleventh design canvas. The owner's brief on 2026-09-07: another look at the design; clever
decisions that are delightful and elegant; think Apple, in animations and features. The last three
canvases spent their budgets on warmth (Reef), on composition and time (Reef all the way down) and
on the product filling in what it knows (Before you ask). None of them touched how the interface
moves, and the motion rules in principle 5, which are good, were each written the day one thing was
fixed. Read from the running app with the whole tree inventoried: a figure that changes in place
swaps, a row that leaves takes 200ms and the gap beneath it closes in none, the More sheet cannot be
dragged and dismisses at the top of the screen, timing is ten copied numbers in two languages, and a
pressed row does nothing under the finger. This canvas argues one rule, **every change on screen
comes from somewhere, anything a finger is on obeys it within a frame, and one physics governs all
of it**, writes the physics once, and applies it in six moves. **Nothing here is normative**; the
ADR carries the decisions, three of them are the owner's, and code obeys the ADR.

## Artboards

Two pages. The first argues; the second shows.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the four findings, the six moves, the four-part rule with what renders when it fails, the owner's three calls, what already works this way, what is left alone |
| `Physics.dc.html` | The physics sheet: the three-rung ladder and its two ceilings, the three curves drawn with what takes each, every tappable thing at rest and under a finger, the event table the code reads, what never moves, and what the sheet changes in principle 5 |
| `Roll.dc.html` | Move 1 at 56px: the digit's anatomy in three frames, two digits, going backwards, the swap; then the counter's instrument line, the held send's ring and the settled count at the size they ship; what rolls and what never does |
| `Counter.dc.html` | Move 2 at 390 in three frames: Hugo Marsh checks in, his row sinks while the rows beneath slide into its gap and both figures roll; the settled frame with the undo toast |
| `Sheet.dc.html` | Move 3 at 390 in three frames: the More sheet at rest with its handle, held 150px down with the scrim lightened, and let go short of the line settling back |
| `Title.dc.html` | Move 4 at 390 in two frames: the home at scroll 0 and at 232px with the greeting folded into the bar; the fold table over 120px of scroll |
| `Pass.dc.html` | Move 6: the thread with Add to Wallet beside Add to calendar, the pass in the shop's brand as issued and after the plan moved, what it carries and never carries, what it needs and why that is the owner's |

Move 5, the press, has no surface of its own; it is a strip on the Physics sheet, because it lands
on every surface at once. `canvas.json` lays the boards out on two pages and pins five notes.

## The fiction every board holds to

The same one as every canvas since Clearwater. **Blue Mantis Divers**, Key Largo, boats *Mantis II*
and *Skiff*, default crew Keiko Tanaka and Sal Moretti; Dana Reyes owns the desk. The week of
**Thursday, August 27, 2026**, read at three moments:

- **Thursday, 6:40 AM**, the home: the 7:00 Two-Tank Reef, Molasses & French on Mantis II with
  Keiko and Sal, 10 of 12 booked, boarding at 6 of 10; Grace Mensah's Advanced card waiting for
  verification, Priya Sharma's waiver not yet sent, Hugo Marsh not checked in, Ben Okafor's first
  visit, all as the earlier canvases recorded them (`Sheet`, `Title`).
- **Thursday, 6:41 AM**, the counter: 6 of 10 here, 2 to come (Hugo Marsh and Ben Okafor), 2 who
  can't board yet (Grace and Priya). Dana checks Hugo in; the line reads 7 of 10 here, 1 to come
  (`Counter`, `Roll`). Priya's waiver is sent from the station row and held eight seconds (`Roll`,
  from the Before-you-ask canvas).
- **Sunday, August 30**, Yara Halabi's thread for Thursday September 3's 7:00 Two-Tank Reef, dock
  call 6:30, her Advanced card checked August 25, her waiver signed August 27, her own gear, Samir
  Halabi in case; then Thursday September 3 itself, the boat moved to 8:00 on the Tuesday before
  and Boarding tapped at 7:40 (`Pass`).

Every name, number and time is demo-seed fiction. Nothing here is real customer data.

## What every board keeps

Reef's tokens, radii, type ladder and bed; the three moments and the four washes; Geist as the
only face on a staff surface and the shop's own (the demo shop's green and Bricolage Grotesque) on
the diver's; the safety floor (44px targets, 16px critical text, AA, never colour alone); the coral
count of three, spent on no drawn surface (the cover's mark and its three owner-call badges are the
canvas's own chrome, as on every cover since Reef; the coral on the Physics sheet's spring curve and
the sheet board's line and finger ring are the canvas's own marks); and every ban. No board is a
manifest, a roll call, a cert check, a waiver or a payment, and no move reaches one on the ADR
alone: the slide on the roster is H-69 c, and the head count never rolls under any answer. Between
pages there is still no motion (issue #795), and nothing on any board is a page transition.

## Known deviations, on purpose left in

- **The counter board draws the settled group's count rolling.** The settled disclosure is closed
  in every frame, so the count is the only thing in it that changes; drawing it open would add a
  fourth row to explain a figure.
- **The sheet board draws the More sheet's items in two columns.** The shipped sheet is one column;
  two fit the frame at 520px so the drag has room to be seen, and the composition of the sheet is
  not this canvas's business.
- **The Pass board invents Yara's thread copy** ("Your next dive · in 6 days", the two sentences
  under Anything changed?). The thread's real words are the bundle's; the board needed a top card
  for the Wallet line to sit beside.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies, dependencies and the review each
one takes are in the ADR and in [roadmap.md](../../../product/features/roadmap.md) section 18. Each
row ends with the standing obligation: the component that must not drift names this ADR in its doc
comment, and a test pins the rule.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 18a — the physics: the three rungs as theme tokens, `motionMs()` for the ten copied timers, the press on every tappable primitive, principle 5's ladder and event table | shipped | `src/lib/motion.ts` | `src/app/motion-tokens.test.ts` |
| 18b — a figure rolls: `RollingFigure` on the counter's instrument line and settled count and on the held send's seconds; the never-list held by test over the roll call and the manifest | shipped | `src/components/ui/RollingFigure.tsx` | `src/components/ui/RollingFigure.test.tsx`, `src/components/ui/RollingFigure.never-list.test.ts` |
| 18c — a row closes its own gap: `SettledRows` on the counter's working queue and its settled group, Undo reversed (the manifest roster still waits on H-69 c) | shipped | `src/components/SettledRows.tsx` | `src/components/SettledRows.test.tsx` |
| 18d — the sheet follows the thumb: `useDragSheet` on the dock's More sheet, with the grab handle; the scrim tracks the sheet's travel | shipped | `src/components/useDragSheet.ts` | `src/components/useDragSheet.test.tsx` |
| 18e — the title folds into the bar on a phone | open | — | — |
| 18f — the departure on the lock screen: Add to Wallet on the thread, the pass in the shop's brand, updates from `trips.revision`, the two pass-service routes | open | — | — |

**What 18a–18d settled that the drawing left open, and what is still owed:**

- **The press has two spellings, not one.** The boards drew every tappable
  thing at 97%, and a full-bleed row scaling by three percent is six pixels of
  travel on each edge of a phone: the page reads as flinching. A discrete
  control scales (`.pressable`), a row tints (`.pressable-row`), and the timing
  is identical, which is what keeps it one press.
- **The spring on release ships** (H-69 a's recommended answer), on the sheet
  settling back and on a control letting go. It is one token in two rules;
  declining it is changing `--ease-spring` to `--ease-out-soft` there.
- **The roll needs a whole sentence to compare**, not just a number: if
  anything but the digits changed, the figure swaps. The Roll board draws only
  the digits changing, which is the common case and not the only one.
- **18e is open on a finding the boards did not anticipate** (issue #1422). The fold needs
  the page's title inside the shell's bar, and this app renders the bar
  (`ShopNav`, in the shop layout) and the title (`ShopPageHeader`, in the page)
  in two different trees. Every CSS-only shape either covers the shop-identity
  menu with a label that stays clickable underneath, or shrinks the heading —
  which the ADR rules out. It needs a data-flow decision (a title slot on the
  layout, or a portal) that is a change to the shell rather than to motion.
- **18f is unbuilt and unbuildable here**: it waits on H-69 b and on
  credentials a human holds.

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```text
Implement slice 18b of ADR 20260907-nothing-from-nowhere. Read, in this order: the ADR at
docs/architecture/decisions/20260907-nothing-from-nowhere.md (decision 1's four tests and
decision 3), the slice's row in docs/product/features/roadmap.md section 18, the current code the
slice touches (src/app/shop/[shopSlug]/check-in/_components/CounterInstrument.tsx and
CounterQueueRow.tsx, src/components/SendHold.tsx, src/app/globals.css's motion tokens and
docs/design/principles.md section 5), and only then the artboard
docs/design/canvases/20260907-nothing-from-nowhere/Roll.dc.html. The ADR outranks the artboard;
shipped code outranks a drawing for any slice already marked shipped in the README's slice table.
Build RollingFigure as a src/components/ui primitive that renders a number's digits in clipped
slots, animates only the digits that changed by transform and opacity over the base rung on the
arrival and exit curves, takes its previous value from its own last render so a mounting figure
swaps, reserves the widest width for its context, exposes only the new value to assistive
technology, and swaps under prefers-reduced-motion through the existing kill-switch. Wire it into
the counter's instrument line and settled count, the station chip's boarding count, the palette's
answer count, the held send's seconds and the booking form's gear price. Add a test that walks the
roll call's and the manifest's component trees and fails on any import of it. The component names
the ADR in its doc comment. Update the README's slice table row to shipped with the file and the
pinning test, run pnpm check:design-canvases, pnpm test:changed, pnpm lint and pnpm typecheck,
look at the counter in light and dark, and open a pull request explaining any visual diff.
```

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (every artboard on both pages, `canvas.json`, the title
"Nothing from nowhere"), check it, and republish to the URL above. The seeded output is build
output and is never committed ([design-artifacts.md](../../design-artifacts.md)).
