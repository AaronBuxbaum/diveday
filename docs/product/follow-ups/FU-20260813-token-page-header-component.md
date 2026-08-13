# FU-20260813-token-page-header-component — Converge the bearer-token page headers on one shared component

- **Status:** Open
- **Raised:** 2026-08-13 — the /ready/[token] redesign (branch `claude/design-ready-page`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/app/ready/[token]/page.tsx`, `src/app/waivers/[token]/page.tsx`, `src/app/recap/[token]/page.tsx`

## What I noticed

The three diver-facing bearer-token pages each hand-roll the same header: an uppercase
shop-name eyebrow, a large title, and a muted meta line. The /ready redesign settled on a
**muted** eyebrow (`text-sm font-medium tracking-widest text-muted uppercase`) — the shop name is
context, not an action, and reserving `text-primary` for things a finger can press is what made
the old double-eyebrow bug (two identical uppercase-primary lines stacked) look like a rendering
mistake in the first place. `/waivers/[token]` (line ~478) and `/recap/[token]` (line ~256) still
render their eyebrows in `text-primary`, so the three pages a diver reaches from the same
confirmation email now disagree on what an eyebrow looks like.

## Why it isn't already done

The /ready redesign's scope was `src/app/ready/[token]/**` only; /waivers and /recap were owned
by sibling redesign units running in parallel, and a shared component built mid-flight would have
conflicted with all of them. A convergence pass only makes sense once the parallel redesign
branches have merged.

## Proposed change

Extract a `TokenPageHeader` (eyebrow / title / meta children) into `src/components/`, defaulting
the eyebrow to muted, and use it from the three token pages. It is a composition-only component —
no data reads, no translator of its own; each page passes already-resolved strings. Not proposing
any shared layout or data loader for these routes: their loading/error/provider needs differ and
ADR 20260803-error-boundary-copy-bridge already fixes how words reach each boundary.

## Prompt

```text
Read src/app/ready/[token]/page.tsx (the header block near the top of the returned JSX),
src/app/waivers/[token]/page.tsx (~line 478), and src/app/recap/[token]/page.tsx (~line 256).
Each hand-rolls the same bearer-token page header: uppercase shop-name eyebrow, large title,
muted meta line — but /ready uses a muted eyebrow while the other two use text-primary.
Create src/components/TokenPageHeader.tsx: a presentational component taking eyebrow, title,
and children (meta lines), rendering the /ready grammar (eyebrow: text-sm font-medium
tracking-widest text-muted uppercase; title: text-3xl font-semibold tracking-tight text-balance).
Use it from all three pages. No data reads or translators inside it — pages pass resolved
strings. Done when the three pages render one header grammar and their e2e specs
(e2e/readiness.spec.ts, e2e/waivers.spec.ts, e2e/recap.spec.ts) plus the visual captures for
readiness/waiver/recap pass with only the intended eyebrow-color diffs on waiver and recap.
Run pnpm check and the filtered visual spec; account for visual diffs in the PR body.
Delete docs/product/follow-ups/FU-20260813-token-page-header-component.md as part of the change.
```
