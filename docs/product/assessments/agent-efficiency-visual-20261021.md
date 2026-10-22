# Visual feature delivery and agent efficiency audit

Date: 2026-10-21. Scope: repository evidence, inspected read-only apart from this report.
No application runtime, screenshots, or CI runs were executed for this audit. Historical timing and
incidents below are attributed to checked-in evidence, not remeasured. Recommendations are audit
proposals; no product decisions or implementation changes were made.

## Assessment

DiveDay does not lack design standards, a design reviewer, visual tests, or a screenshot tool.
It has unusually substantial versions of all four. The highest-value improvement is making the
right small subset arrive at the moment an agent chooses a component, builds a state, or verifies
an edit. Several entry points currently give incompatible or stale procedures. Broad reading
requirements and a large shared visual test file compound this problem.

The likely loop is: agent reads general principles, implements a plausible composition, runs cheap
checks, then learns from expensive browser/CI/review feedback that it chose the wrong primitive,
missed the meaningful state, or followed obsolete validation guidance. That causal account is an
inference from the wiring below; this audit does not quantify session tokens or attribute each CI
failure to visual work.

## Existing assets to retain

- `design-implementation` already establishes ADR > shipped code > unbuilt canvas, expires canvas
  authority per slice, and requires a behavioral invariant test and closure of the slice table
  (`.agents/skills/design-implementation/SKILL.md:17-77`). Do not invent another canvas authority
  policy.
- `new-feature` already requires the screen's one idea, arriving questions, and two compositions
  before writing UI (`.agents/skills/new-feature/SKILL.md:21-31`). The gap is execution and retrieval,
  not missing advice to think about design.
- `design-review` has holistic review, phone captures, 1:1 tiles, a control-state atlas, a pixel
  probe, and a mandatory independent critic for significant work
  (`.agents/skills/design-review/SKILL.md:17-45`).
- The critic requires a violated rule, a reproducible failing state, and confirmed versus possible
  labels (`.claude/agents/design-critic.md:62-79`). This is a good defense against taste-only churn.
- `settled-questions.md` is already a deliberate non-finding register, pointing to code/ADRs rather
  than becoming another source of truth (`docs/design/settled-questions.md:1-36`). Its examples
  explicitly describe reviews repeating false positives and issues killed by measurement.
- The primitive system is extensive: fields, cards, ledger/table rows, controls, confirmations,
  sheets, status marks, menus, `Toast`, and `UndoToast`. Form feedback already documents ephemeral
  success versus persistent actionable errors (`docs/design/forms-and-controls.md:353-460`).
- Route coverage is derived, with explicit exceptions, rather than maintained entirely by hand
  (`scripts/check-route-coverage.mjs:34-59`). Preserve that reduction in coordination cost.
- Visual selection already follows changed symbols, locale keys, assets, routes, and helper calls;
  PR captures are narrowed while main captures a complete baseline
  (`scripts/visual-affected.mjs:1-60`). Historical comments record 47% of job-minutes in captures,
  and a later review finding 26 of 28 product PRs still selected all. Those are historical,
  not current benchmark results.
- The visual suite already split touring tests into one surface per test to avoid serial discovery
  of failures (`e2e/visual.spec.ts:109-138`). Splitting the file should preserve that behavior.

## Findings and opportunities

### V1. Conflicting visual instructions consume time before product work starts

**Priority: P0. Confidence: high.**

Concrete conflicts:

1. `new-feature` step 10 says a serialized visual job commits regenerated baselines onto the PR and
   instructs the agent to watch for a follow-up visual-only check
   (`.agents/skills/new-feature/SKILL.md:51-56`). Current CI publishes S3 comparisons, emits a sticky
   summary, and explicitly says visual differences warn rather than fail
   (`.github/workflows/ci.yml:978-1035`, `1129-1141`). Following the skill can mean waiting for an
   event this pipeline does not produce.
2. `task:context design` lists entire `src/app`, `src/components`, and `e2e` as its code/test context,
   prescribes `pnpm visual`, and says inspect dark desktop unconditionally
   (`scripts/task-context-data.mjs:276-300`). The design-review entry point says light only unless
   changing color (`.agents/skills/design-review/SKILL.md:10-14`), and visual-triage explains why a
   macOS full local comparison produces platform differences
   (`.agents/skills/visual-triage/SKILL.md:8-17`).
3. `e2e-and-visual` still describes full `pnpm visual` as both the normal workflow and definition
   of done, alongside a useful affected/light-only recipe and a focused local iteration section
   (`.agents/skills/e2e-and-visual/SKILL.md:11-43`, final Definition of done). This is confusing on
   this macOS workspace even when the separate triage skill explains the platform caveat.
4. The short design-review checklist says “Top-down review only” and mandates a contact sheet,
   while its detailed procedure explicitly exempts review of one change
   (`.agents/skills/design-review/SKILL.md:19-20`, `procedure.md:7-11`).

