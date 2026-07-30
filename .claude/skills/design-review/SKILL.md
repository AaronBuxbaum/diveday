---
name: design-review
description: Review UI against the delight-first design principles using screenshots. Use after building or changing any user-facing surface, before marking it done.
---

# Design review

Delight is this product's differentiator — this review is where that stops being a slogan.

## Procedure

1. Read `docs/design/principles.md` (the principles **and** the checklist).
2. Capture every changed route. The visual spec asserts nothing — it writes PNGs — so a filtered
   run of it is the fastest way to get review images:
   ```bash
   pnpm e2e:build && npx playwright test e2e/visual.spec.ts -g 'about page'
   ```
   Inspect the PNGs it wrote under `e2e/screenshots/` (gitignored) — every capture is written at
   both the phone and desktop widths in `VIEWPORTS`. A surface with no capture group yet needs one
   adding (see `e2e-and-visual`) before it can be reviewed this way.
3. **Read each PNG** and evaluate against the checklist. Look hardest at:
   - dark mode (the usual casualty — contrast, borders, raw colors that ignored tokens)
   - the phone viewport at realistic thumb reach (dock test)
   - loading/empty/error states — navigate to them, don't assume
4. Check alignment at a width where captions wrap — the two failures that screenshots make obvious
   and diffs hide (see `docs/design/forms-and-controls.md`): fields in a row share one control
   baseline, and every button-shaped thing has its label centered in its target. Both come free
   from `<Field>`/`<FieldGrid>` and `buttonClass()`; a surface that fails one is usually a surface
   that hand-rolled the classes.
5. Count the controls that actually render together in a given state (principle 8 — fewer
   controls, one obvious action) — from the screenshot or the rendered branch, not a source-level
   grep of `buttonClass()` call sites: mutually exclusive branches (a ternary showing one button
   or the other depending on state) don't stack into two, and a single call site mapped over a
   list can render many. Per independent section — not summed across the whole view, a settings
   page with five unrelated sections can have five primaries — more than one rendered
   primary-weight control (no explicit `variant`, an explicit `variant: "primary"`, or `variant:
   "danger-solid"` — a solid destructive action still claims the section's one primary slot) is a
   finding: demote the extras to `secondary`/`ghost`/`link`/`danger`, merge buttons that are really one
   action with a default, or move a rare action behind disclosure. Separately — having at most one
   primary is not sufficient on its own; a read-only section or a chooser of peer secondary
   actions needs no primary at all — more than two or three controls of any weight competing for
   attention in one section is also a finding on its own; the fix is the same set of moves. See
   [forms-and-controls.md § Action rows](../../../docs/design/forms-and-controls.md#action-rows-one-primary-not-many).
6. Grep the changed files for token violations:
   ```bash
   git diff main --unified=0 | grep -nE '#[0-9a-fA-F]{3,8}|-(red|blue|cyan|teal|zinc|gray|slate|orange|amber)-[0-9]'
   ```
   Raw hex or palette-scale classes in components are findings (ADR-0004).
7. Grep the changed files for implementation jargon leaking into user-facing strings
   (principles §4 — "never surface the implementation"):
   ```bash
   git diff main --unified=0 -- 'src/app' 'src/components' 'src/lib' \
     | grep -inE 'encrypt|decrypt|snapshot|sync(ing|ed)?\b|reconcil|fail[- ]closed|multi-tenant|tenant|token|cache|envelope|payload'
   ```
   Hits inside JSX text, string literals shown to users, or `aria-` labels are findings; hits in
   identifiers, imports, or comments are fine. The fix is the human translation ("saved on this
   phone", "DiveDay double-checks it when you're back in service"), never a vaguer claim.
8. For a second, unbiased pass on significant surfaces, launch the `design-critic` agent with
   the screenshot paths.

## Output

A findings list ordered by severity: what fails which principle, where (file:line or
screenshot), and the concrete fix. Fix findings before marking the work done; note any you
deliberately defer and why. Attach the screenshots when reporting to the user.
