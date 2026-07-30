---
name: i18n-copy
description: Write user-facing copy so it goes through a message bundle, and extract existing hard-coded English. Use whenever adding or editing any string a person reads on screen, when `pnpm check:copy` fails, or when working through the copy baseline.
---

# Copy goes in a bundle, never in a component

Every word a person reads comes from `src/i18n/locales/<locale>/*.json`. Two bundles:

| Bundle | Surface | Translator | Client components |
| --- | --- | --- | --- |
| `diver.json` | public schedule, trip, course, `/waivers`, `/ready`, `/recap` | `diverTranslator(locale)` | yes — under `<DiverIntlProvider>`, via `useTranslations()` |
| `staff.json` | `/shop/**` | `staffTranslator(locale)` | **no** — pass words in as props |

Decisions: [20260729-diver-copy-localization](../../../docs/architecture/decisions/20260729-diver-copy-localization.md),
[20260730-staff-copy-localization](../../../docs/architecture/decisions/20260730-staff-copy-localization.md).

`pnpm check:copy` enforces this. It is a **ratchet**: `scripts/copy-baseline.json` holds the
~1,000 strings not yet extracted, and that number may only go down.

## Adding a new surface

Build it clean — a new file has no baseline entry, so *any* hard-coded string fails the check.

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
and `src/components` choose words. An English string returned from a query is copy no scanner sees
and no translator reaches.

```ts
// src/db/staffing.ts
export type StaffingGapCode = "no_crew" | "course_needs_instructor" | "no_shift_coverage";
```

```tsx
// the page
<li>{t(GAP_KEYS[gap])}</li>
```

This is the scanner's known blind spot — it only reads `.tsx` under `src/app` and `src/components`
— so it is on you in review.

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

Not exempt: marketing pages. They are English-by-design today and sit in the baseline like
everything else, because the count has to be honest.

## When `pnpm check:copy` fails

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
node scripts/check-copy.mjs --absorb
```

It writes the baseline and **prints every increase it accepted**, so the growth
shows up in the run log and as a number in the diff. Only reach for it
immediately after a merge; if you did not just merge, the growth is yours and
the answer is to extract it.
