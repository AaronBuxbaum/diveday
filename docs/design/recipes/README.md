# Executable UI compositions

These recipes run the existing production primitive examples and assertions. The index points at live code and tests, rather than copied markup or a separate design authority. Read one entry, run its command, then adapt its composition. ADRs and shipped behavior remain authoritative.

`node scripts/visual-recipes.mjs row-actions --plan` prints the example paths, intended behavior, rendered states to check, and the exact test command. Remove `--plan` to run it. Available recipes: `row-actions`, `feedback`, `forms`, `settings`, `handoff`.

| Recipe | What its executable example establishes |
| --- | --- |
| row-actions | RowMenu opens without expanding the row and closes with focus returned; phone edge behavior is exercised. |
| feedback | UndoToast retains the reversible saved outcome and dismisses on request; ordinary success belongs in temporary Toast. |
| forms | Field connects label, hint and error to the actual input. |
| settings | SettingsRail selects the current editor and keeps that row in its own scroll box. |
| handoff | A saved help request survives a database read and only permits the supported transition. The approved helper-assignment redesign is separate work in issue #2851. |

These are runnable behavior compositions, not screenshot approvals. For a visual change use `node scripts/visual-review.mjs --grep '<test title>' --route '<route template>' --role owner --fixture '<fixture>' --state '<changed state>' --expect '<CSS selector for the changed content>'`. The command photographs light phone/desktop states, runs the existing pixel probe, and writes a unique manifest that remains `not-reviewed` until someone inspects the images. Add `--color` for color work; `--plan` needs no build. Never use a generic page shell as the changed-content selector.

The index lists additional state coverage needed for each composition, including narrow widths, long translated labels, pending, focus, and refusal. It deliberately does not claim that DOM tests or a default route photograph cover all of them.
