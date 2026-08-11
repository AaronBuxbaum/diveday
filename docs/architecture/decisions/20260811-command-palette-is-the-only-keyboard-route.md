# 20260811-command-palette-is-the-only-keyboard-route — ⌘K is the whole keyboard story

- **Status:** Accepted
- **Date:** 2026-08-11
- **Supersedes the shortcut half of:** [20260803-not-ready-is-a-view](20260803-not-ready-is-a-view.md)
  (which recorded that the by-departure view "keeps `g b`")

## Context

The staff shell carried two keyboard systems. ⌘K opened the command palette — a typed search over
divers, trips, dive sites, courses, orders, and every registry destination under "Go to". Beside it
sat a second one: Gmail-style `g`-then-key sequences (`g t` Today, `g b` the by-departure view,
`g d` Divers, `g s` the board, `g a` Add a booking, `g w` Waivers), plus `?` to open a cheat-sheet
listing them, plus a permanent `?` button in the header to make the cheat-sheet discoverable.

The second system existed to make the app feel fast for a power user. What it actually cost:

- **A header control all day for a control about controls.** The `?` button sat beside Search at
  equal weight, on every staff page, for a sheet whose only content is a list of other ways to do
  things the nav already does. That is the shape [principles.md](../../design/principles.md) #10
  ("remove until it breaks") exists to catch.
- **A second thing to keep in sync.** Every destination could be in the nav, in the palette, and
  in the shortcut sheet, and `src/lib/staff-destinations.ts` exists precisely because those lists
  had drifted before. Two derived consumers is cheaper than three.
- **A global `keydown` listener on every staff page** that had to guess whether a bare letter was
  navigation or typing (`isTypingTarget`), and a 1500ms pending-`g` timer.
- **Six sequences against a nineteen-destination registry.** The shortcut set could never be
  complete, so a staffer who learned the mechanism still had to fall back to ⌘K for most of the
  app — which means ⌘K was always the thing worth learning.

⌘K does everything the sequences did and more: it reaches destinations that never had a letter, it
searches records as well as pages, and it is one idiom rather than a mechanism plus a memorised
alphabet.

## Decision

- **The `g`-sequences and the `?` cheat-sheet are removed**, along with the header's `?` button.
  `src/components/KeyboardShortcuts.tsx` and its e2e spec are deleted.
- **`shortcut` leaves the destination registry**, and `staffShortcutDestinations` with it. The
  registry now has exactly two consumers — the header/dock nav and the command palette.
- **⌘K keeps everything.** No destination loses reach: every `g`-sequence target was already an
  `inPalette: true` row, including `blockers` (the by-departure view), whose registry entry and
  `?view=departures` query are unchanged.
- **The visual baseline `shortcut-sheet` is retired** and the a11y scan that opened the sheet now
  covers the palette alone.

## Alternatives considered

- **Keep the sequences, drop the `?` button and sheet.** Rejected: an undiscoverable shortcut is
  worse than none — it is a keystroke that silently navigates a staffer somewhere they did not ask
  to go, with nothing on screen explaining what happened.
- **Keep the sheet, extend it to all nineteen destinations.** Rejected: it makes the sync problem
  bigger rather than smaller, and nineteen two-key sequences is not a thing anyone memorises.
- **Make ⌘K itself richer instead (recent destinations, fuzzy ranking).** Not rejected — just not
  this change. It is additive to one idiom rather than a second idiom, which is the point.

## Consequences

- One keyboard idiom to teach, and it is the one already on the header button
  (`Search ⌘K`).
- The staff header sheds a permanent control; the row is identity, search, and the tab strip.
- A power user who had learned `g s` loses a keystroke or two: ⌘K then "board" then Enter. That is
  the accepted cost, and it is the same cost as reaching any of the thirteen destinations that
  never had a sequence.
- `docs/product/personas.md`'s point still holds — the app's fast paths stay reachable on a phone,
  where no keyboard exists at all — and is now true without a desktop-only second system.
