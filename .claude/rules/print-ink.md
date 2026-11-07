---
paths:
  - "src/app/globals.css"
  - "src/components/paper/**"
  - "**/*Sheet*.tsx"
  - "**/*Paper*.tsx"
  - "**/print/**"
  - "**/*print*"
  - "e2e/print-ink.ts"
---

# Print is ink-light: ink on white, nothing else

A customer pays for every drop. Paper is **black ink on white paper**, and structure comes from type,
space and thin outlines. Status comes from its word (design principle 6), never from a fill or a hue.
This holds for every printed thing, and every printed thing is a sheet: `PaperSheet` behind
`SheetDocument` (packets, the manifest, the departure log, passes, cards, the blank release) or a
page's own sheet (the logbook, the doctor referral, the public trip, course and schedule).

## A screen never prints

No component wears a print face: no `print:` variant, no `@media print` rule for a screen
(`src/app/paper-face.test.ts` fails on one). A page that holds a sheet prints its sheets and nothing
of its screen (`globals.css`); a page with none prints as the browser draws it, and offers no Print.
A surface people print becomes a sheet. A screen that can hold medical words renders
`ScreenNotPrinted`, so Ctrl+P gets one line.

## A violation is any of these on paper

1. **Colour**: coloured text, a coloured border, a coloured SVG fill or stroke, a brand band.
   Grey ink is allowed for text and hairlines; a hue is not.
2. **A filled background**, even pale grey: a tinted row, a status pill's wash, a "well", a sunken
   panel, a zebra stripe, a table-header fill.
3. **White on dark**: light text on any dark ground (a reversed band, an inverted badge or avatar).
4. **A block**: a one-sided or uneven border over a hairline (1px), such as a `border-l-4` row bar or
   a heavy rule. A bar repeated down a list is a strip of solid ink. (A hollow box with the same
   line on all four sides, up to 2px, such as a checkbox or marker ring, is an outline and fine.)
5. **A shadow or ring**: `shadow-*`, `ring-*` (both are `box-shadow`) and text shadows.
6. **`print-color-adjust: exact`** (asks the printer for backgrounds the customer turned off).

## What to draw instead

- A pill or chip becomes **plain text**, or at most a **1px outline**. "Boarded", "Checked in" and
  "Depth advisory" are words; they need no container on paper.
- A row's state is its word. Drop the left bar and the tint.
- A band is **ruled** (a 1px bottom border), not filled; a mark is outlined, not reversed.
- Separate with a 1px rule or space, never a panel.

## What counts as critical

Only information a reader must not lose, and that a word alone could under-state on a wet dock:
**a diver who did not come back, a medical alert or allergy, a blocked boarding**. Critical gets
`data-print-critical` (a 2px black **outline** round the element, never a fill) plus its words and
symbol. Nothing else on paper is heavier than a hairline. If you are unsure whether it is critical,
it is not.

## How it is enforced

- `src/app/globals.css` `.paper-sheet`: inside a sheet, on screen and paper alike, no background,
  shadow or thick edge bar, `print-color-adjust: economy`, and achromatic `--sheet-*` tokens.
  `src/app/paper-face.test.ts` pins the CSS.
- `e2e/print-ink.ts` `assertPrintInk` reads the computed style of every drawn element in print media
  and fails on each violation above. `capturePrint` (`e2e/visual-harness.ts`) runs it, so every
  `e2e/visual-print*.spec.ts` capture is audited, and it refuses a page with no sheet. A new
  printed surface needs a capture.
- A fix is never to widen the audit: change the style so the element prints as ink on white.