**Change:** make one small executable policy own local capture mode, comparison platform,
changed-surface selection, and CI completion semantics. Skills link to it; task context prints
its exact route/capture-specific command. Add targeted contract tests for facts likely to drift
(command names, output artifacts, matrix), not tests asserting entire prose paragraphs.

**Acceptance:** on macOS, a simple non-color UI change gets a focused light phone/desktop capture
command; no entry point instructs the agent to await a baseline commit or compare all macOS pixels
to Linux. A top-down audit still explicitly gets the contact sheet.

### V2. The design context packet is broad where it should be precise

**Priority: P1. Confidence: high.**

Measured file lengths in this checkout: principles 705 lines, pixel-craft 352, forms-and-controls
1,158, surfaces 711, brand 532. These five documents total 3,458 lines; that is a size observation,
not a token measurement. The critic explicitly reads all principles; the implementation agent is
also directed to principles and pixel-craft. The design task context points to directory roots
instead of relevant exemplars (`scripts/task-context-data.mjs:276-300`).

**Change:** extend existing task context to accept changed paths or a surface. Print only the
applicable surface entry, decision anchors, primitive APIs, one or two current examples, state
fixtures, capture titles, and commands. Keep full documents as the source of truth. Build an index
of stable anchors and paths, not a second manually copied design book.

Suggested retrieval categories: edit a form, compact row actions, success/error feedback, settings
navigation, dense list/table, disclosure, loading/empty state, public booking, safety-critical
manifest. These are composition recipes within existing skills, not nine new top-level skills.

**Acceptance:** a row-action task receives the relevant menu/confirmation primitive and current
example; a toast task receives the current acknowledgement hierarchy; neither initially loads the
entire roadmap and all design documents. Measure context size and first successful capture time.

### V3. Route coverage does not prove the changed state was rendered

**Priority: P1. Confidence: high.**

The capture guidance already records a concrete escaped blind spot: diver-profile captures showed
no orders, so a currency-formatting change passed without photographing the changed section
(`.agents/skills/e2e-and-visual/captures.md:5-24`). Route coverage derives paths and capture calls
(`scripts/check-route-coverage.mjs:301-333`); this proves route association, not populated rows or
which conditional branch rendered. Visual tests perform real navigation assertions but do not assert
pixel quality (`e2e/visual.spec.ts:141-148`).

The worker spec has generic Done when and Verification headings, but no required visual state
contract (`docs/agents/spec-template.md:15-37`). The missing bridge is from the requested behavior
to explicit render evidence.

**Change:** add a small visual acceptance section to UI worker briefs and capture metadata: route,
role, fixture, state, viewport, locale, expected visible fact/control, and screenshot name. Require a
positive locator proving the changed content is present before photographing it. Reuse stable test
helpers and seeded states; do not bypass user behavior when the interaction itself is under test.

For a stateful row action, this means normal row, open action menu, confirmation where required,
saved result, and refusal when relevant—not five screenshots for every trivial text edit.

**Acceptance:** the populated-payment example fails locally if the selected fixture has no payment;
changed-state coverage is visible in the report rather than inferred from the route count.

### V4. Stale production builds can produce green evidence for old UI

**Priority: P1. Confidence: high.**

`e2e:run` deliberately reuses `.next`. `scripts/check-e2e-build.mjs:8-18` documents that a stale build
can fail silently. Lines 59-66 warn and continue when source is newer. Guidance tells an agent to
rebuild if failures look confusing; a passing capture of the previous implementation is equally
problematic. The check only scans `src`, so configuration and other build inputs are outside that
freshness heuristic.

**Change:** retain fast build reuse, but stamp builds with relevant input fingerprints and stamp
captures with that build identity. Verification-grade capture rejects stale input; exploratory reuse
can be explicit and clearly labeled. Do not rebuild for spec-only edits that cannot change the app.

**Acceptance:** editing a component then taking verification screenshots cannot silently capture the
old build; editing a locator reuses the same valid build. The final image manifest names commit or
working-tree fingerprint, build, viewport, state, and browser version.

### V5. Feedback is rich but still a multi-command manual assembly job

**Priority: P1. Confidence: high.**

The documented path asks agents to list Playwright tests to JSON, select captures, read a grep file,
run captures, create a report, request tiles, create an atlas, read every flag, and invoke a critic
(`e2e-and-visual/SKILL.md:29-39`, `design-review/procedure.md:54-77`). Each step is useful; repeated
manual orchestration is avoidable. The full push gate already selects light captures
(`scripts/verify-push.mjs:199-246`), but quick mode deliberately omits browsers
(`.agents/skills/verify/SKILL.md:29-41`). This is an approved speed tradeoff, not an accidental defect.

**Change:** one bounded “review changed UI” command orchestrates existing scripts and emits a compact
manifest: states selected, states omitted with reasons, freshness, image paths, probe findings,
settled findings suppressed, and exact rerun command. Run the first cheap dev capture before broad
validation, then a focused production capture when ready. Separate screenshot generation from
human/agent judgment; a generated manifest cannot claim images were reviewed.

