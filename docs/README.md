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
| [product/competitive-analysis.md](product/competitive-analysis.md) | Buyer-perspective market comparison (DiveAdmin, EVE, DiveShop360, Bloowatch, generic platforms), critical-vs-differentiator matrix, pricing posture | the competitive landscape shifts, pricing posture is decided, or a named gap ships |
| [product/ux-audit-20260721.md](product/ux-audit-20260721.md) | Screenshot-verified UX audit of the shipped surfaces and the specced P0–P2 work plan (WP-1…WP-11) | a WP ships, is re-scoped, or a finding is invalidated |
| [product/human-decisions.md](product/human-decisions.md) | Human-owned decisions, approvals, and verification work, plus the provisional waiver/course/rental-fit/nitrox/hosting baselines awaiting that approval | a human decision is made, assigned, implemented, or validated, or a provisional default needs recording |
| [product/marketing.md](product/marketing.md) | Public pages, the illustrated mockups they ship, and the provisional pricing boundary | product claims, public visuals, or pricing change |
| [product/brainstorm/](product/brainstorm/README.md) | Non-canonical idea backlog — unfiltered opportunity notes, not commitments or approved scope | you want raw feature ideas; never cite it as a decision |
| [architecture/overview.md](architecture/overview.md) | System shape, stack, directory layout, deferred decisions | structure or stack changes |
| [architecture/decisions/](architecture/decisions/) | ADRs — one per significant, hard-to-reverse choice | you make such a choice (see the `adr` skill) |
| [design/principles.md](design/principles.md) | The delight-first design system: principles, tokens, motion, voice | design language evolves |
| [design/forms-and-controls.md](design/forms-and-controls.md) | Field alignment and touch-target primitives, and the checks that enforce them | you build a form, a button, or a menu |
| [engineering/workflow.md](engineering/workflow.md) | How to build features here: the loop, definition of done | process changes |
| [engineering/testing.md](engineering/testing.md) | Testing strategy per layer, conventions | testing approach changes |

## Rules

- Docs are for the next agent with zero context. Short, imperative, concrete. No filler.
- If code and docs disagree, the code is the bug or the doc is — fix whichever is wrong, never leave the disagreement.
- Decisions live in ADRs, not in chat history or commit messages.
