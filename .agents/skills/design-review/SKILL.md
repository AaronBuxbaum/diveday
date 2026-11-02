---
name: design-review
description: Review UI against the delight-first design principles using screenshots. Use after building or changing any user-facing surface, before marking it done.
---

# Design review

Delight is this product's differentiator — this review is where that stops being a slogan. The
bar is Apple-grade clarity: content leads, chrome defers, and the user never hunts for an answer
or an action the screen could have carried.

**One scheme: light, unless the work is about colour.** Every check below — capture, probe, tiles,
checklist — runs in light only. Dark joins it only when the change is colour work: a token, a tint,
a hue, a raw colour a component was drawing. That is the owner's rule for every check in this repo
([H-20260925-many-colour-schemes-check](../../../docs/product/human-decisions/README.md#decision-register)), not a shortcut this skill
takes; CI's visual run still captures both schemes.

## Procedure

Each step's commands and reasoning: [procedure.md](procedure.md). Read it before your first run.

0. **Top-down review only**: `node scripts/contact-sheet.mjs` against `pnpm dev`; read
   `screenshots/contact-sheet.jpg` for inconsistency between surfaces first.
1. Read `docs/design/principles.md` (principles and checklist) and `docs/design/pixel-craft.md`.
2. Read `docs/design/settled-questions.md`; **add to it** whatever this sweep finds looks wrong and
   is right.
3. Capture each changed state with `node scripts/visual-review.mjs --grep '<test title>' --route '<route template>' --role owner --fixture '<seed>' --state '<changed state>' --expect '<CSS selector proving changed content>'` after `pnpm e2e:build`; `--color` opts in to dark. Inspect its private images and probe report listed in `.agent-out/visual-review/`. A dev `scripts/screenshot.mjs` capture can provide an early look, then add a production state capture.
4. **Holistic pass** from `docs/design/principles.md`, answered in writing in
   `docs/design/surfaces.md`.
5. **Pixel pass before reading the source**: `PIXEL_PROBE=1` on the capture,
   `node scripts/pixel-probe-report.mjs` (each flag **confirmed** or **dismissed**), `--tiles` to
   judge geometry 1:1, `--atlas` for control states. Write down what was drawn first.
6. **Read each tile** against the checklist: phone thumb reach, loading/empty/error states, dark
   mode only for colour work.
7. Alignment where captions wrap: one control baseline per row, labels centered in targets.
8. Count rendered controls per section: at most one primary, no more than two or three competing;
   first ask whether a control can dissolve (principle 10).
9. Grep the diff for raw hex and palette-scale classes (ADR-0004).
10. Grep the diff for implementation jargon in user-facing strings (principles §4).
11. Significant surface: launch `design-critic` with the screenshots and the pixel-probe report.

**Print/PDF changes:** follow [print review](../e2e-and-visual/print.md) and give the critic
rendered, paginated sheets. A continuous print screenshot cannot show pagination defects.

## Output

A findings list ordered by severity: what fails which principle, where (file:line or
screenshot), and the concrete fix — with the pixel pass's verdicts beside it, one per flag.
Fix findings before marking the work done; note any you deliberately defer and why. A geometry
fix is proven by its capture's PNG, not by a class assertion in a unit test. Attach the
screenshots when reporting to the user.
