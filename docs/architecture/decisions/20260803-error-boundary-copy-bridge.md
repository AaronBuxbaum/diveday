# 20260803-error-boundary-copy-bridge — Resolve error-boundary copy in the segment layout, not the boundary

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

Ten `error.tsx` boundaries carried an `i18n-exempt-file` comment saying the same thing: `error.tsx`
is a Next file convention with a fixed `{error, reset}` prop signature, the framework instantiates
it directly, so no Server Component can hand it a `copy` prop the way every other page's words
arrive. Seven of them are bearer-token routes — `/waivers`, `/ready`, `/recap`, `/verify`,
`/reset-password`, `/unsubscribe`, `/invite` — reached from a text message or an inbox by exactly
the diver the English-only waiver notice (H-01/H-03) already worries about. The 2026-08-02 review
raised it as I18N-3: deferred in comments, tracked nowhere.

The comments assumed the fix was expensive: "wrapping this route in a `DiverIntlProvider` ships the
diver bundle to the client on every visit, not just the rare one that errors." That premise expired.
`DiverIntlProvider` now takes a **required** `namespaces` list and serializes only those sections
(`messagesForNamespaces`, `src/i18n/messages.ts`), so the cost of a provider is the cost of the
namespaces you name, not the ~80 KB bundle.

The other premise was wrong outright. `error.tsx` is *not* the outermost thing in its segment: Next's
component hierarchy is `layout` → `template` → `error` → `loading` → `page`, and the docs are
explicit that `error.js` "does not wrap the `layout.js` or `template.js` above it in the same
segment." A layout is a Server Component that renders **above** the boundary — it can negotiate the
locale and put words into React context that the client boundary reads.

## Decision

**Boundary copy is resolved in the layout above the boundary.**

For the seven diver bearer-token routes, each gets a `layout.tsx` whose whole job is one element:

```tsx
<DiverIntlProvider locale={await requestLocale()} timeZone="UTC" namespaces={["errorBoundary"]}>
```

and its `error.tsx` becomes a `useTranslations("errorBoundary")` consumer. The namespace is four
strings (`title`, `bodySaved`, `bodyDone`, `tryAgain`) in `diver.json`, in both locales.

Three things about the shape, each load-bearing:

- **`requestLocale()` takes no shop default.** The shop sits behind the bearer token, which only the
  page resolves; re-reading it in the layout would double the token lookup on every visit to improve
  the rare visit that errors. The boundary therefore follows the reader's own `Accept-Language` and
  falls back to English — the right default for a page whose only job is telling *this reader*
  something broke, and already what `/verify`, `/invite`, `/unsubscribe`, and `/reset-password` do
  on their happy path.
- **`timeZone` is a fixed `"UTC"`.** The `errorBoundary` namespace holds no date, time, or money, so
  nothing under this provider formats against it. It is passed anyway because omitting *any*
  `NextIntlClientProvider` prop makes it reach for a `getRequestConfig` module DiveDay does not
  install — the blank-page failure described in `src/i18n/DiverIntlProvider.tsx`.
- **The provider element is written out in each layout rather than hidden behind a shared wrapper.**
  Seven near-identical files is the Next file-convention tax; a wrapper would hide from a reader —
  and from `src/i18n/provider-coverage.test.ts` — exactly which namespaces cross to the client.

**Staff boundaries stay English, by decision rather than deferral.** `/shop/[shopSlug]/error.tsx`
and `/shop/[shopSlug]/trips/[id]/error.tsx` cannot use this mechanism: there is no
`StaffIntlProvider`, and staff copy deliberately never crosses to the client as a bundle
(`src/i18n/staff-messages.ts` states why — one global `AppConfig.Messages` augmentation, and staff
words have no business in an anonymous visitor's payload). The staff-shaped version of this same
decision is a `copy`-prop context: `staffTranslator` resolves three strings in
`shop/[shopSlug]/layout.tsx`, a small client provider carries them down, no bundle ships. That is
the change those two files are waiting on, and their exemption comments now say so.
`/s/[shopSlug]/error.tsx` is the one diver surface still on the old footing for a purely mechanical
reason: its layout already resolves `locale` and the shop's timezone, so finishing it is one
`DiverIntlProvider` wrap plus a new key for its "Nothing was booked" body.

`global-error.tsx` is permanently exempt and unchanged: it *replaces* the root layout, so by
construction nothing can render above it.

Guarding it: `src/i18n/provider-coverage.test.ts` walks `src/app` and fails when a Client Component
calls `useTranslations()` with no `DiverIntlProvider` in an ancestor segment, or when the provider's
`namespaces` list omits one the component asks for. That is the footgun in
`DiverIntlProvider.tsx`'s doc comment — a missing provider throws during the *server* render and
degrades the page to a blank client-only 200 — which nothing in `pnpm check` could previously see.

## Alternatives considered

- **Wrap each route in a full `DiverIntlProvider`** (the option the old comments imagined and
  rejected) — the rejection was right and is now moot: `namespaces` makes the same provider cost
  four strings instead of 80 KB, so the chosen decision *is* this option, correctly priced.
- **Leave them English** — cheapest, and defensible for staff, but not for a diver who reached
  `/waivers/<token>` from a Spanish-language SMS; a page whose entire content is an apology is the
  worst place to switch languages on someone.
- **A bespoke `ErrorBoundaryCopyProvider`** carrying three resolved strings through a hand-rolled
  React context — no smaller than the namespace-narrowed provider, but a second copy-delivery
  mechanism to keep correct, typed, and reviewed. Rejected for the diver side; it is precisely what
  the staff side needs, because staff have no first mechanism to reuse.
- **Read `document.documentElement.lang` in the client boundary and pick from an inlined table** —
  no provider needed, but the words would live in a component instead of a bundle, which is the one
  rule `pnpm check:copy` exists to hold.
- **A `template.tsx` instead of a `layout.tsx`** — also renders above the boundary, but re-runs on
  every navigation within the segment to buy nothing.

## Consequences

Makes easy: translated copy on any client-only file convention, by resolving it one segment up. A
new bearer-token route copies a twelve-line layout. Adding a fifth boundary string is a bundle edit,
not a plumbing change.

Makes hard / commits us to: seven extra `layout.tsx` files that exist only to hold a provider, each
needing `instant = false` because `requestLocale()` reads `headers()` under Cache Components. Each
route now has a layout, so a future genuine layout for one of these routes has to merge with it
rather than start clean. The boundary's language is the *device's*, not the shop's — a diver whose
browser is English booking at a Spanish-default shop gets an English error page; the ADR accepts
that as correct, but it is a visible difference from every other page on the route.

Escape hatch: if a route ever needs the shop's default locale on its boundary, the layout resolves
the token itself and passes `requestLocale(shop.defaultLocale)` — one DB read per visit, which is
the price and the reason it is not the default. If the staff `copy`-prop context lands and proves
pleasant, the diver side could migrate to it for uniformity; there is no reason to, and the
provider-coverage test would need a matching staff-side guard first.
