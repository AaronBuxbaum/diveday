# FU-20260813-document-segmented-control — Document SegmentedControl in forms-and-controls.md

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/design-segmented-control`, which consolidated four
  hand-rolled segmented navs onto one `src/components/ui/SegmentedControl.tsx`
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `docs/design/forms-and-controls.md`, `src/components/ui/SegmentedControl.tsx`

## What I noticed

`docs/design/forms-and-controls.md` documents every other shared control vocabulary — `Field`/
`FieldGrid`, `buttonClass()`, `FormStatus`, menus — and is the page an agent reads before building
a control. The new `SegmentedControl` (the sunken track with a raised pill, now worn by the trip
tab bar, the waiver tabs, the manifest checkpoint row, and the Today queue's view switch) is not
in it. The next session that needs a segmented choice will find the doc silent and may hand-roll a
fifth variant — the exact drift the component was built to end.

## Why it isn't already done

The consolidation change ran as one of several parallel design sessions with strict path
ownership; `docs/design/` was outside the slice, and editing it risked colliding with a sibling
branch touching the same doc. The component's own docblock carries the full contract in the
meantime.

## Proposed change

Add a short "Segmented choices: `SegmentedControl`" section to
`docs/design/forms-and-controls.md`, alongside the `buttonClass()` section: when to use it (a
small set of sibling **URLs** — tabs between routes or views of one page — never client-only
state), the two shapes (`fill` equal-width tab bar vs. content-width track), `size="boat"` for
rail surfaces, and the current-item rule (inert span for route tabs, `currentIsLink` +
`scroll={false}` for same-page view switches). Point hand-rolled track/pill class strings at the
component the way the doc already points hand-rolled button strings at `buttonClass()`. Not
proposing any code change — the four call sites are already converted.

## Prompt

```text
Read src/components/ui/SegmentedControl.tsx (its docblock states the whole contract) and
docs/design/forms-and-controls.md. Add a concise section to that doc — parallel in tone and depth
to its "Buttons: buttonClass()" section — documenting SegmentedControl: what it is for (a small
set of sibling URL destinations rendered as a sunken track with a raised pill), a short JSX
example, the fill / size="boat" / currentIsLink + scroll={false} options and when each applies,
and the rule that segmented track-and-pill class strings are never hand-rolled at a call site.
The constraint that makes this non-obvious: the doc teaches by contrast (which wrapper for which
job), so the section must also say when NOT to use it — JumpNav (src/components/JumpNav.tsx) is
deliberately a different grammar for same-page anchors and must stay visually distinct. Done when
the section reads consistently with the rest of the doc and `pnpm check` passes (it runs the
doc-link safeguard). Delete docs/product/follow-ups/FU-20260813-document-segmented-control.md as
part of the change.
```
