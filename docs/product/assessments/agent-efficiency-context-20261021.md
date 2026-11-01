# Agent efficiency: instructions, retrieval, and handoffs

Dated assessment, 2026-10-21. Read-only investigation of repository behavior at `971c490d4`;
the only change made by this investigator is this report. Recommendations below are assessment
findings, not approved work or filed tickets. Sources are repository files, commands, and the
current session's exposed capabilities. No production behavior was exercised.

## Main finding

The repository has invested heavily in agent guidance, deterministic guards, and design review.
The highest-value next improvement is making that system consistent and executable across
providers, then narrowing the context it retrieves. More prose alone would amplify the problem.
Several observed contradictions explain how an agent can conscientiously follow instructions
and still repeat a mistake. Their effect on actual task duration is a hypothesis until measured.

## Measurements

Commands run: `node scripts/check-context-budget.mjs`, `node scripts/agent-health.mjs`,
`node scripts/task-context.mjs`, `node scripts/check-agents.mjs`, focused source reads, `wc`,
and comparisons of tracked skill copies.

| Observation | Result | Interpretation |
| --- | --- | --- |
| Repository context budget | 2,047 words, approximately 2,800 tokens, at budget | A useful narrow ratchet; not total real session context |
| Skills reported | 44 | Already a substantial workflow library |
| Task-context areas | 26 | A good retrieval foundation, with uneven specificity |
| Path-scoped rules | 8, totaling 3,521 words | Useful only when loaded by the runtime or explicitly read |
| Guard scripts with sibling tests | 63 of 63 | Counts test files, not test coverage or guard efficacy |
| Visual route coverage | 110/111, 99% | Route reachability, not proof that changed states were reviewed |
| Accessibility route coverage | 62/111, 56% | Separate from visual coverage |
| Local skill bodies duplicated in both provider trees | 20 | All tracked; 3 SKILL.md files differ |
| Papercut entries | 9 files | Existing learning mechanism; no evidence here of its retrieval rate |

The 63 guard scripts discovered by agent-health are not the same quantity as the 61 guards
spawned by check:repo. That difference alone is not drift.

## C1. Provider parity is incomplete where it matters most

**Priority: high. Observed implementation gap; impact needs measurement.**

The canonical policy explicitly says provider-specific folders must not introduce unique
requirements (`docs/agents/working-rules.md:10`). However, all session startup, per-prompt,
compaction, shell refusal, formatting, failure explanation, and stop hooks are wired through
Claude-specific settings (`.claude/settings.json:88-217`). The repository Codex config contains
environment variables and MCP servers only (`.codex/config.toml:1-18`). No equivalent lifecycle
wiring is declared there. An external host could implement some behavior; this audit does not
claim that all non-Claude hosts lack hooks. The repository cannot currently demonstrate parity.

Examples of behavior an agent may miss include automatic formatting after edits, a failed
command's known fix, the branch/dirty-state prompt, and the reminders after compaction
(`scripts/session-context.mjs:548-559`). The session-context output even says path-scoped rules
"load as you read matching files" (`scripts/session-context.mjs:543`), which is a Claude runtime
assumption; AGENTS correctly tells other providers to read them explicitly.

**Recommendation:** define a provider capability matrix and a provider-neutral bootstrap/check
command that reports which behaviors actually ran. Keep mandatory correctness in repository
commands and CI, with adapters for convenience. Add smoke tests for each supported provider's
session launch, rule selection, formatting, push checks, and resume. Missing capabilities should
produce a short actionable status, not silently pretend the full workflow is active.

## C2. The skills have two tracked owners, and the drift guard checks only one

**Priority: high. Confirmed defects.**

Twenty local skills exist as separate tracked directories under `.agents/skills/` and
`.claude/skills/`. Seventeen SKILL.md bodies are identical. Three differ: `verify`,
`e2e-and-visual`, and `stacked-prs`. This is distinct from the legitimate symlinks that expose
vendored `.agents` skills to Claude.

The Codex-visible `verify` points at nonexistent `.Codex/rules/`
(`.agents/skills/verify/SKILL.md:8`), and `e2e-and-visual` points at nonexistent
`.Codex/rules/e2e.md` (`.agents/skills/e2e-and-visual/SKILL.md:53`). The Claude copies point at
the real `.claude/rules/` paths. The Codex stacking examples use uppercase `Codex/` branches
(`.agents/skills/stacked-prs/SKILL.md:38-47`), whereas automatic session fetch explicitly only
fetches `main` and `claude/*` (`scripts/session-context.mjs:71-84`).

`check-agents` enumerates `.claude/skills` and validates those local documents; its `.agents`
checks concern linked vendored skills, not local mirror equivalence
(`scripts/check-agents.mjs:39-89,244-255`). It does not catch these defects. In this checkout,
the command reports missing `next-devtools-mcp` and `playwright-mcp` binaries, which is a local
dependency/environment limitation, not evidence that those dependencies are missing everywhere.

