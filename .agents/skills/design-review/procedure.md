# Design review: the procedure, in full

Part of the **design-review** skill ([SKILL.md](SKILL.md)). The SKILL.md procedure is the checklist; this is each step with its commands, flags and reasoning. Read the step here before running it the first time in a session.

## Procedure

0. **For a top-down review, start with the contact sheet.** Against a running `pnpm dev`,
   `node scripts/contact-sheet.mjs` photographs every route the demo shop has at phone width and
   tiles them into `screenshots/contact-sheet.jpg`, naming the routes it could not reach. Read it
   for inconsistency between surfaces before reviewing any one of them. A review of one change
   skips this step.
1. Read `docs/design/principles.md` (the principles **and** the checklist), and
   [`docs/design/pixel-craft.md`](../../../docs/design/pixel-craft.md) — the rubric the pixel pass
   (step 5) grades against.
2. Read [`docs/design/settled-questions.md`](../../../docs/design/settled-questions.md) — the
   register of things that look like a defect and are right, each pointing at the file whose
   comment carries the reasoning. It exists because every sweep re-derived the same dozen false
   positives before it did, and two of its rows are issues that were drafted and then killed by
   measuring. Reading it first is the cheapest part of this review. **Add to it** whenever this
   sweep investigates something that looks wrong and turns out not to be — that is part of the
   sweep, not a follow-up.
3. Capture changed states in light with `node scripts/visual-review.mjs --grep '<test title>' --route '<route template>' --role owner --fixture '<seed>' --state '<changed state>' --expect '<CSS selector proving changed content>'` after `pnpm e2e:build`. The command checks the build fingerprint, asserts the expected visible content, and runs the pixel probe in a private run folder. Reuse the build after spec-only edits; application/configuration edits require rebuilding. Add `--color` for colour work. A first dev look may use `node scripts/screenshot.mjs <path>`, but verification needs the production state capture.

4. **Holistic pass** — before the checklist, run "The holistic pass" from
   `docs/design/principles.md` for each captured surface, answering its questions in writing
   (the one idea, the arriving question, dissolvable controls, remove-until-it-breaks, and — for
   a new significant surface — the composition sketch). The canonical question list lives there,
   not here, so it can't drift between this skill and the `design-critic` agent.

   **"In writing" means [`docs/design/surfaces.md`](../../../docs/design/surfaces.md)** — read the
   surface's entry first (it may already answer the pass, and disagreeing with a recorded answer is
   a finding worth stating), and add or amend the entry when the surface is a significant one. Where
   an answer constrains code, say so in a comment beside that code and pin it with a test: that is
   why the shop home's one idea is the only one that survived the session that wrote it.
5. **Pixel pass — measure what was drawn, before you open the source.**
   - The scoped review command already probes light captures. For additional exploratory captures, probe the changed capture groups:
     `PIXEL_PROBE=1 pnpm e2e:run e2e/visual --grep '<test title>' --reporter=line`. For a
     surface with no capture, `node scripts/screenshot.mjs <path> --probe` against `pnpm dev` —
     two or three paths per run, because a dev server dies at about thirty renders.
   - For a scoped run, set `VISUAL_PROBE_DIR` to its manifest's probe directory on the report, tiles and atlas commands below so unrelated runs cannot mix. `node scripts/pixel-probe-report.mjs` writes `e2e/pixel-probe/REPORT.md`. A flag is a
     candidate, not a verdict: read its crop under `e2e/pixel-probe/crops/` and give it one —
     **confirmed**, with its measurement, or **dismissed**, with its reason. A flag that is right
     as drawn goes in `scripts/pixel-probe-settled.json` and gets a row in settled-questions.md,
     so the next report lists it as settled rather than raising it again.
   - `node scripts/pixel-probe-report.mjs --tiles <capture>` cuts a spec capture into 1:1 tiles
     under `e2e/pixel-probe/tiles/`. Judge geometry from those — never from a whole-page PNG, which
     the viewer scales until a 4px offset disappears.
   - `node scripts/pixel-probe-report.mjs --atlas` builds the state atlas's contact sheets. Read
     the rest, hover and focus crops of every control you touched side by side; its entries are
     the ones `grep -l '<a class it wears>' e2e/pixel-probe/atlas/runs/<run-id>/*.json` names.
     `ATLAS.md` names the run; older runs are separate and do not fill its gaps.

   Write down what is in the pixels — each measurement, each oddity — **before** reading the
   component code: read the code first and you see what was meant instead of what was drawn.
6. **Read each tile** and evaluate against the checklist. Look hardest at:
   - the phone viewport at realistic thumb reach (dock test)
   - loading/empty/error states — navigate to them, don't assume
   - dark mode, when the change is colour work — there it is the usual casualty (contrast,
     borders, raw colors that ignored tokens)
7. Check alignment at a width where captions wrap — the two failures that screenshots make obvious
   and diffs hide (see `docs/design/forms-and-controls.md`): fields in a row share one control
   baseline, and every button-shaped thing has its label centered in its target. Both come free
   from `<Field>`/`<FieldGrid>` and `buttonClass()`; a surface that fails one is usually a surface
   that hand-rolled the classes.
8. Count the controls that actually render together in a given state (principle 8 — fewer
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
   attention in one section is also a finding on its own; the fix is the same set of moves.
   Before reaching for a demotion, ask principle 10's stronger question first: can the control
   dissolve entirely — into the object it acts on, an in-place edit, or a good default? The
   best button count is the one where nothing had to be demoted because nothing was stacked. See
   [forms-and-controls.md § Action rows](../../../docs/design/forms-and-controls.md#action-rows-one-primary-not-many).
9. Grep the changed files for token violations:
   ```bash
   git diff main --unified=0 | grep -nE '#[0-9a-fA-F]{3,8}|-(red|blue|cyan|teal|zinc|gray|slate|orange|amber)-[0-9]'
   ```
   Raw hex or palette-scale classes in components are findings (ADR-0004).
10. Grep the changed files for implementation jargon leaking into user-facing strings
    (principles §4 — "never surface the implementation"):
    ```bash
    git diff main --unified=0 -- 'src/app' 'src/components' 'src/lib' \
      | grep -inE 'encrypt|decrypt|snapshot|sync(ing|ed)?\b|reconcil|fail[- ]closed|multi-tenant|tenant|token|cache|envelope|payload'
    ```
    Hits inside JSX text, string literals shown to users, or `aria-` labels are findings; hits in
    identifiers, imports, or comments are fine. The fix is the human translation ("saved on this
    phone", "DiveDay double-checks it when you're back in service"), never a vaguer claim.
11. For a second, unbiased pass on significant surfaces, launch the `design-critic` agent with
    the screenshot paths, and `e2e/pixel-probe/REPORT.md` with the tile paths once the pixel pass
    has run. It opens with the same holistic questions — expect it to challenge the composition,
    not just the checklist.
