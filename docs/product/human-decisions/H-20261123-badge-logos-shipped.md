# H-20261123-badge-logos-shipped: Ship official logos beside a shop's affiliation badges

- **Status:** Implemented, legal review pending
- **Date:** 2026-11-23

## Decision

Aaron decided on 2026-11-23, on #4933: each affiliation badge on a shop's public page shows the
organization's official logo beside its text, shipped by DiveDay, for now. This reverses the
earlier text-only rule (`brandBadges` in `src/db/schema/core.ts`, the badge-wall rule in
[brand.md](../../design/brand.md)).

Legal review is not done and is tracked in [#4938](https://github.com/AaronBuxbaum/diveday/issues/4938):
whether DiveDay may host and display each mark on a member shop's say-so, each organization's
brand guidelines, and whether a shop must confirm the affiliation first. No legal approval is
inferred from this decision.

A mark that is not cleared falls back to the text badge. The fallback is one line per code:
delete the code from `BADGE_LOGOS` in `src/features/public-site/badge-logos.ts` and remove its file.

## What shipped

Each logo is the organization's own file, taken unaltered from its own website; the source URL and
date of every file are in `public/badges/SOURCES.md`. A code with no official file stays a text
badge: PADI (its site refuses automated requests), Green Fins (same) and Reader's Choice (no single
owner). The words always stay beside the logo, and DiveDay's own collateral still carries no agency
logo.
