# i18n copy: adding a new surface

Part of the **i18n-copy** skill ([SKILL.md](SKILL.md)). Read it before writing the first string of a new page or component: the Spanish in the same change, the voice both languages are held to, and the pattern for Server, staff Client and diver Client components.

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
which stays English pending H-20260730-jurisdiction-waiver-text-medical/H-20260724-current-typed-name-explicit and is not a translator's call.

**Both languages are held to the same voice.** A sentence a language model would write (an em-dash
pivot, "not a project, a file", *actually*, "Here's how") fails `pnpm check:voice` in either
bundle; the list and the reasoning are "What gives us away" in `docs/design/brand.md`. Write the
sentence plainly in English first and the Spanish follows the same shape.

Writing an `error.tsx`? It is a file convention with a fixed `{error, reset}` signature, so no
Server Component can hand it a `copy` prop. Its words come from the segment's own `layout.tsx`
mounting `DiverIntlProvider` with `namespaces={["errorBoundary"]}` — four strings, not the bundle.
`scripts/check-intl-providers.mjs` fails if you forget.

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
