# Docs

The knowledge base for this project. Agents: read the docs relevant to your task **before**
writing code, and update them **in the same PR** as the change that invalidates them.

## Map

**Living docs** — the canonical source of truth; keep these current:

| Doc | What it holds | Update when… |
| --- | --- | --- |
| [product/vision.md](product/vision.md) | Why this product exists, who it serves, what "delight-first" means | positioning or personas change |
| [product/glossary.md](product/glossary.md) | Dive-industry domain terms and how we model them | you introduce or rename a domain concept |
| [product/roadmap.md](product/roadmap.md) | What is **not** built yet, in priority order | scope shifts; when an item ships, move it to shipped.md |
| [product/shipped.md](product/shipped.md) | Scannable index of what's already built, ADR-linked | a slice ships (move it here from the roadmap) |
| [product/next-steps.md](product/next-steps.md) | Prioritized agent-development enablement plan | priorities ship, architecture direction changes, or parallel-agent needs evolve |
| [product/human-decisions.md](product/human-decisions.md) | Human-owned decisions, approvals, and verification work, plus the provisional waiver/course/rental-fit/nitrox/hosting baselines awaiting that approval | a human decision is made, assigned, implemented, or validated, or a provisional default needs recording |
| [product/marketing.md](product/marketing.md) | The public-page rulebook: positioning spine, claims policy, voice, SEO conventions, visuals, and the maintenance loop (price source of truth is `src/lib/marketing.ts`) | product claims, positioning, public visuals, or pricing change |
| [product/rollout.md](product/rollout.md) | The 0→1 go-to-market rollout: phases, launch gates, stakeholder register, channels, metrics | a phase completes, a gate clears, or launch strategy changes |
| [product/brainstorm/](product/brainstorm/README.md) | Non-canonical idea backlog — unfiltered opportunity notes, not commitments or approved scope | you want raw feature ideas; never cite it as a decision |
| [architecture/overview.md](architecture/overview.md) | System shape, stack, directory layout, deferred decisions | structure or stack changes |
| [architecture/decisions/](architecture/decisions/) | ADRs — one per significant, hard-to-reverse choice | you make such a choice (see the `adr` skill) |
| [design/principles.md](design/principles.md) | The delight-first design system: principles, tokens, motion, voice | design language evolves |
| [design/forms-and-controls.md](design/forms-and-controls.md) | Field alignment and touch-target primitives, and the checks that enforce them | you build a form, a button, or a menu |
| [engineering/workflow.md](engineering/workflow.md) | How to build features here: the loop, definition of done | process changes |
| [engineering/testing.md](engineering/testing.md) | Testing strategy per layer, conventions | testing approach changes |
| [engineering/capability-telemetry-runbook.md](engineering/capability-telemetry-runbook.md) | How bearer-capability URLs (waivers/ready/recap tokens) are kept out of Analytics/Speed Insights, and how to audit/rotate an exposed one | the redaction logic changes or a capability type's revocation story changes |

**Strategic assessments** ([product/assessments/](product/assessments/)) — dated buyer/rival analyses,
not commitments. Their surviving recommendations belong in the roadmap; read for context.

| Doc | What it holds |
| --- | --- |
| [assessments/competitive-analysis.md](product/assessments/competitive-analysis.md) | Buyer-perspective market comparison, critical-vs-differentiator matrix, pricing posture |
| [assessments/competitive-strategy.md](product/assessments/competitive-strategy.md) | The battle plan against DiveAdmin and DiveShop360 and the data-portability wedge |
| [assessments/marketing-review.md](product/assessments/marketing-review.md) | 2026-07-23 review of the public pages: the case for repositioning, SEO substrate gaps, and the task breakdown (M1–M8) |

**Archive** ([product/archive/](product/archive/)) — delivered or superseded snapshots, kept for
rationale. Not open work; do not plan from them.

| Doc | Why it's here |
| --- | --- |
| [archive/product-space-investigation.md](product/archive/product-space-investigation.md) | 2026-07-20 breadth→depth assessment; its recommendations shipped |
| [archive/codebase-review-20260723.md](product/archive/codebase-review-20260723.md) | 2026-07-23 whole-repository review (CR-001–CR-021); all tickets shipped and human-owned decisions resolved 2026-07-24 |
| [archive/ux-audit-20260721.md](product/archive/ux-audit-20260721.md) | 2026-07-21 UX work plan (WP-1…WP-11); fully delivered 2026-07-23 |

## Rules

- Docs are for the next agent with zero context. Short, imperative, concrete. No filler.
- If code and docs disagree, the code is the bug or the doc is — fix whichever is wrong, never leave the disagreement.
- Decisions live in ADRs, not in chat history or commit messages.
