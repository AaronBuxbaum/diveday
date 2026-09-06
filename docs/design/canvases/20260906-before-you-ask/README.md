# Before you ask — six moves where DiveDay fills in what it already knows

- **Status:** Live (its ADR is Proposed; three decisions wait on H-68)
- **Date:** 2026-09-06
- **ADR:** [20260906-before-you-ask](../../../architecture/decisions/20260906-before-you-ask.md)
- **Published:** https://claude.ai/code/artifact/b74389e3-06d8-42f4-aed8-2cf90b9be3c7

The tenth design canvas. The owner's brief on 2026-09-06: another look at the design; clever
decisions that are delightful and elegant; the product reads as too minimalistic; think of the
feeling that things work on their own. The last three canvases spent their budgets on warmth
(Reef), on composition (every surface rebuilt to the drawing) and on time (the budget widened
along one axis). What none of them touched is the product's habit of keeping its knowledge to
itself: it holds a diver's card, sizes and waiver and asks her to type them again; it has run the
same Saturday boat for two years and opens a blank form; it asks "are you sure?" where it could
let a person take the thing back. This canvas argues one rule, **DiveDay fills in what it already
knows, shows where it got it, and leaves the last tap to a person**, and draws it six times on the
surfaces where a shop still types what the software knows. **Nothing here is normative**; the ADR
carries the decisions, three of them are the owner's, and code obeys the ADR.

## Artboards

Two pages. The first argues; the second shows.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the three findings, the six moves, the four-part rule with what renders when it fails, the owner's three calls, what already works this way, what is left alone |
| `SendHold.dc.html` | Move 3 in frames: the waiver row before the tap, the eight seconds with Undo where Send was, the settled row, and the undone row; the four sends that take the hold and the three acts that keep a question |
| `Fields.dc.html` | Move 5 as a specimen: seven things a person types beside what the field shows and where it lands, the four kinds of field that never guess, and the three tests a forgiving field passes |
| `KnownDiver.dc.html` | Move 1 at 390: the booking page reached from Yara Halabi's own recap link, with the card, the waiver, her gear and her emergency contact already with the shop, each naming the day it was kept, and one button |
| `AddDeparture.dc.html` | Move 2 at 1180: the schedule board's add panel opened on an empty Saturday, filled from what the shop ran on the last six, one sentence saying so, every value a field, the pattern's second boat offered as one row |
| `Resume.dc.html` | Move 4 at 390: the add-booking form on a phone with the desk's draft already applied and one line offering the way back, and the one row the home carries while a draft exists |
| `Palette.dc.html` | Move 6 at 1180: ⌘K over the home answering "gra" with Grace's fact and her fix, and "sat" with Saturday's board and its count; the doors that ship today beneath each |

`canvas.json` lays the boards out on two pages and pins five notes.

## The fiction every board holds to

The same one as every canvas since Clearwater. **Blue Mantis Divers**, Key Largo, ★4.3 across 83
reviews, boats *Mantis II* and *Skiff*, default crew Keiko Tanaka and Sal Moretti; Dana Reyes owns
the desk. The week of **Thursday, August 27, 2026**, read at four moments:

- **Thursday, 6:14 AM**, the 7:00 Two-Tank Reef boarding: Priya Sharma's waiver is sent from the
  station row and held eight seconds (`SendHold`); Grace Mensah's Advanced card waits for
  verification, added Wednesday by Grace, sizes BCD M · wetsuit ML long · fins 38, second visit
  (`Palette`), all as the people canvas recorded them.
- **Thursday, 6:02 and 6:31 AM**: Dana starts adding Emmet O'Brien and one more to Friday
  September 4's 7:00 (9 of 12 booked; 11 after this) at the desk, is interrupted, and picks it up on
  her phone (`Resume`).
- **Thursday evening**: Dana adds Saturday September 5 to the board. The six Saturdays before it (July 18 to August 22) ran the
  7:00 Two-Tank Reef — Molasses & French on Mantis II with Keiko and Sal, 12 seats at $95; four of
  them also ran the 1:00 Wreck Trip (`AddDeparture`). Saturday August 29 holds the one departure the
  diver's-thread canvas filled, the 11:00 Two-Tank — French Reef, sold out with two waiting
  (`Palette`).
