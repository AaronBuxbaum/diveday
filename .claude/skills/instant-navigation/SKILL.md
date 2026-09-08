---
name: instant-navigation
description: Build routes that paint instantly under Next 16's static-shell enforcement — loading.tsx boundaries, instant = true, layout rules, redirects, and cacheComponents state. Use when adding or restructuring any page or layout, when `next build` fails with blocking-prerender-*, or when a redirect or client navigation misbehaves.
---

# Instant navigation (Next 16 static shells)

This app runs Next 16.3 with `cacheComponents`, and its framework behavior differs from training
data — when in doubt, read the installed docs at `node_modules/next/dist/docs/`, not memory. The
rules below are the ones sessions have already gotten wrong, each with the shipped fix.

## The contract for every new page

1. **`export const instant = true`** on the page — the written claim that it paints without
   waiting on the request (ADR `20260804-instant-navigation`).
2. **A body-shaped `loading.tsx` in the segment.** That file *is* the `<Suspense>` boundary: it
   is what a client navigation into the segment paints while request-scoped reads stream in.
   Shape it like the body it stands in for (`animate-pulse` wrapper, `bg-surface-sunken` bars,
   `border-border bg-surface` cards) — never a spinner. Copy the pattern from a sibling segment.
3. `next build` enforces this: a route with no explicit `instant = false` above it must produce a
   non-empty static shell or the build fails with `blocking-prerender-dynamic` /
   `blocking-prerender-client-hook`, naming the component. That failure is the feature working —
   fix the boundary, don't reach for `instant = false`.

## Layouts are where instant dies

- **Never put an `await` above `{children}` in a `layout.tsx`.** No boundary can be placed
  between a layout and its page, so one request-scoped read there costs every route beneath it
  its static shell. Put the read in an async child component inside its own `<Suspense>` with a
  height-holding fallback. (This is how the bearer-token pages — the ones divers open from a text
  on marina Wi-Fi — were once all blocked by a locale read that only fed an error boundary.)
- `instant = false` survives on exactly one layout: `src/app/shop/[shopSlug]/trips/[id]/layout.tsx`.
  Do not add a second without an ADR-level reason. The staff shell used to be one, on the grounds
  that its cross-tenant `notFound()` had to run before `{children}` — the App Shell restructure
  (issue 1446) moved that gate into `_components/ShopChrome.tsx` alongside the reads it protects,
  which is safe because it was never the only copy: every staff page gates itself too, and every
  piece of chrome that could name another tenant is already behind `ownShop`. A security gate is a
  reason to double a refusal, not a reason to block every route beneath it.

## Redirect routes are Route Handlers, not pages

`permanentRedirect()` from a **page body** answers **200, not 308** under `cacheComponents` —
measured in ADR `20260806-one-trip-create-form`, then found still shipped in three other stubs
whose comments claimed otherwise (removed in the 2026-08-06 review). A legacy-URL redirect is a
`route.ts` Route Handler emitting a literal 308, with a request-level status assertion
(`expect(response.status()).toBe(308)`) in its spec, and it still re-checks the session
server-side per ADR-0006. Copy an existing one: `src/app/shop/[shopSlug]/trips/new/route.ts`.

## Client navigation races the skeleton

A `<Link>` navigation "arrives" at the segment's `loading.tsx` first; the page's own content
streams in after. Two consequences sessions have paid for:

- **In e2e**: asserting (or crawling) right after a navigation can run against the linkless
  skeleton. Wait for an element that exists only on the destination page's real body — see the
  `debug` skill ("A race is fixed by naming what you wait for") and `pnpm check:e2e-hygiene`.
- **In the app**: a `<Link>` transition does not run the browser's fragment scroll or reset
  focus; `src/components/ScrollToHash.tsx` exists for the anchor case.

## A static shell paints a control before React owns it

The moment a route gains a static shell, its buttons are on screen and clickable while their
handlers are still on the way. A click that lands in that window is **swallowed in silence** — no
error, no effect, and fifteen seconds later a spec times out on something behind a door that never
opened. It only bites a control whose whole behaviour is client-side (a disclosure opened by React
state, a search that debounces, a toolbar that rewrites the query): a link and an uncontrolled form
work perfectly well without JavaScript, which is why most of the suite never noticed.

This window was closed by accident on `/shop/**` until issue 1446, because nothing painted until
the server had finished. Giving the staff surfaces a shell is what made it real, and the first
thing to find it was `e2e/gear.spec.ts` on a loaded CI shard — measured at 53ms on an idle local
machine, and long enough to fail there.

The answer is the flag this repo already uses: a `hydrated` state set in an effect, published as
`data-hydrated` on the element the suite interacts with (`CheckInSearch`, `OrdersToolbar`,
`CrewSection`, `BookingPartyFields`, …), and `await expect(el).toHaveAttribute("data-hydrated",
"true")` before the click. **Expect to add one whenever you give a surface a shell**, and reach for
it rather than for a wait on something that merely happens to appear later.

## cacheComponents can re-render your state away

A page under `cacheComponents` can get a second, fresher render of its dynamic content below its
`<Suspense>` boundary — up to ~1s after first paint looks interactive — silently discarding
client state (a ticked checkbox) held in the page body. State that must survive a same-route
mutate-then-redirect belongs in the segment's `layout.tsx` (which stays mounted across that
re-render), with a `usePathname()`-keyed reset effect so it still clears on real navigation. See
ADR `20260801-cache-components-activity-state` and the `debug` skill's remount section before
inventing a wait.

## Verifying

`pnpm build` proves the static-shell claims (it fails by route name when one is broken). For the
paint itself, a filtered visual-spec run or `node scripts/screenshot.mjs <path>` shows what the
skeleton actually looks like — a `loading.tsx` that doesn't hold its height causes layout shift
you can see in the capture.