**Acceptance:** one command produces review inputs for a small changed surface; the critic receives
only these artifacts plus relevant constraints. The quick gate remains quick, but its report makes
missing visual evidence explicit.

### V6. A 10,304-line visual spec is a shared editing and reasoning bottleneck

**Priority: P2. Confidence: high on structure; impact needs measurement.**

All captures currently sit in `e2e/visual.spec.ts` (10,304 lines). Helpers, scenario setup, matrices,
Spanish captures, and print behavior live there together. Coverage and selection scripts explicitly
parse that file (`scripts/check-route-coverage.mjs:95`, `167-220`, `319-333`;
`scripts/visual-affected.mjs:35-40`). Independent product workers repeatedly editing one file creates
avoidable conflict exposure and encourages broad reads. This audit did not count actual conflicts.

**Change:** extract capture harness and domain-specific scenarios behind a discoverable registry;
keep baseline names stable. First teach selection, route coverage, and manifest tools to discover
multiple specs, then move a single domain as a pilot. Do not rename screenshots during refactoring.

**Acceptance:** before/after list of capture names and matrices is identical; a change in one domain
selects the same meaningful states; two independent domains can add captures without editing the
same 10k-line file.

### V7. Primitive guidance needs runnable compositions and a smaller discovery surface

**Priority: P2. Confidence: medium-high.**

The repo already documents FieldGrid, cards, acknowledgements, and action hierarchy in detail.
However, menu guidance is largely prose and points at chrome implementations
(`docs/design/forms-and-controls.md:1148-1158`); `ListItemActions` is only a responsive flex wrapper
(`src/components/ui/list-item-actions.tsx:1-20`), not an opinionated action-menu contract. Finding the
correct combination still requires traversing consumers. A filename search found no Storybook,
`*.stories.*`, styleguide, component-gallery, or showcase artifacts; this is not proof no equivalent
exists under another name. The current pixel-probe atlas is a valuable existing capability.

**Change:** build a few executable examples from real primitives and approved current surfaces:
compact row menu, reversible edit with undo, persisted handoff outcome, validation failure, settings
rail. Prefer extending the existing atlas/test harness before adopting another runtime dependency.
Show narrow width, long localized label, pending, focus, and error states. Link examples from task
context and keep them importing production primitives so they cannot become stale copied designs.

**Acceptance:** agents can locate a sanctioned pattern without searching many consumers; a primitive
change checks representative combinations cheaply before route-level review. Do not turn this into
another normative mockup system or force every surface into generic cards.

### V8. Design enforcement has examples that conflict with its own testing advice

**Priority: P2. Confidence: high.**

The E2E rules say source rules belong in guards, not component unit tests
(`.claude/rules/e2e.md:54-56`). Yet `src/components/ui/form.test.tsx:1593-1937` contains a large source
scanner and “source sweeps” across more than 300 files. These are useful constraints, but agents
learn from nearby examples; a source-scan test beside a primitive teaches the pattern the rule
prohibits. Likewise, class assertions can be correct primitive contracts, but must not stand in for
rendered geometry evidence.

**Change:** move true repository policy scans into the guards layer, preserving tests and leave-alone
cases. Keep component behavior tests near components and visual geometry in captures/probes.
Add short pointers from moved tests to their new owner. Prefer incremental moves over mass churn.

**Acceptance:** an agent touching Field sees behavior tests and a precise pointer to policy checks;
source scans run once in the intended cheap layer, and no geometry claim relies only on CSS text.

### V9. Calibration and feedback learning exist but are not an explicit delivery metric

**Priority: P2. Confidence: medium-high.**

The pixel rubric distinguishes low-precision leads from findings and records a historical 6,192-flag
calibration with 90% precision (`docs/design/pixel-craft.md:270-275`). Settled findings have a machine
registry plus written index. These are excellent foundations, but mandatory review of every flag
can still be expensive if a run mixes unrelated or stale artifacts. The procedure reads reports and
crops globally unless the operator carefully scopes them.

**Change:** scope generated artifacts to the current run and changed states; identify repeated
findings by stable primitive/violation signatures; group shared-root-cause flags without hiding
individual affected surfaces. Feed confirmed recurring mistakes into one of: primitive API,
recipe, cheap guard, seed fixture, or settled exception. Do not append every incident to always-read
instructions. Preserve the critic's confirmed/possible distinction.

**Acceptance:** measure first-pass visual acceptance, reviewer reversals, repeated violation types,
probe precision, capture time, and minutes from implementation to first image. Compare medians and
P90 across comparable UI changes before claiming token or landing-time savings.

## Suggested order

1. Repair V1 contradictions and improve the design task-context entry (small, high confidence).
2. Add changed-state acceptance to worker briefs and a review artifact manifest (V3/V5).
3. Make verification captures prove build freshness (V4).
4. Pilot one compact recipe family and one domain split in visual tests (V2/V6/V7).
5. Move misplaced source guards and establish delivery metrics (V8/V9).

No blanket reduction in safety reviews, browser coverage, or independent design critique is proposed.
The aim is to make expensive feedback arrive once, early, on the right state with the right context.
