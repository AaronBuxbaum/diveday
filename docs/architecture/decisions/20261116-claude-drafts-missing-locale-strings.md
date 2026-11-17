# 20261116-claude-drafts-missing-locale-strings — Claude drafts missing locale strings for a human to review

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

`pnpm check:locale` fails on any key a locale lacks, and the agent that writes a feature writes its Spanish in the same change (`src/i18n/locales/es-ES/README.md`). Nothing drafted that Spanish, so every copy change carried a hand translation. Issue #4250 asked for a drafting helper; a native review is tracked separately in #4217.

## Decision

`scripts/draft-locale.mjs` is a developer tool, never a CI step. It reads the bundles the way `check:locale` does and collects the keys each locale lacks. It sends them to Claude in one request per locale, with that locale's README as the terminology guide. It uses `@anthropic-ai/sdk`, already a runtime dependency (ADR 20261018-claude-assists), and the `draft` model role from `src/lib/claude/models.ts`, whose stated job includes translating long copy. The request opts into server-side fallbacks and treats a final refusal as no drafts.

- It is a dry run by default, printing the drafts; `--write` puts them in the locale's files in the English key order and never overwrites a value already there.
- Every draft passes `placeholderParity` (`scripts/locale-placeholders.mjs`, shared with `check:locale`): the same ICU argument names and rich-text tags as the English. A draft that fails is dropped and named.
- A key with a `waiver` or `medical` segment, its bundle namespace included, is never sent. That wording stays a human's (H-20260730-jurisdiction-waiver-text-medical).
- Nothing is committed by the script. The drafts sit in the working tree, and the author reads them in `git diff` like any other change.

## Consequences

A missing-Spanish failure costs one command and a read instead of a translation. The drafts are as good as the README's terminology, so a settled term still belongs in the README, and it reaches every later draft. Running it needs `ANTHROPIC_API_KEY` and spends tokens, so it never runs in CI. Leaving costs one file: the bundles stay plain JSON, and nothing else depends on the script.

## Alternatives considered

- **Draft in CI on a red `check:locale`**: puts unreviewed machine copy one merge from production.
- **A translation service or queue**: a new dependency, and the waiting the README rules out.
- **Raw HTTP like `scripts/persona-bots/judge.mjs`**: that choice predates the SDK being a dependency.
