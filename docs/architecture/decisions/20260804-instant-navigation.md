# 20260804-instant-navigation — Every page asserts `instant = true`; only a shell that cannot be instant declares `false`

- **Status:** Accepted
- **Date:** 2026-08-04
- **Amended:** 2026-08-12 — a consequence of this decision that nobody had written down: a page whose
  content sits behind a `loading.tsx` Suspense boundary streams inside a hidden staging div that an
  inline script relocates, so a browser with scripting disabled sees the skeleton and never the page.
  Since this ADR requires that boundary of every route, it makes JavaScript a requirement of the whole
  app. That is now stated, and the fallbacks written against the opposite assumption are gone —
  20260812-javascript-is-required.
- **Amended:** 2026-08-14 — a fallback may not be the page. `/`, `/product` and `/pricing` earned
  their instant paint by passing their **whole body, in the default locale**, as the `<Suspense>`
  fallback for the negotiated-locale one. It paints real content, and it costs the visitor
  everything they did to that subtree before the real body resolves: React carries no DOM state
  across a replaced subtree, and for an en-US reader the two renders are identical copy, so the
  swap is invisible in every screenshot and every English-pinned assertion while still tearing the
  DOM down. It cost a `<details>` its open state (a CI-only failure in `e2e/marketing.spec.ts`,
  PR #473) and then, once that disclosure was deleted, cost an `es-ES` reader their scroll position
  when they tapped `/product`'s anchor strip early
  (FU-20260812-marketing-suspense-swap-discards-interaction). So: **a fallback holds shape, never
  interaction.** `/product` and `/pricing` now render their body once behind an ordinary
  body-shaped `loading.tsx`, exactly as rule 1 has it. `/` renders its body once behind an in-page
  `<Suspense>` with the same kind of skeleton, because the *root* segment is the one place
  `loading.tsx` is not segment-scoped — `src/app/loading.tsx` would become the boundary for
  `/switching/**`, `/sign-in`, `/about` and `/offline-manifest` as well. The regression guard is the
  `Accept-Language: es` describe at the end of `e2e/marketing.spec.ts`: it records, from an init
  script, whether default-locale body copy is *ever* in the document for a Spanish reader.

## Context

Forty-six of this app's fifty-odd pages carried `export const instant = false`.
[20260803-instant-opt-out-placement](20260803-instant-opt-out-placement.md) established what those
lines actually did — they are not dead code, and they are not a TODO — and then said the honest
thing about them:

> The remaining 46 page-level declarations are not removable by deletion; each is removable only by
> giving that page a real `<Suspense>` boundary, which is a separate, larger, individually-verified
> change.

This is that change. Nothing here contradicts that ADR's reading of the framework; it takes the
route it named and walks it.

Two mechanisms matter, both read from the installed Next 16.3 rather than from prose
(`server/app-render/instant-validation/instant-config.js`, and
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`):

1. **Static-shell enforcement is already a hard build error, and it needs no experimental config.**
   `isPageAllowedToBlock(tree)` walks from the root and returns at the **first** explicit `instant`.
   Its result becomes `allowEmptyStaticShell`. A route with **no** `instant = false` anywhere above
   it must produce a non-empty static shell or `next build` fails with `blocking-prerender-dynamic`.
   That is not a lint we opted into — it is why all forty-six declarations existed. Deleting one is
   therefore self-verifying: either the route genuinely paints without waiting on the request, or
   the build says so by name.

2. **A layout is the one place `<Suspense>` cannot help.** `loading.tsx` wraps `page.tsx` and
   everything below it, but not the layout in its own segment. A layout that `await`s anything
   request-scoped sits *above* `{children}`, so the page cannot render until the layout has, and no
   boundary can be placed between them. One `await` in a layout costs every route beneath it its
   static shell. Next's own `layout.js` docs say the fix in as many words: "wrap runtime data access
   in your layout in its own `<Suspense>` boundary."

The second point is what made the backlog look bigger than it was. Nine routes — the seven
bearer-token pages (`/waivers`, `/ready`, `/recap`, `/verify`, `/reset-password`, `/unsubscribe`,
`/invite`) and the whole public shop namespace `/s/[shopSlug]/**` — were blocked not by anything on
the page but by a layout whose entire body was a `DiverIntlProvider` needing `await requestLocale()`
to hand four strings to an `error.tsx`
([20260803-error-boundary-copy-bridge](20260803-error-boundary-copy-bridge.md)). The most valuable
static shells in the app — the pages divers reach from a text message, on marina Wi-Fi — were being
held by a `headers()` read for copy that renders only when something has already gone wrong.

## Decision

**Three rules, and one unblocking change that makes them applicable.**

### 1. A page declares `instant = true` and earns it with a `<Suspense>` boundary

All forty-six page-level `instant = false` declarations become `instant = true`, and the fifteen
pages that never carried a declaration at all — the marketing pages, `/sign-in`, and the handful of
staff routes that were already built around their own `<Suspense>` — get the same claim written out,
so all sixty-one say what they intend rather than sixty-one minus whichever ones once needed an
opt-out. Every route segment that lacked a boundary gets a body-shaped `loading.tsx` — twenty-eight
new ones, joining the twenty-one this repo already had. `loading.tsx` rather than an inline
`<Suspense>` inside each page, because it is the
same boundary with none of the per-page restructuring: it wraps the page whole, it is what a client
navigation into the segment paints, and it is a file a designer can open and see.

`instant = true` is not strictly required — with no config at all, a page segment is implicitly
validated anyway. It is written out because it is the *claim*: this page is expected to paint
immediately, and a future `validationLevel: 'manual-warning'` (rejected in the previous ADR
precisely because nothing opted in explicitly) is now a live option rather than an app-wide switch-off.

### 2. A layout declares `instant = false` only when it genuinely cannot be instant, and says why

One layout still does: `src/app/shop/[shopSlug]/layout.tsx`. It reads the session, the shop row, and
two pending-work counts, and — the part that cannot move — it enforces the cross-tenant invariant
with `notFound()` **before** rendering `{children}`
(`e2e/tenant-isolation.spec.ts`). Wrapping that check in `<Suspense>` would let a staff page render
under a foreign shop's slug while the refusal was still resolving. That is a security gate on a
safety-critical surface, and a static shell is not worth restructuring it for on this change's
evidence; see *Alternatives considered*.

`src/app/shop/[shopSlug]/waivers/layout.tsx` and `.../trips/[id]/layout.tsx` keep theirs untouched,
exactly as the previous ADR's amendment left them.

This is the arrangement Next documents for a shell that cannot be instant:

> if a shared layout cannot load instantly but you still want to assert that pages beneath this
> layout can be navigated to instantly, you can ensure that the pages have `instant = true` while
> the shared layout has `instant = false`.

So `/shop/**` pages assert the navigation staff actually make all day — arriving from another
`/shop/**` page, where the shell is already mounted and the segment's `loading.tsx` is what paints —
while a cold direct visit still blocks at the shell. Every other route in the app gets the stronger
thing: a real static shell, enforced by the build.

### 3. Error-boundary copy crosses to the client, so its layout can be synchronous

The seven bearer-token layouts and the `/s/[shopSlug]` shell no longer call `requestLocale()`.
`ERROR_BOUNDARY_MESSAGES_BY_LOCALE` (`src/i18n/error-boundary-messages.ts`) hands **both** locales'
`errorBoundary` section — about 600 bytes, against ~500 for the single locale the server used to
pick — to `ErrorBoundaryIntlProvider` (`src/i18n/ErrorBoundaryIntlProvider.tsx`), a Client Component
that chooses between them from `document.documentElement.lang`.

That attribute is not a guess. The root layout's inline `localeCorrectionScript`
(`src/i18n/lang-script.ts`) already sets it before first paint from `navigator.languages`, using the
same two-pass match as `src/i18n/negotiate.ts` — the same list the browser builds its
`Accept-Language` header from. So the boundary still follows *the reader's own device language*,
which is what 20260803-error-boundary-copy-bridge decided it should do. Only where that choice is
made has moved, and it moved for a reason that ADR could not have weighed: it did not know the read
was costing nine routes their static shell.

The pick runs in an effect so the server render and the first client render agree on
`DEFAULT_DIVER_LOCALE` and nothing hydration-mismatches. Nothing under the provider reads copy
unless the boundary is showing, so the one-frame default is invisible in the happy path.

The `error.tsx` files are untouched: they still call `useTranslations("errorBoundary")`, and the
words still live in `src/i18n/locales/**` — which is what
20260803-error-boundary-copy-bridge's rejection of "read `document.documentElement.lang` and pick
from an inlined table" was protecting. Nothing is inlined here; only the *selection* is client-side.
`src/i18n/provider-coverage.test.ts` learned the second provider so the blank-page guard still
covers all ten boundaries.

## Alternatives considered

- **Delete the page-level declarations and stop there** — what the previous ADR ruled out, correctly.
  Under a `false` shell it is build-neutral, and everywhere else the build simply fails. It buys
  nothing without the boundaries.
- **`experimental.instantInsights.validationLevel: 'experimental-error'` as a CI gate** — tried, and
  rejected on evidence. It does add build-time validation of *client navigations*, which rule 1's
  build error does not cover. But it demands an `unstable_samples` block (sample `params`, `headers`,
  `cookies`) on every validated route, which is fifty declarations against an explicitly `unstable_`
  API for a check the dev overlay already gives. The framework default `'warning'` stays.
- **Restructure `/shop/[shopSlug]/layout.tsx` too, moving the tenant gate into `src/proxy.ts`** —
  genuinely attractive: the session JWT already carries `shopSlug` (`src/lib/auth.config.ts`), so
  the gate could run at the edge with no database read, *earlier* and stronger than it does now, and
  the whole staff namespace would gain a static shell. Not taken here. It converts a rendered
  `notFound()` into an edge refusal, which changes what `e2e/tenant-isolation.spec.ts` asserts on
  nineteen paths, and the previous ADR's amendment records two CI runs where touching layouts in
  exactly this subtree correlated with unexplained intermittent hydration-shaped failures. A
  security gate on manifests and medical flags is not the place to bundle a performance change.
  It wants its own change, its own `security-reviewer` pass, and its own CI evidence.
- **Keep the error-boundary provider and give it a `<Suspense>` whose fallback is `{children}`** —
  children would render twice and remount when the boundary resolved, re-running every mount effect
  on the page for the sake of a shell. Rejected.
- **Give the seven bearer-token layouts `instant = false` instead** — correct, cheap, and what this
  change would have done if rule 3 had proved hard. It leaves the app's most latency-sensitive
  public pages without a shell to save one component.
- **A shared `<Skeleton>` primitive for the forty-nine `loading.tsx` files** — considered and not
  done. The twenty-one that already existed share a house style (an `animate-pulse` wrapper,
  `bg-surface-sunken` bars, `border-border bg-surface` cards) that reads well and is already
  pixel-stable under visual regression; the twenty-eight new ones match it. Introducing a primitive
  would either fork the idiom or rewrite twenty-one stable baselines for no user-visible gain.

## Consequences

Makes easy: knowing whether a new page is instant, without reading this file. Write the page, add a
`loading.tsx`, declare `instant = true`; if the route has no `false` shell above it, `next build`
audits the claim. Deleting a skeleton, or slipping an `await` above `{children}` in a layout, now
fails a build instead of quietly costing a shell.

Makes hard: adding a request-scoped read to a shared layout. That is the intended direction — it is
the single most expensive thing you can do to a route's paint, and it should require a `<Suspense>`
boundary and a fallback that holds its own height.

Costs: two duplicated `getShopBySlug` reads on `/s/[shopSlug]` (the chrome and the footer each
resolve the shop) where the old layout read it once. They are two indexed lookups on the same row
inside one request and they run concurrently rather than in series, which is the trade for the
footer not holding the header's paint. Revisit with a request-scoped memo if it ever shows up in a
trace.

Commits us to: `loading.tsx` as the boundary of record for a page. A route that wants finer
granularity — a header that paints before its table — puts its own `<Suspense>` inside the page, as
`/sign-in`, `/shop/[shopSlug]/trips/new`, `.../trips/[id]/guests`, and `.../dive-sites/new` already
do; the segment file stays as the floor.

Revisit when: the staff shell's tenant gate moves to the edge (the third alternative above), which
would leave `instant = false` in this codebase only where a layout is genuinely, permanently
request-bound — or when `instant` graduates from experimental and the resolution rules change, at
which point re-verify both mechanisms against `instant-config.js` rather than against this file.
