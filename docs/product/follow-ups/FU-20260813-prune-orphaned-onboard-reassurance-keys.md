# FU-20260813-prune-orphaned-onboard-reassurance-keys — Delete the onboard copy keys nothing renders any more

- **Status:** Open
- **Raised:** 2026-08-13 — the entry-doors redesign (branch `claude/design-entry-doors`)
- **Kind:** cleanup
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`

## What I noticed

The onboard redesign compressed the sign-up form's three boxed reassurance paragraphs to their
one-line leads and replaced the long `exploreNote` sentence with the shorter `demoNote`. The
*lead* keys still render (one quiet line under the submit button, pinned by
`e2e/marketing.spec.ts`), but seven keys now render nowhere in the app and still ship in every
diver bundle: `account.onboard.exploreNote` and the three `account.onboard.reassurance.*.body`
strings (in both locales). A future editor grepping the bundle will reasonably believe those
sentences appear on a page somewhere, because `pnpm check:locale` verifies coverage, not orphans.

## Why it isn't already done

Fifteen design branches were in flight from the same base when this was raised, and the working
agreement for that window was bundles-append-only — deleting keys mid-flight invites conflicts
and could break a sibling that happened to reference them. Pruning is safe only once the parallel
design PRs have all merged.

## Proposed change

After the design-PR wave merges: grep to confirm nothing references
`account.onboard.exploreNote` or `account.onboard.reassurance.noCard.body` /
`.yourRecords.body` / `.supportLine.body`, then delete those keys from **both**
`en-US/diver.json` and `es-ES/diver.json` in one change (the `.lead` keys stay — they render).
Not proposing any change to what the onboard page displays; that composition is settled and
tested.

## Prompt

```text
In the DiveDay repo, read src/app/onboard/page.tsx and confirm which account.onboard.* keys it
still reads (the reassurance *.lead keys and demoNote render; exploreNote and the *.body keys
should not). Grep src/ for account.onboard.exploreNote and each account.onboard.reassurance.*.body
key; if nothing references them, delete those keys from BOTH src/i18n/locales/en-US/diver.json and
src/i18n/locales/es-ES/diver.json in the same commit (locale parity is enforced). Run pnpm check
and E2E_WORKERS=1 pnpm e2e:run e2e/marketing.spec.ts e2e/onboard.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260813-prune-orphaned-onboard-reassurance-keys.md as part of the
change.
```
