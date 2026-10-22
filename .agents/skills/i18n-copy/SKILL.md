---
name: i18n-copy
description: Route on-screen copy through a message bundle and extract hard-coded English. Use when adding or editing any string a person reads, when `pnpm check:copy` fails, or when working the copy baseline.
---

# Copy goes in a bundle, never in a component

Every word a person reads comes from `src/i18n/locales/<locale>/*.json`. Two bundles:

| Bundle | Surface | Translator | Client components |
| --- | --- | --- | --- |
| `diver.json` | public schedule, trip, course, `/waivers`, `/ready`, `/recap` | `diverTranslator(locale)` | yes — under `<DiverIntlProvider>`, via `useTranslations()` |
| `staff/<namespace>.json` | `/shop/**` | `staffTranslator(locale)` | **no** — pass words in as props |

Decisions: [20260729-diver-copy-localization](../../../docs/architecture/decisions/20260729-diver-copy-localization.md),
[20260730-staff-copy-localization](../../../docs/architecture/decisions/20260730-staff-copy-localization.md),
[20260803-error-boundary-copy-bridge](../../../docs/architecture/decisions/20260803-error-boundary-copy-bridge.md).

`pnpm check:copy` enforces this for `src/app`/`src/components` (`.tsx` and colocated `.ts`).
`pnpm check:domain-strings` enforces the same rule for `src/lib`/`src/db` — see
[Copy that is not in a component](beyond-components.md#copy-that-is-not-in-a-component). Both are ratchets over
the `copy` and `domain-strings` sections of `scripts/ratchets.json`: each currently sits at zero
(the full-app and full-domain-layer extractions are both done — ADRs
[20260730-frontend-strings-i18n-extraction](../../../docs/architecture/decisions/20260730-frontend-strings-i18n-extraction.md)
and
[20260731-domain-layer-copy-leaks](../../../docs/architecture/decisions/20260731-domain-layer-copy-leaks.md)),
so in practice both checks are plain gates today: a file with hard-coded copy fails outright, with
no allowance to add some and extract later.

## Extracting an existing file

```bash
node scripts/check-copy.mjs --report src/app/shop/[shopSlug]/reports   # what it sees, line by line
```

1. Add the keys to **both** `en-US` and `es-ES` bundles. `check:locale` fails on a missing
   translation or a mismatched ICU placeholder, so do them together.
2. Replace the literals. Group keys by surface (`staffing.coverage.heading`), not by component.
3. `node scripts/check-copy.mjs --write` to lower the baseline. It refuses to raise a number.
4. `pnpm check:locale && pnpm check:copy && pnpm typecheck`.

Use ICU for plurals — `"{count, plural, one {# gap} other {# gaps}}"` — never string concatenation,
which does not survive translation.

## Reference

- [new-surface.md](new-surface.md) — a new page or component: write English and Spanish together, and the pattern for each component kind.
- [beyond-components.md](beyond-components.md) — copy from the domain layer (codes, not sentences), non-component copy, and what is genuinely exempt.

## When `pnpm check:copy` or `pnpm check:domain-strings` fails

Both scripts share the same messages and flags; substitute `check-domain-strings.mjs` and
`domain-strings` section for `src/lib`/`src/db` work.

| Message | What to do |
| --- | --- |
| `…in a file with no baseline entry` | New copy. Extract it — do not add a baseline entry by hand. |
| `baseline allows N` | You added copy to a legacy file. Extract the new strings. |
| `down to N from M` | You improved a file. Run `--write` to bank it. |
| `fully extracted or gone` | Run `--write` to drop the stale entry. |

### After merging `main`

A merge can raise a count without you writing a word of copy — another branch
edited a file that is still in the baseline. `--write` refuses that growth (it
cannot tell whose copy it is), so use:

```bash
node scripts/check-copy.mjs --absorb            # or check-domain-strings.mjs --absorb
```

It writes the baseline and **prints every increase it accepted**, so the growth
shows up in the run log and as a number in the diff. Only reach for it
immediately after a merge; if you did not just merge, the growth is yours and
the answer is to extract it.
