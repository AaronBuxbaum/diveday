# 20260812-reader-chosen-language — A reader picks their own language, in a cookie, never in the URL

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

ADR 20260729-diver-copy-localization decided there would be **no language switcher**: the language
was a property of the shop row (`shops.default_locale`) plus whatever the visitor's device asked for
in `Accept-Language`, and a `/es/` path segment was rejected because it would imply a per-visitor
choice that did not exist.

Two of its premises turned out to be wrong in practice.

- **A device's header is not a person's preference.** A diver on a borrowed phone, a hotel tablet,
  or a handset someone else configured is shown a language they may not read, with nothing on the
  page to do about it. The only acknowledgement we ever built was the "you asked for a language we
  don't have" notice (review finding I18N-L1), which is honest and useless to the diver whose
  device asked for a language we *do* have — the wrong one.
- **Staff were left out entirely.** `/shop/**` negotiates from the same header
  (ADR 20260730-staff-copy-localization), so a Spanish-speaking staffer at a shop whose browser is
  English gets an English back office and no way to change it. "Ask whoever set up this laptop" is
  not an answer a dive shop can give.

The original ADR's *real* objection still holds and is not disturbed here: a locale in the path
forks every public URL, every canonical link, every share, and every sitemap entry, for an app whose
public pages are a shop's storefront.

## Decision

1. **The choice is a cookie, not a URL.** `diveday_locale` (`src/i18n/locale-cookie.ts`), a year
   long, `SameSite=Lax`, `HttpOnly` — nothing in the browser reads it, because the words are chosen
   during the server render. A shop's schedule keeps exactly one address.

2. **`src/i18n/request.ts` is the one place precedence lives**, and the order is: the reader's own
   choice → `Accept-Language` → the shop's `default_locale`. A cookie naming a locale we have no
   bundle for reads as *no choice*, not as a missing bundle — it is client-held state, so the
   reader re-validates it and never trusts that the writer was the last thing to touch it.

3. **An explicit choice is first-hand evidence.** `requestFirstHandLocale` (which decides what
   language we may *remember* about a person, ADR 20260731-per-person-notification-locale) prefers
   the cookie over the header: a deliberate pick says more than a device setting. And
   `requestLanguageFallback` returns null once a choice exists — telling someone we fell back to a
   language they explicitly asked for would be the app arguing with a decision it just honoured.

4. **Three doors, all rendering each language as its own name.** The public shop header beside the
   shop's name, the staff header's shop-name menu, and the command palette (Search). Options read
   "English" / "español", resolved from CLDR (`localeEndonym`), never from a message bundle: the
   reader most likely to need this control is the one who cannot read the label above it.

5. **Writing it is a Server Action** (`src/app/actions/set-locale.ts`), not a GET route. A link that
   changes stored state is a link a preloader or a link-preview fetch can follow on the reader's
   behalf. It `revalidatePath("/", "layout")` afterwards, because every rendered page holds words in
   the old language and the words are chosen on the server.

## Alternatives considered

- **An `/es/` route segment or `?lang=`.** The original ADR's objection, unchanged: it forks every
  public URL and every canonical link for a storefront.
- **Store it on the person row.** Only works for someone we have identified, which excludes the
  anonymous diver comparing two shops — the exact reader this exists for. The per-person column
  still exists and still governs *notifications*; this governs *rendering*.
- **`localStorage` plus a client-side swap.** Staff copy is server-side by design and never crosses
  to the client as a bundle; a client swap would mean shipping both bundles to every visitor.
- **Leave it to the browser and keep only the fallback notice.** That is the status quo this
  replaces; it tells a diver we cannot help and offers nothing.

## Consequences

- Every page that calls `requestLocale` now reads `cookies()` as well as `headers()`. No route
  changes classification: any caller already read `headers()`, so already opted into dynamic
  rendering. It does add one more reason the marketing pages cannot go static under
  `cacheComponents` — the `"use cache"` restructuring described in `request.ts` now has two
  request-scoped inputs to key on rather than one.
- A shared device accumulates one person's choice for a year. Acceptable for the shop counter (the
  next staffer switches it back in two taps, and it is in the same menu as Sign out); it is the
  reason the cookie is not written on mere *negotiation*, only on a deliberate pick.
- **Supersedes** the "no switcher" clause of ADR 20260729-diver-copy-localization. That record's
  no-`[locale]`-route decision stands and is reaffirmed above.
- Escape hatch: if a shop ever needs to *force* its own language (a single-language storefront where
  a stray cookie is worse than a wrong language), the precedence chain in `request.ts` is one
  function and the shop row already carries the column to gate on.