- **Sunday, August 30**: Yara Halabi opens her Saturday recap's next dive, Thursday September 3's
  7:00 Two-Tank Reef ($95, 4 seats left, "another easygoing reef day"). Her Advanced card was
  checked by the shop on August 25, her waiver signed August 27 against release v4 still stands, she
  dives her own gear, and Samir Halabi is her emergency contact (`KnownDiver`).

Emmet O'Brien is the diver the people canvas recorded asking for September 4–5; his email and
Samir Halabi's phone number are invented here. Every name, number and time is demo-seed fiction.
Nothing here is real customer data.

## What every board keeps

Reef's tokens, radii, type ladder and bed; the three moments and the four washes; Geist as the
only face on a staff surface and the shop's own on the diver's; the safety floor (44px targets,
16px critical text, AA, never colour alone); the coral count of three, spent on no drawn surface
(the cover's mark and its three owner-call badges are the canvas's own chrome, as on every cover since
Reef); and every ban. The stroke icons on the boards (the `.hand` class) are the app's icon style, not
the illustration set: no creature, water motif or boat appears on any board here. No board is a manifest, a roll call, a cert check, a waiver or a payment,
and no move reaches one: a card is never verified by DiveDay, a head count is never inferred, a
medical answer is never carried forward.

## Known deviations, on purpose left in

- **`KnownDiver` writes "Checked by the shop, Aug 25"** for a card the thread canvas only called
  verified. The date is the point of the line (rule 1: a filled value names its source), so one is
  invented rather than the line dropped.
- **`AddDeparture` fills the crew field.** That is the owner's call (H-68 c); the board draws the
  recommended answer so the alternative, the field empty under the same sentence, needs no second
  board.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies, dependencies and the review
each one takes are in the ADR and in
[roadmap.md](../../../product/features/roadmap.md#17-before-you-ask-design-complete-h-68-ready).
Each row ends with the standing obligation: the component that must not drift names this ADR in
its doc comment, and a test pins the rule.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 17a — a send you can take back: the eight-second server-side hold with Undo on the four sends, the confirm dialogs removed (H-68 a) | open | — | — |
| 17b — nothing you typed is lost: per-person form drafts kept a day, the "picked up from" line, the home's one row while a draft exists | open | — | — |
| 17c — type it any way: the pure parsers for time, date, phone, name, money, and the picker match, with the typed text shown beneath and the never-list held by test | open | — | — |
| 17d — the add panel already knows the weekday: the pattern read over the shop's own departures, the one sentence, the second boat as a row (crew per H-68 c) | open | — | — |
| 17e — the door remembers who opened it: a booking reached from a diver's own link arrives with the standing facts folded, each naming its date, and one button (the cold-email link per H-68 b) | open | — | — |
| 17f — ask it, and it answers: the palette's answer card for a diver, a day or a departure, its primary act read from the same fix table as the home's rows | open | — | — |

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```text
Implement slice 17c of ADR 20260906-before-you-ask. Read, in this order: the ADR at
docs/architecture/decisions/20260906-before-you-ask.md (decision 3 and the "never" list), the
slice's row in docs/product/features/roadmap.md section 17, the current code the slice touches
(src/components/ui/form.tsx and the add panel's time and date fields in
src/app/shop/[shopSlug]/schedule/board/_components/ScheduleBuilder.tsx), and only then the
artboard docs/design/canvases/20260906-before-you-ask/Fields.dc.html. The ADR outranks the
artboard; shipped code outranks a drawing for any slice already marked shipped in the README's
slice table. Build the parsers as pure functions under src/lib with a table test per specimen row
in both locales, wire them into the named fields with the typed text shown beneath the result
while the field has focus, and add a test that fails if any parser is ever attached to a field on
the never-list (card details, head counts, tank pressure, nitrox mix, depth, medical answers,
emergency-contact name). The component that must not drift names the ADR in its doc comment.
Update the README's slice table row to shipped with the file and the pinning test, run
pnpm check:design-canvases, pnpm test:changed, pnpm lint and pnpm typecheck, look at the fields
in light and dark, and open a pull request explaining any visual diff.
```

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (every artboard on both pages, `canvas.json`, the title
"Before you ask"), check it, and republish to the URL above. The seeded output is build output and
is never committed ([design-artifacts.md](../../design-artifacts.md)).
