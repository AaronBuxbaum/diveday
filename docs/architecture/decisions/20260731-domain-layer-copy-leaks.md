# 20260731-domain-layer-copy-leaks — Scan `src/lib`/`src/db` for returned English sentences

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

[20260730-frontend-strings-i18n-extraction](20260730-frontend-strings-i18n-extraction.md) finished
extracting every hard-coded string from JSX under `src/app`/`src/components`, driving
`scripts/copy-baseline.json` to zero. That ADR explicitly kept the architectural rule — "`src/lib`
and `src/db` return codes, not sentences" — as a review expectation rather than a scan target,
reasoning there was "no structural signal separating prose from code in those layers."

That assumption was wrong in a specific, recurring shape: a domain function builds an object with
a field named `message` (or a `_LABELS`-suffixed lookup const) whose value is a full English
sentence, and a page renders it via `{blocker.message}` — a variable reference, not a string
literal, so `check-copy.mjs`'s JSX-literal scan never sees it despite the text reaching the diver
or staff UI unlocalized. An audit following the question "any hardcoded strings left anywhere?"
found this pattern live in fourteen files: `readiness.ts`, `readiness-summary.ts`, `import.ts`,
`today.ts`, `blockers.ts`, `dive-prep.ts`, `rentals.ts`, `course-inquiry.ts`, `manifests.ts`,
`recurrence.ts`, `dive-site-landmarks.ts`, `diver-planning.ts`, `onboarding.ts`, and
`rate-limit.ts`, plus two `.ts` label-map files physically colocated under `src/app`/
`src/components` (`shared.ts`, `ShopNavLinks.tsx`'s copy tables) that a JSX-only walk also missed.
So there *is* a structural signal after all — not perfect, but real: a narrow list of
copy-suggestive property names (`message`, `label`, `text`, `reason`, `summary`) assigned a
string-literal sentence.

## Decision

**Two scanners, not one widened scanner**, because the two blind spots have different shapes and
different false-positive risks:

1. `scripts/check-copy.mjs` now also walks `.ts` files (still excluding `.test.ts`/`.d.ts`) under
   its existing `src/app`/`src/components` roots, applying a new `labelMapPropertyPattern` — the
   same discipline as its JSX-attribute scan, but for object-literal properties. Deliberately
   excludes `title`/`description` from the property list: those collide with `export const
   metadata` and JSON-LD/OG config objects, which are not prose.
2. A new sibling script, `scripts/check-domain-strings.mjs`, walks `src/lib` and `src/db` with the
   same `labelMapPropertyPattern` discipline, gated by its own ratchet baseline
   (`scripts/domain-strings-baseline.json`, seeded at zero since this change extracts everything
   the audit found). Kept separate from `check-copy.mjs` rather than adding `src/lib`/`src/db` to
   its root list: the two roots have different exemption norms (no `metadata.title` collisions to
   worry about, but a legitimate need to exempt genuine proper-noun tables — agency names, HTTP
   method strings — that happen to match a copy-suggestive property name) and mixing them into one
   report would blur which layer a violation is in.

**The fix pattern, applied uniformly**: a domain function returns a `code` (a string-literal union,
or `{code, params?}` when the message needs interpolation); the `src/app`/`src/components` caller
resolves the code through a `Record<Code, MessageKey>` map into `t(key, params)`. When the same
code is rendered on both a staff and a diver surface, each caller gets its own key-map against its
own bundle — the domain layer never imports from `src/i18n` or picks a bundle. Interpolated params
that are themselves words (a certification-level name, not a raw count) are resolved through their
own key-map before being handed to `t()`.

This corrects the prior ADR's scope note for these two layers; that note is now stale for the
`message`/`label`/`text`/`reason`/`summary` shape specifically, though the broader "codes, not
sentences" principle is unchanged and this tooling is exactly its enforcement mechanism.

## Alternatives considered

- **Fold `src/lib`/`src/db` into `check-copy.mjs`'s root list** — rejected; the JSX-specific
  patterns (text nodes, JSX attributes) don't apply there, and mixing exemption norms across four
  roots in one report makes the ratchet harder to reason about than two focused scripts.
- **A full TypeScript AST parse instead of a regex heuristic** — rejected for the same reason the
  original copy scanner rejected it: a heuristic tuned to under-report is cheap, fast, and good
  enough when paired with human review at the architectural boundary; an AST pass is a bigger
  dependency for marginal precision gain here.
- **Rely on review alone (no scanner)** — rejected; that was the prior decision and it missed
  fourteen files silently for a full migration cycle.

## Consequences

- `scripts/domain-strings-baseline.json` starts at zero and `check:repo` gains
  `pnpm check:domain-strings` as a plain gate (same shape as `check:copy` once its baseline empties
  — no ratchet debt to carry).
- A legitimate domain const that happens to match a copy-suggestive property name (e.g. a
  `reason:` field holding an HTTP status phrase, not diver-facing prose) needs an
  `// i18n-exempt: reason` marker, same mechanism as the existing scanner.
- Future domain-layer PRs get the same fast feedback loop `check:copy` already gives
  `src/app`/`src/components`: a returned sentence fails locally before it ever reaches a page.
- Revisit if the property-name list drifts into false-positive noise (the same trigger the
  original scanner names for its own attribute list) — narrow the list rather than widen the
  scanned roots.
