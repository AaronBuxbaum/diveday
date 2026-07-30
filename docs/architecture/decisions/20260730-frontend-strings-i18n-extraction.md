# 20260730-frontend-strings-i18n-extraction — Finish the copy-baseline migration, marketing pages included

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

[20260730-staff-copy-localization](20260730-staff-copy-localization.md) shipped `pnpm check:copy`
as a ratchet over the ~1,001 hard-coded strings across 110 files that were still compiled into
`src/app` and `src/components`, and explicitly deferred the mechanical extraction as
milestone-scale work. That ADR also recorded marketing pages (`/`, `/product`, `/about`,
`/switching/*`) as "English-by-design today" and out of scope for translation, tracked in the
baseline only for honesty.

The instruction driving this change is to finish that migration: extract every remaining string
into a message bundle so no hard-coded English prose remains anywhere under `src/app` or
`src/components`, marketing pages included.

## Decision

**Run the migration to completion using the existing mechanism — no new infrastructure.** Every
string moves into `src/i18n/locales/<locale>/diver.json` (public/diver-facing) or `staff.json`
(`/shop/**`), translated into `es-ES` alongside `en-US`, exactly as the two prior ADRs describe.

**Marketing and account pages join the diver bundle.** `/`, `/about`, `/product`, `/pricing`,
`/switching/**`, `/onboard`, `/sign-in`, `/forgot-password`, `/reset-password`, `/verify`,
`/invite/[token]` are public, unauthenticated, diver-facing surfaces — the same category
`requestLocale`/`diverTranslator` already serve. They gain new top-level namespaces (`marketing`,
`account`, `switching`) in `diver.json` rather than a new bundle or mechanism. This supersedes the
"English-by-design" scoping note in 20260730-staff-copy-localization: that note is now stale and
is corrected by this record, per this repo's own rule that an invalidated doc is fixed in the same
change that invalidates it.

**Staff surfaces finish the same way the staffing/calendar-sync proof-of-concept started them** —
`staffTranslator`, server-side only, words passed as props into Client Components.

**Scope stays what the checker scans**: `.tsx` under `src/app` and `src/components`. Copy
originating in `src/lib`/`src/db` remains the architectural rule from the prior ADR (return codes,
not sentences) rather than a new scan target — extending the scanner there was already considered
and rejected in 20260730-staff-copy-localization for the same reason (no structural signal
separating prose from code in those layers).

**Exemptions are unchanged**: static `metadata.title` (resolved before locale negotiation), and
the waiver body / medical questionnaire (H-01/H-03 sign-off, not an engineering decision).

## Alternatives considered

- **Leave marketing pages in the baseline as before** — rejected; the explicit instruction was "no
  hard-coded English at all," and marketing copy is ordinary prose with no legal-review
  constraint, so there is no reason it can't go through the same bundle as everything else.
- **A separate `marketing.json` bundle** — rejected; the diver bundle already crosses to the
  client only where a Client Component needs it, and splitting per-surface was already flagged in
  20260729 as the move to make *if* the diver bundle grows large, not before.

## Consequences

- `scripts/copy-baseline.json` goes to empty and `pnpm check:copy` becomes a plain gate (no
  un-extracted debt) rather than a ratchet with a nonzero target — the baseline file can be
  deleted once every entry clears, per that check's own "revisit when" note.
- Marketing copy is now real bundle content and gets a first-pass `es-ES` translation like the
  rest of the diver surface; it carries the same native-review caveat already recorded for the
  rest of Spanish copy in `docs/product/human-decisions.md`.
- Every touched page/component needs its visual regression baseline re-approved if wording pixels
  moved — none should, since English bundle values are copied verbatim from the source they
  replace.