**Recommendation:** keep one authoritative local skill tree; expose it by supported links or
generated adapters. Until consolidated, compare every mirrored file in CI, allowlisting only
intentional provider metadata. Validate all provider trees' referenced paths. Fetch supported
branch namespaces from a single registry rather than embedding one provider's prefix.

## C3. Context retrieval still expands small work into large reading assignments

**Priority: high. Confirmed reading load; token savings require runtime measurement.**

Many task-context areas point at the same four whole documents: roadmap, glossary, design
principles, and architecture overview (`scripts/task-context-data.mjs:17-22,46-51,74-79`).
Their current word counts are 12,803 + 1,345 + 8,816 + 1,000 = **23,964 words**. They are
references, so an agent need not always read every word; nevertheless the command presents them
under "Read" without sections or relevance predicates (`scripts/task-context.mjs:36-44`).
`new-feature` also directly instructs reading the roadmap before any feature
(`.claude/skills/new-feature/SKILL.md:10`).

The design task-context lists all of `src/app`, `src/components`, and `e2e`, rather than a
surface's implementation, controls, capture IDs, fixtures, or relevant review history
(`scripts/task-context-data.mjs:278-299`). Waivers and bookings similarly use `e2e` as a test
pointer; auth points at `src/lib` and `e2e`. The database context calls `pnpm test src/db`
and repeats typecheck in its validation array (`scripts/task-context-data.mjs:347-358`).
These are much less bounded than newer areas such as gear and work-orders.

**Recommendation:** evolve task-context into a task packet selected from changed paths or a
named surface: exact contract tests, current decision excerpts, relevant glossary section,
canonical component examples, touched-locale bundles, capture IDs, and the smallest validation
commands. Keep broad references as optional links. Measure packet size and retrieval success;
do not solve this by shortening every authoritative document.

## C4. The budget reports the cheapest part of context, with too broad a label

**Priority: medium-high. Confirmed measurement limitation.**

`measure()` reads only AGENTS, CLAUDE, unscoped Claude rules, Claude skill descriptions, and
Claude agent descriptions (`scripts/check-context-budget.mjs:124-160`). It deliberately excludes
user-only skill descriptions. Agent-health labels the result "every session, main loop and
subagents alike" (`scripts/agent-health.mjs:49`), despite Explore explicitly omitting CLAUDE
instructions (`.claude/agents/Explore.md:7`) and other providers having different listings.

The actual task also carries global instructions, installed plugin skills, tools, memory, and
runtime guidance that this function does not inspect. On-demand skills and their transitive
reads are excluded. Examples of SKILL.md size are verify 6,493 bytes, e2e-and-visual 6,700,
writing-for-agents 10,886, and wayfinder 11,913. The local guideline is approximately 6k characters
per skill (`.claude/skills/README.md`, Maintenance); vendored bodies need separate handling.

**Recommendation:** retain the current ratchet but label it "repository Claude startup estimate."
Add observed per-provider input/cached-input/output tokens, bootstrap context, tool-result bytes,
and task-packet bytes. Report cost per landed task as well as per model call. Count cache hits
separately: total input tokens do not equal billed uncached tokens. A profile of routinely loaded
skill chains will identify real savings better than another absolute cap.

## C5. Semantic contradictions survive path and prose guards

**Priority: high. Confirmed examples.**

| Sources | Contradiction and likely failure mode |
| --- | --- |
| `scripts/task-context-data.mjs:290` vs `.claude/skills/design-review/SKILL.md:12-16` | Task context requires dark desktop inspection; review skill explicitly limits dark checks to color work under H-20260925-many-colour-schemes-check. Agents can spend time on unnecessary captures or appear to skip a required check. |
| `docs/architecture/overview.md:84-85` vs `src/test/db.ts:11,47,128,211` and `docs/engineering/testing.md:352-372` | Overview calls migrate-once snapshots a future design and says PGlite stays per-test; implementation already hydrates snapshots and offers a per-file transaction-isolated helper. Agents can re-propose shipped work or reject the efficient existing helper. |
| `docs/architecture/overview.md:39-40,63-65` vs current route map | Overview still names `src/db/schema.ts` and shared components "when it exists." The source of truth is now a schema directory, and components already exist. |
| `docs/agents/working-rules.md:85-86` vs `.claude/skills/new-feature/SKILL.md:48` | Canonical rule says newest open branch across any thread; feature skill says the branch you opened last. The distinction changes stack base choice. |
| `docs/agents/working-rules.md:122-124` vs `.claude/agents/Explore.md:4,15-18` | Scouting, screenshots, and test runs are assigned to Explore, but it only has Read/Glob/Grep and cannot run tests, capture screenshots, or write a report. |

