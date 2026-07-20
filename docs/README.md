# Docs

The knowledge base for this project. Agents: read the docs relevant to your task **before**
writing code, and update them **in the same PR** as the change that invalidates them.

## Map

| Doc | What it holds | Update when… |
| --- | --- | --- |
| [product/vision.md](product/vision.md) | Why this product exists, who it serves, what "delight-first" means | positioning or personas change |
| [product/glossary.md](product/glossary.md) | Dive-industry domain terms and how we model them | you introduce or rename a domain concept |
| [product/roadmap.md](product/roadmap.md) | Milestone sequencing | a milestone ships or scope shifts |
| [product/next-steps.md](product/next-steps.md) | Prioritized product and agent-development execution plan | priorities ship, architecture direction changes, or parallel-agent needs evolve |
| [product/product-space-investigation.md](product/product-space-investigation.md) | Strategic assessment of built vs. unbuilt surface, the cut list, and the breadth→depth pivot | the product direction is re-examined or its recommendations ship |
| [product/human-decisions.md](product/human-decisions.md) | Human-owned decisions, approvals, and verification work, plus the provisional waiver/course/gear/nitrox/hosting baselines awaiting that approval | a human decision is made, assigned, implemented, or validated, or a provisional default needs recording |
| [product/marketing.md](product/marketing.md) | Public pages, real-demo screenshot capture, and provisional pricing boundary | product claims, public screenshots, or pricing change |
| [product/brainstorm/](product/brainstorm/README.md) | Non-canonical idea backlog — unfiltered opportunity notes, not commitments or approved scope | you want raw feature ideas; never cite it as a decision |
| [architecture/overview.md](architecture/overview.md) | System shape, stack, directory layout, deferred decisions | structure or stack changes |
| [architecture/decisions/](architecture/decisions/) | ADRs — one per significant, hard-to-reverse choice | you make such a choice (see the `adr` skill) |
| [design/principles.md](design/principles.md) | The delight-first design system: principles, tokens, motion, voice | design language evolves |
| [design/forms-and-controls.md](design/forms-and-controls.md) | Field alignment and touch-target primitives, and the checks that enforce them | you build a form, a button, or a menu |
| [engineering/workflow.md](engineering/workflow.md) | How to build features here: the loop, definition of done | process changes |
| [engineering/cleanup-plan.md](engineering/cleanup-plan.md) | Prioritized simplification/unification work packages from the 2026-07-19 audit | a work package ships or its premise changes |
| [engineering/testing.md](engineering/testing.md) | Testing strategy per layer, conventions | testing approach changes |
| [integrations/certification-agencies.md](integrations/certification-agencies.md) | Agency verification API research and credential setup runbook | agency capability or verification configuration changes |

## Rules

- Docs are for the next agent with zero context. Short, imperative, concrete. No filler.
- If code and docs disagree, the code is the bug or the doc is — fix whichever is wrong, never leave the disagreement.
- Decisions live in ADRs, not in chat history or commit messages.
