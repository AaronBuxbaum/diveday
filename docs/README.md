# Docs

The knowledge base for this project. Agents: read the docs relevant to your task **before**
writing code, and update them **in the same PR** as the change that invalidates them.

## Map

**Living docs** — the canonical source of truth; keep these current:

| Doc | What it holds | Update when… |
| --- | --- | --- |
| [product/vision.md](product/vision.md) | Why this product exists, who it serves, what "delight-first" means | positioning or personas change |
| [product/personas.md](product/personas.md) | The standing UX-persona eval frame — fifteen personas plus two cross-cutting lenses, each with a "hold the line on" checklist | a persona's actual needs or context change (new findings go to features/story-backlog.md, not here) |
| [product/glossary.md](product/glossary.md) | Dive-industry domain terms and how we model them | you introduce or rename a domain concept |
| [product/features/](product/features/README.md) | **The single home for unbuilt work and feature ideas**, in every shape: `roadmap.md` (sequenced slices, unscheduled candidate subsystems, the engineering-enablement backlog, north-star measures, human-owned production gates), `story-backlog.md` (open persona-review tickets), `brainstorm.md` (raw non-AI ideas), and `ai-ml.md` (every AI/ML idea, from raw concepts to the specialist audit's prompt-ready tasks) | scope shifts; when an item ships, move it to shipped.md; a new AI/ML idea always goes in `ai-ml.md`, never a new file |
| [product/shipped.md](product/shipped.md) | Scannable index of what's already built, ADR-linked | a slice ships (move it here from the roadmap) |
| [product/human-decisions.md](product/human-decisions.md) | Human-owned decisions, approvals, and verification work, plus the provisional waiver/course/rental-fit/nitrox/hosting baselines awaiting that approval | a human decision is made, assigned, implemented, or validated, or a provisional default needs recording |
| [product/marketing.md](product/marketing.md) | The public-page rulebook: positioning spine, claims policy, voice, SEO conventions, visuals, and the maintenance loop (price source of truth is `src/lib/marketing.ts`) | product claims, positioning, public visuals, or pricing change |
| [product/rollout.md](product/rollout.md) | The 0→1 go-to-market rollout: phases, launch gates, stakeholder register, channels, metrics | a phase completes, a gate clears, or launch strategy changes |
| [product/stakeholders/](product/stakeholders/README.md) | Per-discipline stakeholder playbooks for the rollout: who to talk to, when, prep packets, agendas, and the gates each conversation clears | a stakeholder, prep item, or question list changes (gate *status* still lives only in human-decisions.md) |
| [architecture/overview.md](architecture/overview.md) | System shape, stack, directory layout, deferred decisions | structure or stack changes |
| [architecture/decisions/](architecture/decisions/) | ADRs — one per significant, hard-to-reverse choice | you make such a choice (see the `adr` skill) |
| [design/principles.md](design/principles.md) | The delight-first design system: principles, tokens, motion, voice | design language evolves |
| [design/brand.md](design/brand.md) | DiveDay's current brand identity: name, mark, colors, fonts, concepts, voice, and merch guidance | the approved identity, visual system, voice, or merch direction changes |
| [design/forms-and-controls.md](design/forms-and-controls.md) | Field alignment and touch-target primitives, and the checks that enforce them | you build a form, a button, or a menu |
| [engineering/workflow.md](engineering/workflow.md) | How to build features here: the loop, definition of done | process changes |
| [engineering/testing.md](engineering/testing.md) | Testing strategy per layer, conventions | testing approach changes |
| [engineering/capability-telemetry-runbook.md](engineering/capability-telemetry-runbook.md) | How bearer-capability URLs (waivers/ready/recap tokens) are kept out of Analytics/Speed Insights, and how to audit/rotate an exposed one | the redaction logic changes or a capability type's revocation story changes |
| [engineering/resend-email-runbook.md](engineering/resend-email-runbook.md) | Setting up sending and the delivery-outcome webhook; how DiveDay's own hosted addresses and DMARC are configured; what to check when mail doesn't arrive | the email envelope, webhook events, or the sending domain changes |
| [engineering/monitoring-runbook.md](engineering/monitoring-runbook.md) | New-account alerts and Sentry error monitoring: setup, what's covered, capability-URL redaction, troubleshooting | the alert recipient, the Sentry wiring, or what's covered changes |
| [engineering/infrastructure-runbook.md](engineering/infrastructure-runbook.md) | Provisioning AWS S3, users, and resources using AWS CDK: login, bootstrapping, synthesis, and deployment | CDK stack, context, or credentials changes |
| [engineering/rate-limiting-runbook.md](engineering/rate-limiting-runbook.md) | The `src/lib/rate-limit.ts` abuse-control seam: which public write boundary is limited, by which dimension, and at what policy | a guarded surface, a dimension, or a `RATE_LIMITS` policy changes |
| [engineering/backup-and-restore-runbook.md](engineering/backup-and-restore-runbook.md) | Neon PITR and branch-from-timestamp restore, the scheduled per-shop logical export to S3 and its two known gaps, Vercel Blob posture, and the quarterly restore test plus its log | the backup destination, the export seam's coverage, Neon's retention window, or a restore test result changes |
| [engineering/deploy-and-migrations-runbook.md](engineering/deploy-and-migrations-runbook.md) | What a merge to `main` does to the database, the expand/contract rule, forward-only rollback, and concurrent-deploy posture | the build/migrate pipeline, `scripts/vercel-build.mjs`, or the rollback story changes |
| [engineering/incident-response-runbook.md](engineering/incident-response-runbook.md) | Severity ladder, first five minutes, Vercel instant rollback, Neon restore, uptime monitoring, and the comms template | severity definitions, the rollback/restore procedure, monitored targets, or the alert recipient changes |

**Strategic assessments** ([product/assessments/](product/assessments/)) — dated buyer/rival analyses
and code sweeps, not commitments. Their surviving recommendations belong in the roadmap; read for
context. When an assessment's recommendations ship, delete them from it and record the delivery in
[product/shipped.md](product/shipped.md) rather than leaving a done-marked task list behind.

| Doc | What it holds |
| --- | --- |
| [assessments/competitive-analysis.md](product/assessments/competitive-analysis.md) | Buyer-perspective market comparison, critical-vs-differentiator matrix, pricing posture |
| [assessments/competitive-strategy.md](product/assessments/competitive-strategy.md) | The battle plan against DiveAdmin and DiveShop360 and the data-portability wedge |
| [assessments/fareharbor-positioning.md](product/assessments/fareharbor-positioning.md) | 2026-07-24 coexist-vs-compete strategy against FareHarbor as a booking channel, not a records system |
| [assessments/switching-guide-landscape.md](product/assessments/switching-guide-landscape.md) | Survey of switching-guide candidates beyond the four shipped, ranked by dive adoption and verified export path |
| [assessments/comprehensive-review-20260802.md](product/assessments/comprehensive-review-20260802.md) | 2026-08-02 ten-lens whole-app review (product, architecture, security, dive-domain safety, data model, payments, testing, i18n/UX/a11y, marketing, operations): ranked findings, consolidated action queue, human-decision register |

**Archive** ([product/archive/](product/archive/)) — delivered or superseded snapshots, kept for
rationale. Not open work; do not plan from them.

| Doc | Why it's here |
| --- | --- |
| [archive/product-space-investigation.md](product/archive/product-space-investigation.md) | 2026-07-20 breadth→depth assessment; its recommendations shipped |
| [archive/codebase-review-20260723.md](product/archive/codebase-review-20260723.md) | 2026-07-23 whole-repository review (CR-001–CR-021); all tickets shipped and human-owned decisions resolved 2026-07-24 |
| [archive/ux-audit-20260721.md](product/archive/ux-audit-20260721.md) | 2026-07-21 UX work plan (WP-1…WP-11); fully delivered 2026-07-23 |
| [archive/marketing-review-20260723.md](product/archive/marketing-review-20260723.md) | 2026-07-23 review of the public pages (M1–M8); fully delivered 2026-07-30. The live rulebook is [product/marketing.md](product/marketing.md) |
| [archive/delight-and-experience.md](product/archive/delight-and-experience.md) | Completed delight-and-experience brainstorm; delivered ideas are summarized in shipped.md |
| [archive/diver-booking-delight-20260729.md](product/archive/diver-booking-delight-20260729.md) | Completed diver-booking-delight follow-on brainstorm; delivered ideas are summarized in shipped.md |
| [archive/fareharbor-feature-gaps-20260726.md](product/archive/fareharbor-feature-gaps-20260726.md) | 2026-07-26 feature-level audit vs FareHarbor (embed, promo codes, self-service cancel, abandoned cart, reviews, structured data); closed 2026-07-30 — those shipped, and gift cards and charters carried forward to [product/features/roadmap.md](product/features/roadmap.md#not-scheduled--candidate-subsystems) |
| [archive/ux-personas-20260730-findings.md](product/archive/ux-personas-20260730-findings.md) | 2026-07-30 fifteen-persona frontend walkthrough plus two lenses — 165 prompt-ready tasks; closed out 2026-07-31, the vast majority shipped. The standing persona reference is [product/personas.md](product/personas.md); open follow-ons are in [product/features/story-backlog.md](product/features/story-backlog.md) |
| [archive/specialist-optimization-audit-20260731.md](product/archive/specialist-optimization-audit-20260731.md) | 2026-07-31 eight-lens specialist audit; closed out 2026-08-01 — every lens shipped or moved out. ML & data moved into [product/features/ai-ml.md](product/features/ai-ml.md); accessibility's three contrast tasks (deliberately deferred, pending a color-guide decision) moved into [product/features/roadmap.md](product/features/roadmap.md#accessibility-contrast-fixes-blocked-on-a-color-guide-decision); everything else, including security/privacy, shipped — see [product/shipped.md](product/shipped.md) |

## Rules

- Docs are for the next agent with zero context. Short, imperative, concrete. No filler.
- If code and docs disagree, the code is the bug or the doc is — fix whichever is wrong, never leave the disagreement.
- Decisions live in ADRs, not in chat history or commit messages.