The current skills and guards catch many missing paths, not these semantic conflicts. The
existing rule "fix docs in the same change" is necessary but has not prevented them.

**Recommendation:** give operational facts one structured owner and render their references.
Use reviewed contracts for branch policy, scheme selection, test fixtures, and role capabilities.
Add small consistency checks for exact facts; do not invent a general semantic-proof engine.
Use a dated freshness review for judgment-heavy documentation. Replace stale settled decisions
when superseded, preserving rationale in their ADR history rather than keeping two live rules.

## C6. Visual memory has a good library but no bounded per-change entry point

**Priority: high for visual work. Observed workflow shape; causal impact is an inference.**

The design review procedure requires a top-down contact sheet, reading principles and pixel
craft, reading settled questions, changed-route captures, holistic answers in surfaces, pixel
tiles and state atlas, and sometimes a critic (`.claude/skills/design-review/SKILL.md:20-42`).
These are valuable tools. But principles (8,816 words), pixel craft (3,466), settled questions
(2,121), and surfaces (10,552) together hold **24,955 words** before the 1,294-word procedure.
Not every edit needs all entries. The trigger is any user-facing change, while the surface
registry requirement in new-feature is for significant new surfaces.

**Recommendation:** route visual changes by scope: copy-only, control/state, layout, shared token,
or navigation/system. A shared-token change deserves broad contact sheets; a local spacing fix
needs its affected surface and relevant defect classes. For each surface, index approved intent,
component exemplar, critical states, screenshots, capture IDs, and settled exceptions. Require
the worker's task packet to name those items before coding and its result to link evidence after.
Keep the current broad sweep as an explicit audit mode. Do not remove safety, accessibility,
or user-visible-state coverage to save tokens.

## C7. Handoff artifacts omit critical reproducibility fields

**Priority: medium-high. Confirmed schema gap.**

The worker spec is already strong: goal, owned files, constraints, observable done conditions,
exact validation, and a path-only result (`docs/agents/spec-template.md:12-38`). The missing
standard fields are: immutable base/head SHA, accepted product decisions in the user's exact
terms, decision provenance, visual evidence and state matrix, running-process ownership,
pending reviews/CI run IDs, next executable command, and uncertainty/blockers.

The generic handoff saves to OS temporary storage and is human-invoked only
(`.agents/skills/handoff/SKILL.md:5-14`); the Claude handoff launches `claude --bg` and says the
user manages it (`.agents/skills/claude-handoff/SKILL.md:8`). Neither is a portable, durable
automatic resume contract. CLAUDE's compact instructions preserve branch, issue, failing test,
and review threads, but omit settled product/visual decisions (`CLAUDE.md:9-15`).

**Recommendation:** extend the existing template rather than add a competing workflow. Store a
small durable task-state artifact with artifact links and explicit owner/status. Read it on
resume, validate SHAs and process liveness, and load only the next task packet. Require handoffs
before context exhaustion and at changed responsibility, not on every trivial step.

## C8. The learning loop records symptoms but does not measure recurrence

**Priority: medium. Observed mechanism; absence claim limited to inspected tooling.**

Papercuts already has a sensible one-file-per-event format and grep-first instruction
(`docs/agents/papercuts.md:8-24`). Session context detects repeated hook refusals and asks for a
papercut (`scripts/session-context.mjs:564`). This is useful preservation, but the inspected
agent-health report has no task-level token, latency, first-green, or repeated-defect metrics.
The retro skill is user-invoked only (`.agents/skills/retro/SKILL.md:4`) and suggests improvements;
it does not close the loop automatically.

**Recommendation:** normalize recurring failures into a small taxonomy: wrong environment,
missing context, violated invariant, selector/hydration, fixture drift, unexpected pixels,
stack-base failure, stale instruction, and infrastructure. For each landed task, record initial
red check, correction count, first-green time, merge time, and relevant artifact links. Review
the most repeated classes weekly, promoting a lesson to an executable check or task packet
only when recurrence justifies it. Remove superseded guidance at the same time.

## Suggested implementation order

1. Consolidate skill copies and fix wrong references, role capabilities, and scheme-policy drift.
2. Publish the provider capability matrix and establish portable bootstrap/resume checks.
3. Narrow task-context for the most common feature and UI work; preserve the existing docs.
4. Extend worker/result templates with settled decisions and visual evidence contracts.
5. Instrument real task cost, first-green rate, landing time, and recurrent failure classes.
6. Use those measurements to decide which new skills are worthwhile: task-packet routing,
   provider onboarding, CI failure classification, and visual change planning. Prefer extending
   existing debug/run/design-review/verify skills over installing more generic overlapping ones.

Success would mean that a fresh agent can retrieve the right contracts, make a bounded change,
produce reproducible evidence, and hand it off without reopening decisions or rediscovering
the same harness behavior. This audit does not claim a numerical cost reduction without a
before/after sample of comparable completed tasks.
