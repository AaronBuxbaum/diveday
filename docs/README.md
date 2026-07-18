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
| [product/human-decisions.md](product/human-decisions.md) | Human-owned decisions, approvals, and verification work | a human decision is made, assigned, implemented, or validated |
| [product/defaults-to-verify.md](product/defaults-to-verify.md) | Provisional waiver, course, gear, and hosting baselines requiring human approval | implementation needs a practical default before policy is finalized |
| [product/marketing.md](product/marketing.md) | Public pages, real-demo screenshot capture, and provisional pricing boundary | product claims, public screenshots, or pricing change |
| [architecture/overview.md](architecture/overview.md) | System shape, stack, directory layout, deferred decisions | structure or stack changes |
| [architecture/decisions/](architecture/decisions/) | ADRs — one per significant, hard-to-reverse choice | you make such a choice (see the `adr` skill) |
| [design/principles.md](design/principles.md) | The delight-first design system: principles, tokens, motion, voice | design language evolves |
| [engineering/workflow.md](engineering/workflow.md) | How to build features here: the loop, definition of done | process changes |
| [engineering/testing.md](engineering/testing.md) | Testing strategy per layer, conventions | testing approach changes |

## Rules

- Docs are for the next agent with zero context. Short, imperative, concrete. No filler.
- If code and docs disagree, the code is the bug or the doc is — fix whichever is wrong, never leave the disagreement.
- Decisions live in ADRs, not in chat history or commit messages.
