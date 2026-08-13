---
name: i18n-copy
description: Write user-facing copy so it goes through a message bundle, and extract existing hard-coded English. Use whenever adding or editing any string a person reads on screen, when `pnpm check:copy` fails, or when working through the copy baseline.
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
[Copy that is not in a component](#copy-that-is-not-in-a-component) below. Both are ratchets over
`scripts/copy-baseline.json` / `scripts/domain-strings-baseline.json`: each currently sits at zero
(the full-app and full-domain-layer extractions are both done — ADRs
[20260730-frontend-strings-i18n-extraction](../../../docs/architecture/decisions/20260730-frontend-strings-i18n-extraction.md)
and
[20260731-domain-layer-copy-leaks](../../../docs/architecture/decisions/20260731-domain-layer-copy-leaks.md)),
so in practice both checks are plain gates today: a file with hard-coded copy fails outright, with
no allowance to add some and extract later.

## Adding a new surface

Build it clean — a new file has no baseline entry, so *any* hard-coded string fails the check.

**You write the Spanish, in the same change as the English.** There is no translation queue and no
`TODO: translate` — `check:locale` fails on a key that exists in one locale and not the other, so a
string ships in both or not at all. Read
[`src/i18n/locales/es-ES/README.md`](../../../src/i18n/locales/es-ES/README.md) first: terminology
and register are already decided ("centro" for the shop entity, the retail-vs-entity split, LatAm
register, Caribbean names for marine life), so a new string should match rather than restart the
argument, and anything you settle that the file does not cover gets added to it in the same change.

The exception is copy with legal or medical weight — the waiver body and the medical questionnaire —
which stays English pending H-01/H-03 and is not a translator's call.

Writing an `error.tsx`? It is a file convention with a fixed `{error, reset}` signature, so no
Server Component can hand it a `copy` prop. Its words come from the segment's own `layout.tsx`
mounting `DiverIntlProvider` with `namespaces={["errorBoundary"]}` — four strings, not the bundle.
`src/i18n/provider-coverage.test.ts` fails if you forget.

**Server Component (the default for staff):**

```tsx
const locale = await requestLocale(shop.defaultLocale);   // negotiates Accept-Language
const t = staffTranslator(locale);
return <h1>{t("staffing.title")}</h1>;
```

Never `staffTranslator(shop.defaultLocale)` directly — that ignores what the reader's device asked
for. Format dates and money against the same `locale`, never a literal `"en-US"` (`pnpm check:locale`).

**Staff Client Component:** it cannot translate. The Server Component resolves every string and
passes them down as one `copy` object — see
`src/app/shop/[shopSlug]/settings/calendar/` for the worked example (`feed-panel-types.ts` types the
copy, `page.tsx` fills it, `CalendarFeedPanel.tsx` renders it).

**Diver Client Component:** wrap the whole page in `<DiverIntlProvider>` and call
`useTranslations()`. Wrap the *page*, not just the one component — a `useTranslations` call without
a provider above it throws during the server render and silently degrades the page to a blank 200.

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

## Copy that is not in a component

**A domain layer must return codes, not sentences.** `src/lib` and `src/db` state facts; `src/app`
and `src/components` choose words. An English string returned from a query is copy the JSX scanner
never sees — it reaches a page through a variable reference (`{blocker.message}`), not a string
literal — and `pnpm check:domain-strings` is what catches it instead
(`node scripts/check-domain-strings.mjs --report src/lib` to see what it sees, same workflow as
`check-copy.mjs`). A data module whose *job* is feeding words to pages doesn't get codes — it gets
message-bundle **keys** (`DiverMessageKey`-typed, the `src/lib/marketing.ts` pattern) and a place
in the script's `proseFreeFiles` list, which fails on any prose literal outright rather than
ratcheting. This was a real, previously-silent gap — see ADR
[20260731-domain-layer-copy-leaks](../../../docs/architecture/decisions/20260731-domain-layer-copy-leaks.md)
for the fourteen files it found on first run.

```ts
// src/db/staffing.ts
export type StaffingGapCode = "no_crew" | "course_needs_instructor" | "no_shift_coverage";
```

```tsx
// the page
<li>{t(GAP_KEYS[gap])}</li>
```

When the same code renders on both a staff and a diver surface, each caller gets its **own**
`Record<Code, MessageKey>` against its own bundle — the domain function never imports from
`src/i18n` or picks a bundle itself (see `src/i18n/readiness-labels.ts`'s
`CERTIFICATION_LEVEL_KEYS` vs `DIVER_CERTIFICATION_LEVEL_KEYS` for the worked example). A param
that needs interpolation and is itself a word, not a raw number (a certification-level name, an
agency name), gets resolved through its own key-map *before* being interpolated into the parent
template — never a raw code passed into `t()`.

`check-domain-strings.mjs` only flags object-literal properties named `message`, `label`, `text`,
`reason`, or `summary` holding a string-literal sentence — the same narrow discipline
`check-copy.mjs` uses for its `.ts` label-map scan. It will not catch every shape (a template
literal with `${}` interpolation reads as code and is skipped on purpose, to avoid false-positiving
on ordinary expressions), so a `_LABELS`-suffixed const or a new `.message` field is still on you in
review even when the scanner stays quiet. Content data that a shop or DiveDay authors directly as
data — course template `summary`/`overview` text, seeded course-path descriptions, migration-guide
marketing prose — is not this bug class; it's exempt the same way the waiver body is, with a stated
reason.

## Genuinely exempt

Each needs a stated reason; the check requires the text after the colon.

- `{/* i18n-exempt: reason */}` — that line and the next.
- `// i18n-exempt-file: reason` — the whole file.

Legitimate cases: a scanner false positive, a brand name, a code sample. Also exempt by
convention and needing no marker:

- **Static `metadata.title`** — Next resolves it before locale negotiation can run.
- **The waiver body and medical questionnaire** — legally reviewed wording; translating it is a
  sign-off decision (H-01/H-03 in [human-decisions.md](../../../docs/product/human-decisions.md)),
  not an engineering one.

Not exempt: marketing pages under `src/app`/`src/components`. They go through `diver.json` like
everything else on those routes. Also not exempt: **data modules that feed the UI.**
`src/lib/marketing.ts`, `src/lib/migration-guides.ts`, and `src/lib/demo-roles.ts` are
key registries — they hold `DiverMessageKey` values and structure (slugs, ordering, URLs,
the price figure), and the words live in the bundles under `marketing.features/price/export/
capabilities/guides.*`. These files are listed in `check-domain-strings.mjs`'s `proseFreeFiles`
and hard-fail on any prose literal without an `// i18n-exempt: reason` marker (reserved for
genuine non-language: proper names, cited document titles, currency figures). When a new data
module starts feeding words to a page, add it to `proseFreeFiles` in the same change.

**Adding any user-visible sentence means adding it to every locale's bundle at once** — there is
no English-first workflow; a key present in one locale and missing in another fails
`pnpm check:locale`.

## When `pnpm check:copy` or `pnpm check:domain-strings` fails

Both scripts share the same messages and flags; substitute `check-domain-strings.mjs` and
`domain-strings-baseline.json` for `src/lib`/`src/db` work.

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
