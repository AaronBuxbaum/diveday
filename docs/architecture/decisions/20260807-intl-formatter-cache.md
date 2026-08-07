# 20260807-intl-formatter-cache — Build every Intl formatter through src/lib/intl-cache.ts

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

Constructing an `Intl` formatter does locale-data lookup and pattern compilation; calling
`.format()` on an existing one does neither. Measured on a CI-class box, construct-vs-reuse is
~12.3x for `Intl.DateTimeFormat` (`formatToParts`) and ~8.6x for `Intl.ListFormat`. AGENTS.md
requires locale-negotiated formatting for every date, time, and money figure app-wide, so a
constructor at a call site is a tax paid on essentially every render — invisible locally, and
visible on CI as e2e flake under load.

This invariant regressed twice before it was checked, and once more the same week the check
landed. The first memoization stopped at `src/lib/format.ts`'s file boundary while sixteen other
modules kept constructing their own (`src/lib/zoned.ts` worst, at three `Intl.DateTimeFormat`s
per wall-clock conversion on a module 26 others import); the sweep that fixed those was followed
within days by a fresh `Intl.PluralRules` per interpolated message in `src/i18n/fill.ts` — the
hottest formatting site in the app. A review expectation does not survive that arrival rate.

This record exists because the rationale previously lived only in a script comment and an
AGENTS.md table row — the one guarded invariant of its class with no ADR. Decision records are
where hard-to-reverse choices live (docs/README.md); the script is where the enforcement lives.

## Decision

- `src/lib/intl-cache.ts` is the only module that may call an `Intl` formatter constructor. Every
  other call site under `src/app`, `src/components`, `src/lib`, `src/db`, `src/features`, and
  `src/i18n` obtains formatters from it, keyed by locale and options.
- `pnpm check:intl-cache` (`scripts/check-intl-cache.mjs`, part of `pnpm check:repo`) enforces
  this. Tests are out of scope (a test constructing a formatter is usually asserting about `Intl`
  itself); `Intl.Locale` is exempt — a parsed locale value, not a compiled formatter, with
  nothing to cache.

## Alternatives considered

- **Review expectation only** — tried; regressed three times across two weeks, including in the
  week the sweep itself merged.
- **Memoize inside each formatting helper** (`format.ts`-style) — that is how round one stopped
  at a file boundary; a single shared cache is the version that cannot be partially adopted.
- **Lint rule via Biome** — no custom-rule support at the needed granularity; a repo script
  matches the house pattern (`check-clock`, `check-timezone`) and can carry its own exemptions.

## Consequences

- A new formatting call site is either through the cache or a red `pnpm check`; the per-render
  constructor tax cannot quietly return.
- The cache is a process-lifetime map keyed by locale+options; formatters are stateless, so
  sharing is safe. Its size is bounded by the product of locales and distinct option shapes,
  which is small and enumerable here.
- Escape hatch: if `Intl` ever grows a formatter whose construction is cheap or whose reuse is
  unsafe, exempt it in `scripts/check-intl-cache.mjs` beside `Intl.Locale`, with the reasoning in
  that script and a note here.
