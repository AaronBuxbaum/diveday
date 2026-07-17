# 0004 — Style via semantic CSS tokens bound to Tailwind

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

"Delight-first" dies by a thousand hard-coded hex values. Agents need a styling system where the
correct choice is the easy one, themes (light/dark) come free, and design review can check rule
violations mechanically.

## Decision

Design tokens are **semantic CSS custom properties** defined once in `src/app/globals.css`
(`--background`, `--surface`, `--primary`, `--accent`, `--muted`, `--danger`, …), with light and
dark values, exposed to Tailwind via `@theme inline` so utilities like `bg-surface`,
`text-muted`, `border-border` exist.

Rules:

- Components use **semantic utilities only** — no raw hex, no `bg-cyan-600`, no palette-scale
  utilities for brand/surface/ink colors.
- New tokens are added to `globals.css` *with both light and dark values* and documented in
  [design/principles.md](../../design/principles.md).
- `--accent` (coral) is reserved for moments of delight — not for routine emphasis.

## Alternatives considered

- **Tailwind palette classes directly** (`bg-cyan-600 dark:bg-cyan-400`) — fast to write,
  impossible to re-theme, dark mode duplicated at every call site.
- **CSS-in-JS theme object** — runtime cost and a second styling idiom alongside Tailwind.

## Consequences

- Rebrands and theme fixes are single-file changes; dark mode is automatic at the component level.
- Slight ceremony when a genuinely new color role appears (add token first). That friction is
  the point.
