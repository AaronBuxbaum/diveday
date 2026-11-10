# H-20261025-ga-migration-budget-pre: GA migration budget for the pre-release stack running the whole critical path simultaneously —…

- **Status:** Chosen
- **Human owner:** Product owner

## Current outcome — 2026-11-10

Depend on stable releases only. drizzle-orm and drizzle-kit are the sole prerelease exception.
Move a currently pinned prerelease to stable when a compatible stable release is available,
using the dependency-maintenance workflow and compatibility evidence. The old preview-version
inventory below is historical, not the current dependency list.

Source: [owner-account decision record on #4196](https://github.com/AaronBuxbaum/diveday/issues/4196#issuecomment-6759906171).
The sections below preserve the original question and rationale, not a second unresolved worklist.

## Original question

GA migration budget for the pre-release stack running the whole critical path simultaneously — Next 16.3 preview, next-auth 5 beta, drizzle 1.0-rc, TS 7 — each ADR-justified individually but stacked, and is pre-release-major the default posture for a SaaS taking real payments (`comprehensive-review-20260802` HD-20, ARCH-4)?

## Minimum outcome to record

One scheduled hardening sprint at each GA, or opportunistic upgrades — and the posture question answered either way.

## Unblocks / follow-up

A scheduled check watching the four GA dates is the buildable half; see [roadmap P2](../archive/roadmap-20261110.md#p2--when-parallelism-or-scale-proves-the-need).

Part of the [human decision log](README.md#decision-register).
