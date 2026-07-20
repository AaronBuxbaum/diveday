---
name: design-review
description: Review UI against the delight-first design principles using screenshots. Use after building or changing any user-facing surface, before marking it done.
---

# Design review

Delight is this product's differentiator — this review is where that stops being a slogan.

## Procedure

1. Read `docs/design/principles.md` (the principles **and** the checklist).
2. Start the app (`pnpm dev` in background) and capture every changed route:
   ```bash
   node scripts/screenshot.mjs /route-a /route-b
   ```
   This produces light/dark × desktop/phone PNGs in `.screenshots/`.
3. **Read each PNG** and evaluate against the checklist. Look hardest at:
   - dark mode (the usual casualty — contrast, borders, raw colors that ignored tokens)
   - the phone viewport at realistic thumb reach (dock test)
   - loading/empty/error states — navigate to them, don't assume
4. Check alignment at a width where captions wrap — the two failures that screenshots make obvious
   and diffs hide (see `docs/design/forms-and-controls.md`): fields in a row share one control
   baseline, and every button-shaped thing has its label centered in its target. Both come free
   from `<Field>`/`<FieldGrid>` and `buttonClass()`; a surface that fails one is usually a surface
   that hand-rolled the classes.
5. Grep the changed files for token violations:
   ```bash
   git diff main --unified=0 | grep -nE '#[0-9a-fA-F]{3,8}|-(red|blue|cyan|teal|zinc|gray|slate|orange|amber)-[0-9]'
   ```
   Raw hex or palette-scale classes in components are findings (ADR-0004).
6. For a second, unbiased pass on significant surfaces, launch the `design-critic` agent with
   the screenshot paths.

## Output

A findings list ordered by severity: what fails which principle, where (file:line or
screenshot), and the concrete fix. Fix findings before marking the work done; note any you
deliberately defer and why. Attach the screenshots when reporting to the user.
