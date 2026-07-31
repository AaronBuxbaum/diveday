# Specialist optimization audit — 2026-07-31

Eight specialist lenses swept the codebase in parallel — UX/interaction design, frontend
performance, accessibility, SEO/growth, security/privacy, ML & data, backend/data architecture,
and developer/agent experience. Each section below is a list of **prompt-ready tasks**: every
task's *Prompt* is written to be handed verbatim to an implementation agent with zero other
context. Priorities and effort are the auditor's estimate; **a human decides what actually gets
built** — nothing here is committed scope. Tasks were grounded in the code as of this date;
re-verify file paths against `AGENTS.md`'s route map before starting one, and follow the
Parallel-work rules (check open PRs for overlap) before claiming a slice.

Sections: [UX & interaction design](#1-ux--interaction-design) ·
[Frontend performance](#2-frontend-performance) · [Accessibility](#3-accessibility) ·
[SEO & growth](#4-seo--growth) · [Security & privacy](#5-security--privacy) ·
[ML & data](#6-ml--data) · [Backend & data architecture](#7-backend--data-architecture) ·
[Developer & agent experience](#8-developer--agent-experience)

---

## 1. UX & interaction design

Auditor's baseline: the foundation is strong (motion tokens, earned moments, reduced-motion
kill-switch, boat/glare modes). These tasks close the real gaps found in the shared primitives
and the main diver/staff flows.

### Give every button tactile press feedback on touch

- **Priority**: high
- **Effort**: S
- **Prompt**: In `src/components/ui/button.ts`, the shared `base` class string has `hover:` states only, and `src/app/globals.css` disables the native tap highlight (`-webkit-tap-highlight-color: transparent` on `button, a, summary`) — so on a phone (the "dock test" primary device, see `docs/design/forms-and-controls.md` and `docs/design/principles.md` #2) tapping any button produces zero visual feedback until the server responds. Add a press state to `base` in `button.ts` using transform/opacity only, e.g. `active:scale-[0.98]`, and extend the existing `transition-colors` to `transition-[color,background-color,border-color,transform]` (or reuse the `.transition-brand` timing: 200ms, `var(--ease-out-soft)`). Do not touch individual call sites — every button and button-shaped link in the app goes through `buttonClass()`, so the fix is one place. The reduced-motion kill-switch at the bottom of `globals.css` already neutralises the transition; verify it still wins. No copy changes, no new tokens.
- **Verification**: `pnpm check` green; run `pnpm dev`, open `/shop/[shopSlug]/schedule` on a mobile viewport in DevTools, tap "Book" and staff builder buttons and confirm the press dip is visible in light and dark; run `pnpm visual` and confirm no at-rest pixel diffs (active states are not captured at rest).

### Add content-shaped skeletons to the bearer-token diver pages

- **Priority**: high
- **Effort**: S
- **Prompt**: The staff routes all have content-shaped `loading.tsx` skeletons (e.g. `src/app/shop/[shopSlug]/schedule/[id]/loading.tsx`), but the three diver-facing bearer-token pages have none: `src/app/waivers/[token]/page.tsx`, `src/app/ready/[token]/page.tsx`, and `src/app/recap/[token]/page.tsx` each run several sequential DB queries (`await connection()` plus token verification, shop lookup, checklist assembly), so a cold tap on an emailed link shows a blank page. Create a `loading.tsx` next to each `page.tsx`, modeled on the trip-detail skeleton: `animate-pulse` blocks using only semantic token classes (`bg-surface-sunken`, `border-border`, `rounded-2xl`), shaped like each page's real layout — eyebrow line + h1 + body card for the waiver, header + checklist rows (a `divide-y` list of ~5 row-shaped bars) for `/ready`, header + photo/summary card for `/recap`. Match each page's real `main` wrapper (`mx-auto w-full max-w-xl flex-1 px-6 py-10 sm:py-16`) so there is no layout shift when content lands. No copy is needed in a skeleton, so the copy ratchet is not touched.
- **Verification**: `pnpm check`; in `pnpm dev` with DevTools network throttling (Slow 3G), open a waiver link and a `/ready/[token]` link and confirm the skeleton appears immediately, matches the loaded page's shape (no shift), and reads correctly in light and dark.

### Turn the /ready checklist into a wave-fill readiness progress bar

- **Priority**: high
- **Effort**: M
- **Prompt**: `src/app/ready/[token]/page.tsx` renders the diver's pre-trip checklist (waiver, payment, cert, emergency contact) as a flat list with no sense of overall progress — and `src/app/globals.css` already defines a dive-themed `.progress-wave-fill` class (animated SVG wave over `var(--primary)`) that is referenced nowhere in `src/` (confirm with grep before starting; if a parallel branch has claimed it, coordinate per AGENTS.md). Above the checklist section (`aria-labelledby="checklist-heading"`, ~line 357), add a progress bar: an outer track (`bg-surface-sunken`, `rounded-full`, `h-3` or taller), an inner fill div sized `width: {done/total * 100}%` carrying `progress-wave-fill`, plus a text label like "3 of 5 done" computed from `items` (count `state === "done"`, including the emergency-contact row) — the words carry the meaning, never the fill alone (principle 6). Use `role="progressbar"` with `aria-valuenow/min/max` and a translated `aria-label`; all copy goes through `src/i18n/locales/<locale>/diver.json` under the existing `ready.*` namespace and must be added to every locale (`pnpm check:locale`). The wave animation is infinite, so verify the reduced-motion kill-switch in `globals.css` freezes it; when `ready === true` the `EarnedMoment` branch already celebrates, so render the bar only in the "almost there" branch.
- **Verification**: `pnpm check` and `pnpm check:locale` green; `pnpm e2e readiness.spec.ts --reporter=line` still passes; view a partially-ready `/ready/[token]` in dev in light + dark and with "Emulate CSS prefers-reduced-motion" on (wave must be static); add a screenshot assertion for the surface in `e2e/visual.spec.ts` per the e2e-and-visual skill.

### Show "almost full" urgency on public schedule trip cards

- **Priority**: medium
- **Effort**: S
- **Prompt**: On the public schedule list (`src/app/shop/[shopSlug]/schedule/page.tsx`, ~line 499) each trip card's capacity `Badge` is binary — `tone={full ? "neutral" : "primary"}` — so a trip with 1 seat left looks identical to one with 11, even though the booking form itself already switches to "Book the last spot" copy (`BookSpotSection` in `src/app/shop/[shopSlug]/schedule/[id]/_components/BookingSections.tsx`). Using `spotsRemaining(trip)` from `src/lib/trips.ts` (already imported on the detail page), render a warning-toned state when `0 < remaining <= 2`: check `src/components/ui/badge.tsx` for an existing warning tone and add one from the `--warning` token if missing, and put the urgency in words — a translated string like "Only 2 spots left" from `diver.json` (new key under `schedule.*`, added to every locale) — never color alone. Keep `tabularNums` on the badge and apply the same treatment to the sticky mobile book button label on the detail page only if it does not already handle `remaining === 1` (it does, via `trip.bookAndSpotsLeft`). Semantic tokens only; no raw hex.
- **Verification**: `pnpm check` and `pnpm check:locale` green; seed data (`pnpm db:reset` then `pnpm dev`) includes near-full trips — confirm the badge on `/shop/[shopSlug]/schedule` in light + dark; update the schedule screenshot in `e2e/visual.spec.ts` expectations if the surface is captured, and explain the intentional diff in the PR per the visual-triage skill.

### Animate the ScheduleBuilder's inline panels open

- **Priority**: medium
- **Effort**: S
- **Prompt**: In `src/app/shop/[shopSlug]/schedule/_components/ScheduleBuilder.tsx`, the add/move/copy panels (conditionally rendered `FieldGrid as="form"` blocks keyed on the `open` state, at ~lines 291, 312, 399, 447) pop into existence with no transition, which makes it hard to see *where* the form appeared when a day header's "+ Add" is pressed lower on the board — motion's job here is to explain (principle 5). Add the existing `animate-scale-in` utility class (defined in `src/app/globals.css`, 200ms, transform/opacity, covered by the reduced-motion kill-switch) to the `className` of each of the four panel `FieldGrid`s — the `AddPanel` component plus the move and copy forms. Do not add exit animations (the state unmounts synchronously and faking it with delays would fight the single-open-panel invariant documented in the component's header comment). No new CSS, no copy changes.
- **Verification**: `pnpm check` green; in `pnpm dev` as staff on `/shop/[shopSlug]/schedule`, toggle "Add a departure", a per-day "+ Add", and a row's Move/Copy and confirm the panel scales in smoothly and is instant under emulated `prefers-reduced-motion`; the spec covering schedule mutations still green.

### Make the UndoToast pause on hover/focus and leave gracefully

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/components/UndoToast.tsx` (used on `src/app/shop/[shopSlug]/divers/[personId]/page.tsx` after a diver delete) starts a fixed 12s `setTimeout` and then returns `null` — the toast vanishes abruptly mid-read, and hovering or focusing the Undo button does not stop the clock, so a slow reader can lose the undo affordance while aiming at it. Rework the timer so `onMouseEnter`/`onFocus` (capture phase on the container) clears it and `onMouseLeave`/`onBlur` restarts it, and add an exit phase: switch to a `dismissing` state that applies a transform/opacity fade-down (a new ~200ms `var(--ease-out-soft)` keyframe in `globals.css`, or Tailwind transition classes) before unmounting; the reduced-motion kill-switch must neutralise it, and unmount must still happen under reduced motion (drive it from a `setTimeout`, not `onAnimationEnd`, or handle both). Keep the existing 12s floor — the comment explains it clears Playwright's 8s expect timeout, so do not shorten `autoDismissMs`. Keep `role="status"`; no copy changes.
- **Verification**: `pnpm check` green (add a focused Vitest test for the pause behavior with fake timers, run via `pnpm test src/components/UndoToast --reporter=dot` — never `pnpm test -- <file>`); manually delete a diver in dev, hover the toast past 12s and confirm it stays, then leave and watch it fade; `pnpm e2e divers.spec.ts --reporter=line` still green.

### Light up the crew drop zone while dragging on the Today board

- **Priority**: medium
- **Effort**: S
- **Prompt**: In `src/components/today/DepartureBoard.tsx`, staff chips are draggable onto each departure's crew `<section aria-label={copy.crewDropZoneAria}>` (~line 180), but during a drag the target gives no feedback — `onDragOver` only calls `preventDefault()` and the only affordance is a mouse `hover:border-primary/40`, which is not active while dragging in all browsers. Add an `isDragOver` state per card driven by `onDragEnter`/`onDragLeave` (use a depth counter, since child elements fire leave events) and, while true, style the drop zone with `border-primary bg-primary/5` via the existing `transition-colors`; clear the state in `onDrop`. Also give the just-dropped crew chip an entrance using the existing `animate-scale-in` class from `globals.css` so the optimistic `setLocalCrew` update visibly lands where it was dropped (principle 5: motion explains where it went). Keep the `<select>` fallback untouched — it is the touch/keyboard path, since HTML5 drag does not fire on touch. Semantic tokens only; no copy changes (the aria labels already exist in `DepartureBoardCopy`).
- **Verification**: `pnpm check` green including the existing `DepartureBoard.test.tsx`; in dev on `/shop/[shopSlug]` (Today), drag a staff chip over a departure and confirm the zone highlights, drop and confirm the chip scales in; confirm assigning via the select still works on a touch-emulated viewport; reduced-motion emulation shows no animation.

### Add a progress cue to the waiver's medical questionnaire

- **Priority**: medium
- **Effort**: M
- **Prompt**: The waiver page `src/app/waivers/[token]/page.tsx` renders the full medical questionnaire (`questionnaire.questions.map` over `RadioQuestion` fieldsets, ~line 382) as one long scroll with the signature at the bottom — on a phone at the dock a diver has no idea how much is left, and principle 2 calls for a sticky progress cue on exactly this kind of surface. Build a small Client Component (e.g. `src/app/waivers/[token]/QuestionnaireProgress.tsx`) that wraps the questions section, counts answered questions by listening for `change` events on the `q_*` radio groups (a single `onChange` on the wrapping div, reading tracked state), and renders a sticky bar (`sticky top-0 z-10 bg-background/95`) with a translated label like "5 of 12 answered" plus a thin `bg-primary` fill bar (`transition-[width]`, 200ms `var(--ease-out-soft)`, covered by the reduced-motion kill-switch). Words carry the state, not the bar alone; use `role="status"` politely, not per-keystroke announcements. The medical question wording itself stays English (documented carve-out), but the progress label is UI copy: add keys to every `src/i18n/locales/<locale>/diver.json` and note this page uses `diverTranslator` server-side — pass resolved strings (with `{answered}`/`{total}` placeholders filled client-side from a template, matching the `fill()` pattern in `ScheduleBuilder.tsx`) since there is no `DiverIntlProvider` here. Progressive enhancement: with JS disabled the form must still submit exactly as today.
- **Verification**: `pnpm check`, `pnpm check:locale`, and `pnpm check:copy` green (new strings via the bundle, none hard-coded); the waiver-flow e2e spec still green; in dev, open a waiver link on a mobile viewport, answer questions and watch the count/bar advance, confirm sticky behavior and light/dark rendering, and confirm signing works with JS disabled.

### Give the shared EmptyState a quiet dive-themed flourish

- **Priority**: low
- **Effort**: S
- **Prompt**: `src/components/EmptyState.tsx` is a bare dashed panel used across staff surfaces and the public schedule ("No trips yet" in `src/app/shop/[shopSlug]/schedule/page.tsx` ~line 430); the copy already teaches, but the panel itself is the one calm place a small brand moment costs nothing. Add an optional `icon` slot (default on) rendering a small inline SVG — a dive flag or three rising bubbles — drawn with `currentColor` at `text-muted` (or `text-primary/40`), `aria-hidden="true"`, ~40px, centered above the children; no raster assets, no raw hex (semantic tokens only per ADR-0004), no animation (empty states are rest states, and coral stays reserved for earned moments per principle 3). Keep the component's API backward-compatible so existing call sites change nothing, and keep the SVG inline in the component file rather than a new dependency. No copy changes — callers keep passing their own translated headings.
- **Verification**: `pnpm check` green; view `/shop/[shopSlug]/schedule` for a shop with no trips (or any staff list empty state, e.g. `/shop/[shopSlug]/blockers`) in light and dark and confirm the mark renders in both; `pnpm visual` will flag every surface using EmptyState — review each diff image and approve them in the PR description per the visual-triage skill.

---

## 2. Frontend performance

Auditor's baseline: Next 16.3.0-preview (App Router, Turbopack build), Tailwind 4, next-intl,
Sentry + Vercel Analytics/SpeedInsights in the root layout, images on Vercel Blob, and an existing
gzipped shared-first-load budget at `scripts/perf-budget.mjs` (260 KB, current ~252 KB — 8 KB of
headroom). Checked and found healthy (no task warranted): font loading (`next/font/google` with a
deliberate `preload: false` on the rare-glyph fallback), the client/server boundary (53
`"use client"` files, all genuinely interactive leaves receiving pre-translated `copy` props),
data-fetch batching and keyset pagination on the big pages, and the ADR-documented 16 MB
server-action body limit.

### Resize uploaded photos in the image-processing seam

- **Priority**: high
- **Effort**: S
- **Prompt**: `src/lib/storage/process-image.ts` validates and re-encodes every uploaded photo to JPEG q85 (`OUTPUT_JPEG_QUALITY = 85`) but never resizes: it accepts anything up to `MAX_IMAGE_PIXELS = 40_000_000` (40 MP) and stores it at full resolution, and those stored URLs are then served raw into `<img>` tags on recap galleries, course pages, and briefing cards. Add a bounding resize to the sharp pipeline in `processImage` — e.g. `.resize(2048, 2048, { fit: "inside", withoutEnlargement: true })` — before the JPEG encode, so no stored display image exceeds ~2048px on its long edge. Keep the existing `.rotate()` EXIF-orientation behavior and metadata stripping intact. Update `src/lib/storage/process-image.test.ts` with a case asserting a larger-than-bound input comes out resized and a smaller one is not enlarged. This is server-only code (sharp is in `serverExternalPackages` in `next.config.ts`), so no bundle impact — it is purely an LCP/bandwidth win for photo surfaces.
- **Verification**: `pnpm test src/lib/storage/process-image.test.ts --reporter=dot` green; upload a large photo via the course editor in `pnpm dev` and confirm the stored image dimensions/bytes via the network tab.

### Adopt optimized, dimension-stable images on photo surfaces

- **Priority**: high
- **Effort**: M
- **Prompt**: The app never uses `next/image` — `next.config.ts` has no `images` config at all and every photo renders through a raw `<img>`: `src/app/shop/[shopSlug]/trips/[id]/_components/RecapPhotoGallery.tsx:33`, `src/components/DiveBriefingCard.tsx:75,158`, `src/components/DigitalCardFlip.tsx:104`, `src/app/recap/[token]/page.tsx:368`, `src/app/waivers/[token]/page.tsx:231`, and `src/app/shop/[shopSlug]/courses/[slug]/_components/CourseSections.tsx:27`. None carry `width`/`height` (only some have `loading="lazy"`), so photo grids shift layout as images arrive (CLS) and full-resolution Blob originals ship to phones. First read the image docs in `node_modules/next/dist/docs/` (this Next version's API differs from training data), then: (a) add an `images.remotePatterns` entry for `*.public.blob.vercel-storage.com` (the host suffix is documented in `src/lib/storage/index.ts`, `BLOB_PUBLIC_HOSTNAME_SUFFIX`); (b) convert the listed surfaces to the current `next/image` component with explicit dimensions and `sizes`, or — where intrinsic dimensions are unknown — an aspect-ratio-reserving wrapper plus `decoding="async"`. Skip `?embed=1` and bearer-token pages only if the docs reveal a constraint; otherwise convert them too. Do not touch semantic-token styling rules (ADR-0004).
- **Verification**: `pnpm build` succeeds; run `pnpm dev`, open a recap gallery and a course page, and confirm in DevTools that images are served through `/_next/image` at viewport-appropriate widths with zero layout shift (Performance panel / Lighthouse CLS on the course page); `pnpm visual` diffs reviewed and explained.

### Stop rendering the marketing site per-request; cache per locale

- **Priority**: high
- **Effort**: M
- **Prompt**: Every public marketing page — `src/app/page.tsx:51`, `src/app/pricing/page.tsx:30`, `src/app/product/page.tsx:34`, `src/app/about/page.tsx`, and all three `src/app/switching/**` pages — calls `requestLocale()` from `src/i18n/request.ts`, which reads `headers()` and therefore forces fully dynamic rendering of static content on every hit, purely to choose between two locales (`en-US`, `es-ES`). The comment in `src/i18n/request.ts` claiming "every caller is already dynamic" is wrong for these pages: they have no session and no live data. First read the caching docs in `node_modules/next/dist/docs/` for this Next version's cache primitives (`"use cache"` / cacheLife / cacheComponents — verify the current API). Then restructure so the expensive render is cached per locale: e.g. hoist each page body into a cached function keyed by the negotiated `DiverLocale` (only 2 values), keeping only the thin `Accept-Language` negotiation dynamic; or pre-render both variants and select in `src/proxy.ts`. Do not change the schedule or any `/shop/**` page — those are legitimately dynamic (`connection()`, sessions). Keep JSON-LD behavior in `src/lib/structured-data.ts` intact.
- **Verification**: `pnpm build` output shows the marketing routes as static/partially-prerendered rather than fully dynamic; `curl -H "Accept-Language: es" localhost:3000/pricing` still returns Spanish; TTFB for `/` measurably drops in repeated `curl -w '%{time_starttransfer}'` runs; `pnpm check` green.

### Ship only the needed diver-message namespaces to the client

- **Priority**: medium
- **Effort**: M
- **Prompt**: `src/i18n/DiverIntlProvider.tsx` passes `messagesFor(resolved)` — the entire diver bundle, 80 KB for `src/i18n/locales/en-US/diver.json` and 89 KB for `es-ES` — into `NextIntlClientProvider`, which serializes it into the RSC payload of every page that mounts it: `src/app/ready/[token]/page.tsx`, `src/app/shop/[shopSlug]/courses/[slug]/page.tsx`, `src/app/shop/[shopSlug]/schedule/page.tsx` (the public schedule, also served embedded via `?embed=1`), and `src/app/shop/[shopSlug]/schedule/[id]/page.tsx`. Client components use only a few namespaces via `useTranslations()`. Grep those four routes' client components for `useTranslations(` to enumerate the namespaces each actually needs, add a helper in `src/i18n/messages.ts` (e.g. `messagesForNamespaces(locale, keys)` using object pick over `DIVER_MESSAGES`), and extend `DiverIntlProvider` with a required `namespaces` prop so each page declares its slice. Preserve the provider's load-bearing explicit props (`locale`, `timeZone`, `now`, `formats`) — the file's doc comment explains why every prop must stay explicit. Read the i18n-copy skill notes before touching `src/i18n/`.
- **Verification**: `pnpm test src/i18n --reporter=dot` plus a new unit test for the pick helper; view-source on `/shop/<slug>/schedule` in `pnpm dev` and confirm the inlined message payload shrank from ~80 KB to the picked slice; e2e specs covering booking/schedule still pass.

### Recover shared first-load JS headroom (Sentry is the lever)

- **Priority**: medium
- **Effort**: M
- **Prompt**: The shared first-load budget in `scripts/perf-budget.mjs` is 260 KB gzipped with current usage at ~252 KB — nearly exhausted, and the comment names it "the floor cost a divemaster pays on a phone at the dock." The likely largest non-framework contributor is `@sentry/nextjs`, initialized eagerly in `src/instrumentation-client.ts` with `tracesSampleRate: 0` (tracing unused) but `enableLogs: true`. Run `pnpm build` once, then `pnpm perf:budget` to get the baseline, and inspect `.next` build manifests to attribute the shared chunks. Then shrink the client SDK: read the current Sentry bundle-reduction guidance (the SDK supports disabling unused features/integrations via init options and build-time flags in the `withSentryConfig` options in `next.config.ts` — tree-shaking flags like excluding tracing/replay code); at minimum drop `enableLogs` and any tracing code given the 0 sample rate. Do not remove the CR-001 redaction in `src/app/observability.ts`/`observability-client.tsx` and keep `onRouterTransitionStart` exported. If you materially lower the number, ratchet `SHARED_FIRST_LOAD_BUDGET_KB` down in the same change so it can't creep back.
- **Verification**: `pnpm build && pnpm perf:budget` shows a lower shared first-load KB than the ~252 KB baseline; Sentry still reports (trigger a dev error and see it hit the `/monitoring` tunnel in the network tab); `pnpm check` green.

### Stream the public schedule's calendar and reviews; add loading states to remaining staff routes

- **Priority**: medium
- **Effort**: M
- **Prompt**: `src/app/shop/[shopSlug]/schedule/page.tsx` is fully dynamic (`connection()` at line 115) and blocks its entire response on two `Promise.all` batches (lines 145 and 179 — trips, stats, review aggregate, review list, builder options) plus a genuinely sequential `upcomingTripsForCalendar` await at line 292 (it depends on `range` from the first batch). Restructure so the first paint is the trip list: move the month calendar (the line-292 fetch) and the reviews section (`getShopReviewAggregate`/`listPublishedShopReviews`) into async child Server Components wrapped in `<Suspense>` with skeleton fallbacks, letting the shell and list stream first. There is exactly one `Suspense` in the whole app today (`src/app/shop/[shopSlug]/page.tsx:51`), so follow its pattern. Separately, add `loading.tsx` files (mirroring `src/app/shop/[shopSlug]/schedule/loading.tsx`) to the staff routes that have none: `waivers/`, `check-in/`, `orders/`, `reports/`, `reviews/`, `promos/`, and `staffing/` under `src/app/shop/[shopSlug]/`. Keep skeleton copy out of components per the copy ratchet (`pnpm check:copy`).
- **Verification**: `pnpm check` green; in `pnpm dev` with DevTools network throttling, confirm the schedule shell/list paints before reviews/calendar arrive; `pnpm e2e e2e/visual.spec.ts --reporter=line` and review diffs (skeletons should not appear in frozen-clock captures once data resolves).

### Parallelize the sequential session/shop/locale prologue in staff pages

- **Priority**: medium
- **Effort**: S
- **Prompt**: Several server pages serially await independent lookups before any data fetch. In `src/app/shop/[shopSlug]/schedule/page.tsx` lines 122–137 the chain is `getDb()` → `getShopBySlug()` → `auth()` → `requestTranslator()`, but `auth()` does not depend on the shop row; in `src/app/shop/[shopSlug]/trips/[id]/page.tsx` lines 68–78 it is `requireStaffSession()` → `params` → `getDb()` → `getShopById()` → `requestLocale()` → `getTripWithBooked()`, where the session, params, and db handle are mutually independent. Rewrite each prologue so independent steps run in one `Promise.all` (e.g. `const [session, { shopSlug }, db] = await Promise.all([...])`, then shop, then the dependent batch), keeping the not-found/redirect ordering semantics identical. Apply the same pattern to `src/app/shop/[shopSlug]/page.tsx` lines 41–84. Each round-trip saved is a real DB/session query on every staff page view.
- **Verification**: `pnpm check` green; the routes' existing e2e specs pass; manually confirm sign-in redirect still fires for anonymous access to a staff URL.

### Move command-palette search off Server Actions onto a GET route

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/components/search/CommandPalette.tsx` fetches results by calling `searchShopAction` from `src/app/actions/search.ts` on every debounced keystroke. Server Actions are POSTs that Next executes serially per client, so search requests queue behind each other and behind any in-flight mutation action, and they can never be cached. Add a route handler at `src/app/api/search/route.ts` that re-derives auth exactly as the action does (`requireStaffSession()` → `getDb()` → `getShopById()` → `searchShop()` from `src/db/search.ts` — keep the shop-scoping identical, this is security-sensitive), reads `q` from the query string, and returns `SearchResults` JSON with `Cache-Control: private, no-store`. Update the palette's debounced effect to `fetch` that endpoint with an `AbortController` for race-safety (replacing the existing race-guard), and delete `searchShopAction` if nothing else imports it. Because the shop-scoped auth surface moves, request a `security-reviewer` pass per the repo's hard rules.
- **Verification**: `pnpm check` green; palette e2e/manual check — type quickly in ⌘K and confirm parallel GETs with aborted stale requests in the network tab, and that an anonymous `curl localhost:3000/api/search?q=x` gets a 401/redirect, never data.

### Hoist ScheduleBuilder's inline AddPanel component

- **Priority**: low
- **Effort**: S
- **Prompt**: In `src/app/shop/[shopSlug]/schedule/_components/ScheduleBuilder.tsx`, `AddPanel` (lines 160–267) is a component function defined inside the `ScheduleBuilder` render body. Its identity changes on every render, so React unmounts and remounts the whole panel — including its uncontrolled `<input>`s — whenever the parent re-renders, silently discarding anything a staff member had typed (today the only parent state is `open`, but any future state or a parent re-render from a router refresh triggers it). Hoist `AddPanel` to module scope and pass what it closes over as props: `dateIso`, `courses`, `diveSites`, `copy`, `actions.add`, and an `onCancel` callback. No behavior change otherwise; this is also the standard fix for a known React re-render anti-pattern, cheap insurance before this component grows.
- **Verification**: `pnpm check` green; scheduling e2e spec passes; manual check in `pnpm dev` that the add-departure form still opens per-day and submits.

---

## 3. Accessibility

Auditor's baseline: much is genuinely good — semantic radios for star ratings, fieldset/legend
medical questions, widespread `aria-live`, a reduced-motion kill-switch, a skip link on the
offline manifest, glare/boat contrast modes. Contrast ratios below were computed from the actual
token hex values.

### Fix the global focus indicator's contrast in light mode

- **Priority**: high
- **Effort**: S
- **Prompt**: In `src/app/globals.css` (lines 199–203), the app-wide keyboard focus indicator is `outline: 3px solid color-mix(in srgb, var(--primary) 55%, transparent)`. In the light palette that computes to ~2.3:1 against `--background` (#faf9f6) and `--surface` (#ffffff), failing WCAG 1.4.11's 3:1 minimum for focus indicators — keyboard staff users can lose the focus ring entirely in sunlight. Introduce a dedicated semantic token (e.g. `--focus-ring`) defined per scheme in the `:root` and dark blocks — full-strength `--primary` in light mode is 5.36:1 on white and passes — and use it in the `:focus-visible` rule instead of the 55% mix. Keep the token semantic per ADR-0004 and also define it in the `.boat-mode` and `.glare-mode` blocks so those palettes keep a passing ring. Do not weaken the dark-mode ring (currently ~3.8:1, passing).
- **Verification**: Recompute ratios with the same formula (a small node script against the hex values) confirming ≥3:1 for light, dark, boat, and glare palettes; keyboard-Tab through `/sign-in` and the schedule in light mode and screenshot to confirm the ring is clearly visible; `pnpm check` green (the token change must not trip the semantic-token safeguard).

### Set the document language from the negotiated locale

- **Priority**: high
- **Effort**: M
- **Prompt**: `src/app/layout.tsx` hard-codes `<html lang="en">` (line 61), but the app negotiates diver copy per request via `requestLocale()` from `Accept-Language` with an `es-ES` bundle in `src/i18n/locales/es-ES/` — so a Spanish-speaking diver signing a waiver gets Spanish content announced with English pronunciation rules (WCAG 3.1.1 failure on a legally required flow), and the mismatch also misleads search engines' language detection. Make `RootLayout` an async server component, call `requestLocale()` from `src/i18n/request.ts`, and render `lang` from the negotiated tag (e.g. `es-ES` → `lang="es-ES"`). Note the root layout cannot know a shop's `default_locale` fallback; negotiating from the header alone is correct there and matches what `diverTranslator(await requestLocale())` already does for token pages like `src/app/waivers/[token]/page.tsx`. Check `node_modules/next/dist/docs/` first per AGENTS.md — this Next version's conventions may differ — and confirm making the root layout dynamic doesn't break static marketing pages (if it does, scope the dynamic `lang` to the token-page/shop layouts instead and document why). Coordinate with the marketing-page caching task in §2 — that task wants marketing pages *more* static; if both land, the per-section-layout scoping is the compatible shape. The deliberate design constraint stands: no `[locale]` routes and no hreflang alternates (one URL serves all languages), so `lang` is the only correct language signal — do not add hreflang tags.
- **Verification**: `curl -H "Accept-Language: es-ES" localhost:3000/waivers/<token> | grep '<html'` shows `lang="es-ES"` while a default request keeps `lang="en"`; `pnpm check` and the existing e2e suite stay green; VoiceOver/NVDA spot check that Spanish copy reads with Spanish pronunciation; confirm `pnpm build` output still marks the switching pages as static if they were before.

### Associate waiver errors with fields and mirror constraints client-side

- **Priority**: high
- **Effort**: M
- **Prompt**: On the waiver signing page `src/app/waivers/[token]/page.tsx`, a failed submit redirects to `?error=invalid` and renders one generic `role="alert"` banner (lines 361–368); the signature input (line 424) and agreement checkbox (line 434) carry no `required`, no `aria-invalid`, and no `aria-describedby`, so a screen-reader or cognitive-disability user gets "check that every question is answered" with no pointer to which of ~10+ medical questions, the name, or the checkbox is missing — on a legally required, safety-critical flow (WCAG 3.3.1/3.3.3). Add `required` and `minLength={2}` to the `signerName` input and `required` to the `acknowledged` checkbox so the browser blocks-and-focuses the first invalid control before the round trip (the medical radios already have `required`; the server schemas at lines 40–48 stay the enforcement of record). Keep the server fallback but follow the pattern already established in `src/components/BookingPartyFields.tsx` (lines 158–172): where the error banner renders, also give it an anchor (`id`) and make it a link-or-text that names what failed. Note the `saveDraftAction` "save for later" button must NOT be blocked by the new `required` attributes — give it `formNoValidate` since drafts intentionally accept partial answers.
- **Verification**: Keyboard walkthrough: submit the sign form empty → browser focuses the first missing control and announces its validation message; "Save for later" still works with a partial form; `pnpm e2e waivers.spec.ts --reporter=line` green, plus a new assertion that an incomplete "sign" submit leaves focus on/announces the offending field.

### Give the keyboard-shortcuts dialog real modal behavior

- **Priority**: medium
- **Effort**: M
- **Prompt**: `src/components/KeyboardShortcuts.tsx` renders a `role="dialog" aria-modal="true"` cheat-sheet (lines 121–125) via portal, but nothing moves focus into it when it opens (especially when opened via the `?` key, focus stays wherever it was in the page), nothing traps Tab inside it, and nothing restores focus on close — `aria-modal` tells screen readers the background is inert when it is not (WCAG 2.4.3 / dialog pattern). Replace the hand-rolled div with a native `<dialog>` element driven by `showModal()`/`close()`, which provides the focus trap, backdrop, Escape handling, and focus restoration for free; keep the existing `aria-label={copy.dialogAriaLabel}` and move the close button's handler to `dialog.close()`. Keep the existing global `?`/Escape key handling in sync with the dialog's own `close` event so state doesn't drift.
- **Verification**: Keyboard walkthrough on any `/shop/**` page: press `?` → focus lands inside the dialog (close button), Tab cycles only within it, Escape closes and returns focus to the previously focused element; existing `pnpm e2e keyboard-shortcuts.spec.ts --reporter=line` stays green and gains a `toBeFocused()` assertion on open/close.

### Manage focus and announcements in the schedule builder's panel flow

- **Priority**: medium
- **Effort**: M
- **Prompt**: In `src/app/shop/[shopSlug]/schedule/_components/ScheduleBuilder.tsx`, the Add/Move/Copy toggles correctly use `aria-expanded` and per-row accessible names, but opening a panel does not move focus into it, Cancel (lines 257–263, 436–442, 477–483) does not return focus to its toggle, and when a server action completes the whole panel unmounts leaving keyboard focus on `<body>`; only Remove gets an announcement (via `UndoToast`'s `role="status"`). Add a small effect keyed on `open` that focuses the first input of the newly opened panel; make each Cancel restore focus to the button that opened the panel (hold the toggle in a ref keyed by panel id); and render a visually-hidden `role="status"` region (or reuse the redirect-flash pattern the waiver page uses with `FlashParams`) that announces "departure added/moved/copied" after the action's redirect. While there, replace the three hand-rolled Cancel text buttons with `buttonClass({ variant: "ghost", size: "sm" })` — the project's hard rule ("button-shaped things via buttonClass") and the WCAG 2.5.8 24px target floor both require it. All new copy goes through `staff.json` per the i18n-copy skill.
- **Verification**: Keyboard-only walkthrough at `/shop/<slug>/schedule`: open Add with Enter → focus is in the title input; Escape/Cancel → focus back on the "+ Add" button; submit Move → screen reader (or Playwright `getByRole("status")`) sees the confirmation. The schedule-builder e2e spec green with a new focus assertion; `pnpm check` green.

### Raise tinted status-banner text above 4.5:1

- **Priority**: medium
- **Effort**: S
- **Prompt**: Light-mode success and warning text on their 10% tinted fills fails AA for the small text sizes used: `--success` #15803d on `bg-success/10` over white computes to 4.38:1 and `--warning` #b45309 on `bg-warning/10` to 4.39:1. Concrete instances: the waiver "progress saved" banner (`text-sm font-medium text-success` on `bg-success/10`, `src/app/waivers/[token]/page.tsx` lines 353–360), the payment-received panel (`text-success` on `bg-success/10`, `src/app/shop/[shopSlug]/schedule/[id]/_components/BookingConfirmation.tsx` lines 48–59), and warning-tinted notices/`ShopNotice tone="warning"` surfaces. Fix at the token level in `src/app/globals.css`: darken light-mode `--success` to ~#166534 and `--warning` to ~#92400e (the values boat-mode already uses), then re-verify every existing light-mode use of `text-success`/`text-warning` on `bg-surface`, `bg-background`, and the /10 tints clears 4.5:1. Dark mode already passes (7.5–8:1) — do not touch it.
- **Verification**: Node contrast script over the new hex values against `#ffffff`, `#faf9f6`, `#f1efe9`, and each color mixed at 10% over white, all ≥4.5:1; `pnpm visual` and review the diffs (an intentional token darkening, explained in the PR per the visual-triage skill); light/dark screenshots of the waiver saved banner and booking payment panel.

### Fix placeholder text contrast

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/globals.css` lines 190–193 set `input::placeholder` to `color-mix(in srgb, var(--muted) 78%, transparent)`, which computes to 3.35:1 on white surfaces and 3.07:1 on `--surface-sunken` in light mode — placeholder text is real text under WCAG 1.4.3 and needs 4.5:1 (the schedule builder's title placeholder and search inputs rely on it). Change the rule to use `var(--muted)` at full strength (5.0:1 on background, 4.58:1 on sunken — passing) or raise the mix to a percentage that clears 4.5:1 on the darkest light-mode surface it sits on; placeholders remain visually distinct from typed text because typed text uses `--foreground`, not `--muted`. Dark mode currently sits at 4.54:1 — keep it at or above that.
- **Verification**: Node contrast script confirming ≥4.5:1 for the computed placeholder color over `#ffffff`, `#faf9f6`, and `#f1efe9` (light) and `#0d222d` (dark); axe run (or DevTools contrast checker) on the schedule builder's Add panel; `pnpm visual` diff reviewed and explained.

### Add a skip link to the staff shell and public schedule

- **Priority**: medium
- **Effort**: S
- **Prompt**: Only the offline manifest has a skip link (`src/components/OfflineManifestView.tsx` lines 402–407, `sr-only focus:not-sr-only` pattern); a repo-wide grep for "Skip to"/`id="main"` finds nothing else, so keyboard and screen-reader users must tab through the full `ShopNav` (`src/components/ShopNav.tsx`) on every staff page and through `MarketingNav` on public pages (WCAG 2.4.1). Add a "skip to content" anchor as the first focusable element in the shop layout (the layout that renders `ShopNav` under `src/app/shop/`) and in the marketing/public layout, targeting an `id` on the page's `<main>` region, reusing the exact focus-reveal classes the offline manifest already uses so styling stays consistent. The link copy must come from the message bundles (`staff.json` for the shop shell, `diver.json` for public pages) per the i18n-copy skill — the offline manifest's `shared.offlineManifest.single.skipLink` key shows the pattern.
- **Verification**: Keyboard walkthrough: first Tab on `/shop/<slug>/today` and on `/shop/<slug>/schedule` reveals the skip link, Enter lands focus in `<main>`; `pnpm check:locale` and `pnpm check:copy` green; add a two-line assertion to an existing e2e spec (`page.keyboard.press("Tab")` then `toBeFocused()` on the link).

### Close the reduced-motion escape hatch for !important animations

- **Priority**: low
- **Effort**: S
- **Prompt**: The reduced-motion kill-switch in `src/app/globals.css` (lines 464–475) uses a universal `*` selector with `!important`, but `.progress-wave-fill` (lines 546–555) declares `animation: progress-wave-move 1.5s infinite linear !important` — when both declarations are `!important`, the class selector's higher specificity wins, so this infinite animation keeps running for users who asked for reduced motion (WCAG 2.3.3). Add an explicit override inside the `@media (prefers-reduced-motion: reduce)` block: `.progress-wave-fill { animation: none !important; background-image: none !important; }` (the solid `background-color: var(--primary)` still conveys the progress fill). Audit the rest of the file for the same pattern — any other selector that sets `animation`/`transition` with `!important` needs a matching entry in the reduced-motion block; the `.animate-bubble` coral bubbles and `.rise-in` are currently killed correctly because their durations aren't `!important`.
- **Verification**: In Chromium DevTools, emulate `prefers-reduced-motion: reduce` on any surface using the wave fill and confirm via the Animations panel that nothing loops; a quick `grep -n '!important' src/app/globals.css` cross-checked against the reduced-motion block shows every animated `!important` declaration has an override.

### Add automated axe scans and keyboard assertions to the e2e suite

- **Priority**: medium
- **Effort**: M
- **Prompt**: The e2e suite (`e2e/`) asserts behavior almost entirely through accessible roles/names (good), but nothing runs an automated a11y scan and no spec asserts focus behavior beyond `keyboard-shortcuts.spec.ts` — regressions like the failing focus ring or a missing label ship silently. Add `@axe-core/playwright` as a devDependency (write an ADR per the "new runtime dependency → ADR" rule, noting it is test-only, using a `YYYYMMDD-short-slug` id) and create `e2e/a11y.spec.ts` that runs `new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()` and asserts zero violations on the five highest-stakes surfaces: the public schedule (`/shop/<slug>/schedule`), the trip booking page + confirmation, the waiver page (`/waivers/<token>` — seed a token via the existing helpers in `e2e/helpers.ts`/`e2e/fixtures.ts`, following how `waivers.spec.ts` obtains one), the staff manifest page, and `/offline-manifest`. Triage any violations the scan finds into the fixes above rather than filtering rules; only document a rule exclusion with an inline comment if it is a genuine false positive.
- **Verification**: `pnpm e2e a11y.spec.ts --reporter=line` passes locally (never `pnpm e2e -- a11y.spec.ts` — the `--` breaks pnpm arg forwarding per AGENTS.md); intentionally removing an `aria-label` in `ScheduleBuilder.tsx` locally makes the scan fail, proving it bites; `pnpm check` green and the ADR committed in the same change.

---

## 4. SEO & growth

Auditor's baseline (already good, preserved by every task below): per-page canonicals on
marketing + shop pages, embed/staff pages correctly emit no JSON-LD, Event/Course/AggregateRating
graphs exist, all bearer-token pages carry `robots: noindex`, root OG image is generated.
Deliberately **not** proposed: hreflang alternates (single-URL `Accept-Language` negotiation is a
documented design decision), FAQ structured data on `/pricing` (Google restricted FAQ rich results
in 2023), and JSON-LD in embed mode or on token pages (correctly prohibited today).

### Publish public shop pages in the sitemap

- **Priority**: high
- **Effort**: M
- **Prompt**: `src/app/sitemap.ts` lists only the 8 marketing pages; every shop's public schedule (`/shop/[shopSlug]/schedule`) and public course pages (`/shop/[shopSlug]/courses/[slug]`) are indexable, carry canonicals and JSON-LD, yet are absent from the sitemap. Make `sitemap()` async, use `getDb()` plus `src/db/shops.ts` and `listActiveCourses` from `src/db/courses.ts` to emit one entry per shop schedule (priority ~0.7) and one per active course page (priority ~0.6). Exclude per-shop demo shops (see ADR 20260724-per-visitor-demo-shops and the reaper in `src/app/api/cron/reminders/route.ts` — the ephemeral per-visitor demos must not be published; the canonical `blue-mantis` demo is a judgment call, document it). The file's docstring says adding a route "is a publishing decision, not a reflex" — this is that decision, so update the docstring and note it in the ADR 20260729-booking-page-structured-data doc in the same change. Do not add tokened or staff routes. Add `lastModified` where cheap (e.g. shop's latest trip update) but don't invent values.
- **Verification**: Unit test the sitemap function with `createTestDb()` seeded with one shop + one active and one hidden course, asserting the hidden course and token routes are absent; then `curl localhost:3000/sitemap.xml` under `pnpm dev` and confirm shop URLs render with the `publicAppUrl()` origin.

### Link course sessions on the public schedule to the course page

- **Priority**: high
- **Effort**: S
- **Prompt**: Public course pages currently have almost no crawlable inbound links: the only in-app link to `/shop/[shopSlug]/courses/[slug]` is inside the post-booking `BookingConfirmation` component (`src/app/shop/[shopSlug]/schedule/[id]/_components/BookingConfirmation.tsx:179`), which a crawler never reaches. On the public schedule list (`src/app/shop/[shopSlug]/schedule/page.tsx`, ~line 473) a course session renders `{t("schedule.courseSession")} · {trip.course.title}` as plain text — turn the course title into a `next/link` to the course page (the trip query already returns `trip.course`; confirm it includes `slug`, and add it to the select in `src/db/trips.ts` if not). Do the same on the trip detail page's course display (`src/app/shop/[shopSlug]/schedule/[id]/_components/TripHeader.tsx` or wherever the course title renders). Keep the link out of embed mode's nested-navigation only if the existing embed ADR (20260726-schedule-embed) demands it — otherwise carry `?embed=1` through like the trip links do. Any new copy goes through `src/i18n/locales/<locale>/diver.json` (see the i18n-copy skill).
- **Verification**: `pnpm test` for any touched db query test; extend `e2e/schedule-trip.spec.ts` or `e2e/courses.spec.ts` with an assertion that the anonymous schedule page contains an `a[href*="/courses/"]` for a seeded course session; `pnpm check`.

### Add canonicals and OpenGraph to the switching pages

- **Priority**: high
- **Effort**: S
- **Prompt**: The switching guides are in the sitemap at priority 0.7–0.8 but have the thinnest metadata of any marketing page: `src/app/switching/page.tsx` exports only `title`/`description` (no `alternates.canonical`, no `openGraph`), and `src/app/switching/[competitor]/page.tsx`'s `generateMetadata` (lines 24–33) likewise returns only title/description. Compare with `src/app/pricing/page.tsx` lines 16–27 for the established pattern. Add `alternates: { canonical: "/switching" }` and an `openGraph` block to the hub, and `alternates: { canonical: "/switching/" + guide.slug }` plus `openGraph: { title, description, url }` to the competitor page using the guide's existing `metaTitle`/`metaDescription` from `src/lib/migration-guides.ts`. Check `src/app/switching/spreadsheet/page.tsx` has an `openGraph` block too (it already has the canonical). These are metadata literals, same carve-out as the other marketing pages — no i18n bundle needed. Consult the switching-pages skill first.
- **Verification**: `pnpm dev`, then `curl -s localhost:3000/switching/eve | grep -E 'canonical|og:'` shows the canonical link and og:title/og:description/og:url; `pnpm check` green.

### Complete the robots.txt disallow list for token routes

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/robots.ts` states its policy is that disallowing bearer-token prefixes "keeps crawlers from fetching bearer-token URLs at all", but the disallow list (line 18) covers only `/api/`, `/waivers/`, `/ready/`, `/recap/`, `/offline-manifest` — while `/verify/[token]`, `/reset-password/[token]`, `/invite/[token]`, and `/calendar/[token]` are also bearer-token surfaces (each already carries per-page `robots: noindex` or an `X-Robots-Tag`, see `src/app/verify/[token]/page.tsx:15`, `src/app/reset-password/[token]/page.tsx:18`, `src/app/invite/[token]/page.tsx:18`, `src/app/calendar/[token]/route.ts:81`). Add `/verify/`, `/reset-password/`, `/invite/`, and `/calendar/` to the disallow array and extend the docstring's route list to match. This is a change to crawl policy on token flows, so flag it for the `security-reviewer` pass per AGENTS.md's security-sensitive rule. Do not touch the per-page noindex declarations.
- **Verification**: `curl localhost:3000/robots.txt` lists all token prefixes; add/extend a unit test asserting the disallow array covers every token route prefix so a new token surface failing to register is caught.

### Generate per-shop and per-trip OpenGraph images

- **Priority**: medium
- **Effort**: M
- **Prompt**: Every public page shares the single generic card in `src/app/opengraph-image.tsx`, so a shop sharing its own schedule or a diver sharing a trip link into WhatsApp/Facebook gets a DiveDay-branded card with no shop name, date, or price — weak shareability for the pages divers actually share. Add `opengraph-image.tsx` files (Next `ImageResponse`, same satori constraints and deep-ocean literal palette documented in the root file — that file's comment sanctions the literal-color exception) under `src/app/shop/[shopSlug]/schedule/` and `src/app/shop/[shopSlug]/schedule/[id]/`, rendering shop name + "Dive schedule" for the schedule and trip title + formatted date + price + open-seats for a trip (reuse `getShopBySlug`/`getTripWithBooked` and `formatShortDate` with the shop's locale/timezone). Optionally a third for `courses/[slug]` with course title + agency. Read the Next.js docs in `node_modules/next/dist/docs/` for the current metadata-image file convention before writing anything (per the repo's Next.js warning). Follow the root file's `i18n-exempt-file` carve-out for crawler-facing text. Never emit personal data — only what the page already shows an anonymous visitor.
- **Verification**: `curl -sI localhost:3000/shop/blue-mantis/schedule/opengraph-image` returns `image/png`; view the rendered image for one trip; confirm `og:image` in the trip page's HTML head points at the new route; `pnpm check` and a visual pass per the design-review skill.

### Mark up published reviews as schema.org Review items

- **Priority**: medium
- **Effort**: S
- **Prompt**: The public schedule renders individual published reviews (`src/components/ShopReviews.tsx` — reviewer, star rating, comment, trip title, dive date via `listPublishedShopReviews`), but the JSON-LD in `src/lib/structured-data.ts` emits only `aggregateRating` on the shop node — the review content itself is invisible to rich-result parsers. Add a `reviewsJsonLd`-style helper that maps `PublicReview[]` (see `src/db/reviews.ts` for the exact public shape) to `Review` objects (`author` as `Person` with the already-public display name, `reviewRating` as `Rating` with the existing `MIN_REVIEW_RATING`/`MAX_REVIEW_RATING` bounds, `reviewBody`, `datePublished` from the dive date) and attach them as `review` on the shop node emitted by `shopJsonLd`, but only where the reviews are actually rendered — the standalone schedule page (`src/app/shop/[shopSlug]/schedule/page.tsx`, which already fetches `reviews` alongside `reviewAggregate`). Respect the file's privacy contract: only data the page already shows an anonymous visitor, nothing in embed mode or on bearer-token pages, and route everything through the existing `pruneJsonLd`. Extend the module's unit tests, including the empty-reviews case emitting no `review` key.
- **Verification**: Unit tests in `src/lib/structured-data.test.ts` for the Review mapping and pruning; extend the existing e2e at `e2e/reviews.spec.ts:85` to assert a `"@type":"Review"` appears in the schedule's ld+json script; paste the rendered graph into Google's Rich Results Test.

### Add a "Powered by DiveDay" attribution link to the embed snippet

- **Priority**: high
- **Effort**: S
- **Prompt**: The schedule embed is DiveDay's one surface on customers' own websites, and it currently carries zero attribution — `grep -ri "powered by" src/` returns nothing. Two pieces: (1) in `src/app/shop/[shopSlug]/settings/embed/page.tsx`, extend the generated `iframeSnippet` (line 49) so the copy-paste snippet includes a small caption line after the iframe — a plain `<a href="https://<publicAppUrl>/?utm_source=embed&utm_medium=widget&utm_campaign=<shopSlug>">Powered by DiveDay</a>` — because a link in the embedding page's own HTML is a genuine crawlable backlink from the shop's domain, which a link inside the iframe is not; (2) add a discreet footer link inside the embed rendering itself (`src/app/shop/[shopSlug]/schedule/page.tsx`, the `isEmbed` branch) pointing to `/` with the same UTM params, for human discovery. The link text is user-facing copy: add it to `src/i18n/locales/<locale>/diver.json` for the in-widget link, and to the staff bundle for the settings-page snippet labels, per the i18n-copy skill and the `pnpm check:copy` ratchet. Keep the widget compact per ADR 20260726-schedule-embed and emit no structured data in embed mode. Check the brand-voice skill before finalizing the wording.
- **Verification**: `e2e/schedule-embed.spec.ts` — assert the embed page shows the attribution link with UTM params and still has zero `application/ld+json` scripts; on the settings page assert the snippet textarea content contains the anchor; `pnpm check` including `check:copy`.

### Give shops a physical address so Event rich results become eligible

- **Priority**: medium
- **Effort**: L
- **Prompt**: Google's Event rich results require `location` to be a `Place` with a `PostalAddress`, but `tripJsonLd` in `src/lib/structured-data.ts` (lines 141–143) can only emit a bare `Place` name because the `shops` table (`src/db/schema.ts` line 34 onward) stores no physical address — so no DiveDay trip can currently earn an Event rich result, and `shopJsonLd`'s `SportsActivityLocation` (whose docstring explicitly says it "is the type that carries an address... if those ever exist") is similarly hollow for local-search purposes. Follow the schema-change skill: add nullable address fields to `shops` (street, locality, region, postal code, ISO country code), run `pnpm db:generate`, expose them in the shop settings page (`src/app/shop/[shopSlug]/settings/`, copy through the staff bundle), and thread them into `ShopForStructuredData` so `shopJsonLd` emits `address` as `PostalAddress` and `tripJsonLd`'s fallback `Place` carries it — all pruned when absent via the existing `pruneJsonLd`, never guessed. This touches rows holding shop data and public output, so keep the fields shop-level business data only (no personal addresses, matching the `contactEmail` docstring's precedent) and get the standard reviews AGENTS.md requires for schema changes.
- **Verification**: `pnpm db:generate` produces a clean migration; unit tests for address emission/pruning in the structured-data tests; seed the demo shop with an address and paste a trip page's JSON-LD into Google's Rich Results Test expecting Event eligibility with no missing-field warnings; `pnpm check` plus e2e where the settings form changed.

### Add an SEO smoke spec covering canonicals, sitemap, and robots

- **Priority**: low
- **Effort**: S
- **Prompt**: Structured-data behavior has e2e coverage (`e2e/reviews.spec.ts:85` and `:97`), but nothing asserts the rest of the SEO surface: canonicals on the schedule/trip/course pages, the embed's canonical pointing at the standalone URL, `robots.txt` disallow rules, `sitemap.xml` shape, and the presence of `og:image`/`twitter:card` on marketing pages. Add a focused `e2e/seo.spec.ts` (Playwright, following the conventions in the e2e-and-visual skill and `e2e/helpers.ts`) that: fetches `/robots.txt` and asserts every token prefix is disallowed and the sitemap URL is present; fetches `/sitemap.xml` and asserts marketing URLs (and, once the sitemap task lands, shop URLs) exist while `/waivers/` never does; loads the seeded shop's schedule with and without `?embed=1` and asserts `link[rel=canonical]` is the standalone URL in both cases; and asserts `meta[property="og:image"]` resolves on `/`. This spec locks in behavior other tasks in this list will change, so land it alongside or after them and coordinate via the Parallel work rules in AGENTS.md (check open PRs touching these specs first).
- **Verification**: `pnpm e2e e2e/seo.spec.ts --reporter=line` green (no literal `--` before args, per AGENTS.md); intentionally break one canonical locally and confirm the spec catches it before reverting.

---

## 5. Security & privacy

Auditor's baseline — explicitly checked and found sound (no task needed): bearer/account token
entropy and hashing (256-bit CSPRNG, SHA-256 at rest, single-use consume with atomic `WHERE`,
supersession, disabled-account re-check); Svix and Stripe signature verification (timing-safe,
fail-closed, 300s replay tolerance); CSV export formula-injection escaping and per-shop scoping;
SSRF guarding in `src/lib/storage/ingest-url.ts` (DNS + private-range checks + no redirects +
bounded reads); tenant isolation in server actions (mutations consistently use
`session.user.shopId`, never the URL slug); the embed/frame-header logic in `src/proxy.ts`; and
observability URL redaction of token path segments. Every task below is security-sensitive and
needs a `security-reviewer` pass before merge per the repo's hard rules.

### Close the revocation window on base staff surfaces

- **Priority**: high
- **Effort**: S
- **Prompt**: `requireStaffSession()` in `src/lib/session.ts` trusts the roles baked into the JWT at sign-in and never re-checks the database, and no `session.maxAge` is set in `src/lib/auth.config.ts` (Auth.js default: 30 days). The H-14 gates in `src/db/authz.ts` (`loadActiveStaffRoles`) already close this for refunds/exports/etc., but base staff surfaces — including the manifest page at `src/app/shop/[shopSlug]/trips/[id]/manifest/page.tsx` and diver profiles, which show medical flags and full rosters — only call `requireStaffSession`. A disabled or deleted staff member therefore keeps read access to PII/medical data for up to 30 days. Add a live check to `requireStaffSession` (person not deleted + `userAccounts.status === "active"`, mirroring `loadActiveStaffRoles`, redirecting to `/sign-in` on failure), and set an explicit shorter `session.maxAge`. This is auth/authz and medical-data-adjacent: it requires a `security-reviewer` pass before merge, and manifests are safety-critical so keep the code boring.
- **Verification**: Test in a new `session.test.ts`: sign in a staff member, set their `userAccounts.status` to `disabled` (and separately soft-delete the person), then assert `requireStaffSession` redirects even though the JWT still carries staff roles. Add an e2e assertion that a disabled staff account gets bounced from `/shop/<slug>/trips/<id>/manifest`.

### Use a CSPRNG for blob object keys holding card images

- **Priority**: high
- **Effort**: S
- **Prompt**: In `src/lib/storage/index.ts`, `vercelBlobStorageProvider.upload` builds the object path with `Math.random().toString(36).slice(2, 10)` and explicitly disables Vercel's own suffix (`"x-add-random-suffix": "0"`). These blobs live on the *public*, unauthenticated `*.public.blob.vercel-storage.com` host, and they include certification-card photos (name, DOB, card number — uploaded via `resolveCardImage` in `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`). URL unguessability is the only access control, yet the suffix is ~41 bits from a non-cryptographic PRNG whose state is observable/predictable. Replace it with `randomBytes(16).toString("base64url")` from `node:crypto` (≥128 bits), matching the discipline `src/lib/bearer-tokens.ts` documents. Do not enable `x-add-random-suffix` instead — keep the key deterministic-in-shape so `isManagedBlobUrl` and the deletion queue keep working. Security-sensitive (personal-data rows): needs a `security-reviewer` pass before merge.
- **Verification**: Extend `src/lib/storage/index.test.ts`: capture the PUT pathname across many uploads and assert the suffix is 22 base64url chars and that two providers created in the same tick never collide; grep the module to assert `Math.random` no longer appears.

### Check Stripe event livemode before mutating payment state

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/api/webhooks/stripe/route.ts` accepts events verified by either `STRIPE_WEBHOOK_SECRET` or the fallback `STRIPE_TEST_WEBHOOK_SECRET`, then applies them identically — `markCheckoutPaidBySessionId`, `markOrderPaidByInvoiceId`, `setShopStripeAccountStatus` — without ever inspecting `event.livemode`. If both secrets are set in a production deployment, a correctly-signed *test-mode* event (which anyone with access to the platform's test environment can generate) reaches the same handlers that flip live orders to paid; only the incidental `cs_test_`/`cs_live_` id mismatch stands in the way. Parse `livemode` in the event schema in `src/lib/payments/webhook.ts` (or in the route) and require that test-secret-verified events carry `livemode: false` and live-secret-verified events carry `livemode: true`, returning 200-and-ignore on mismatch (Stripe retries non-2xx forever). Payments are security-sensitive: needs a `security-reviewer` pass before merge.
- **Verification**: In `src/app/api/webhooks/stripe/route.test.ts`, sign a `checkout.session.completed` with the test secret but `livemode: true` (and vice versa) and assert no checkout/tip row changes state; keep the existing happy paths green.

### Add baseline security headers beyond frame protection

- **Priority**: medium
- **Effort**: M
- **Prompt**: The only security headers the app sets are `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, stamped in `src/proxy.ts` — and its matcher excludes `/api` and static assets, so API responses and images get nothing. There is no HSTS, no `X-Content-Type-Options: nosniff`, no `Referrer-Policy`, no `Permissions-Policy`, and no script/style CSP anywhere (checked `next.config.ts` — it has none). Bearer-token pages (`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`) carry the capability in the URL path, so a missing `Referrer-Policy` risks leaking live tokens to any third-party resource a page ever references. Add a `headers()` block to `next.config.ts` (so it covers all routes including `/api`): `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (consider `no-referrer` for the token routes), and a `Permissions-Policy` disabling camera/geolocation/etc. Keep the frame-header logic in `proxy.ts` — it must stay conditional on the embed exception; make sure the new config headers don't override it. A full script-src CSP is a follow-up, not this task. Read the Next.js docs in `node_modules/next/dist/docs/` first (this Next version differs from training data). Security-sensitive: needs a `security-reviewer` pass before merge.
- **Verification**: `curl -sI` against `pnpm dev` for `/`, `/shop/<slug>/schedule`, `/waivers/<garbage>`, and an `/api` route; assert the four headers everywhere, and that `/shop/<slug>/schedule?embed=1` still arrives frameable while everything else keeps `frame-ancestors 'none'`.

### Give recap tokens their own secret and a lifetime

- **Priority**: medium
- **Effort**: M
- **Prompt**: `src/lib/recap-links.ts` signs recap tokens as a stateless HMAC of the booking id, keyed directly with `authSecret` — the same secret that signs session JWTs — with no expiry and no revocation. Consequences: a recap link (which unlocks a diver's trip data, photo upload, review writing, and tip checkout via `src/app/recap/[token]/actions.ts`) works forever once it leaks from an inbox or forwarded message, and AUTH_SECRET can never be rotated for sessions without silently killing every recap link (and vice versa — the secrets' blast radii are coupled). Derive a dedicated key (e.g. `HKDF(authSecret, "recap")` or a separate `RECAP_LINK_SECRET` env var with fallback derivation) and fold an issued-at timestamp into the signed payload, rejecting tokens older than a generous window (e.g. 180 days — a diver revisiting a season later should still work; pick with the owner). Update the one place tokens are minted (`recapLinkPath`, used by `src/db/recap.ts`) and `e2e/visual.spec.ts`, which computes this token directly. Token-flow change: needs a `security-reviewer` pass before merge.
- **Verification**: Extend `src/lib/recap-links.test.ts`: a token minted with the old raw-`authSecret` scheme fails verification, a token past the window fails while one inside passes (drive via the injectable clock, never a sleep), and the purpose-separation tests still hold.

### Move sign-in and booking rate limits to a shared store

- **Priority**: medium
- **Effort**: L
- **Prompt**: `src/lib/rate-limit.ts` is an in-process token bucket, documented in ADR 20260724-rate-limiting as per-instance only. On the stated Vercel serverless target this makes the sign-in throttle in `src/lib/auth.ts` (20/15min per IP, 8/15min per email) close to a no-op: each cold-started function has fresh buckets, so a distributed credential-stuffing run is bounded only by function fan-out. The seam is already provider-shaped — implement a `RateLimitStore` backed by a shared store (Upstash Redis is the natural Vercel fit; a new runtime dependency requires an ADR per repo rules), keep the existing fail-open contract (`checkRateLimit` must never throw or 500 a request), and fall back to the in-memory store when the env var is absent so dev/e2e stay zero-setup. Wire it only into the store default; call sites don't change. Prioritize this over any per-endpoint tuning. Auth-adjacent and security-sensitive: needs a `security-reviewer` pass before merge.
- **Verification**: Unit tests with a fake remote store: limits enforced across two "instances" sharing the store; a store that throws or times out returns `{allowed: true}`; `DIVEDAY_RATE_LIMIT_DISABLED` behavior unchanged. Manually run the sign-in e2e suite to confirm no throttling regressions in the single-worker fleet.

### Harden the /api/test/* seed endpoints with an explicit shared secret

- **Priority**: medium
- **Effort**: S
- **Prompt**: `src/app/api/test/seed-account-token/route.ts` mints a valid **password-reset token for any account by email** and returns it in the response; `src/app/api/test/reset/route.ts` wipes and reseeds data. Both are guarded only by an env-var predicate (`DATABASE_URL` set, or production-without-`DIVEDAY_E2E`). That guard is sound today but is pure configuration: one misconfigured staging deployment (production build, `DIVEDAY_E2E=1` left set from a CI template, PGlite fallback) turns seed-account-token into instant account takeover. Contrast with `src/app/api/cron/reminders/route.ts`, which already requires a `CRON_SECRET` bearer token in addition to configuration. Add the same pattern: require a `DIVEDAY_E2E_SECRET` bearer header on every `/api/test/*` route (set by the Playwright harness in `e2e/fixtures.ts`), keeping the existing env-var guard as the first check. Token-flow-adjacent: needs a `security-reviewer` pass before merge.
- **Verification**: Route tests asserting 404 without the header even when `DIVEDAY_E2E=1`, and success with it; run one e2e spec that exercises `/verify/[token]` end-to-end to prove the harness wiring works.

### Reduce what a stolen device can read from offline manifests

- **Priority**: low
- **Effort**: L
- **Prompt**: `src/lib/offline-manifest-store.ts` encrypts manifest snapshots (roster names, readiness blockers including medical-flag text rendered via `readinessBlockerText`) with AES-GCM, but the non-extractable `CryptoKey` sits in the **same IndexedDB database** (`KEY_STORE` beside `MANIFEST_STORE`), and the offline viewer at `src/app/offline-manifest/` necessarily works without a session. So the encryption resists only naive file-level inspection: anyone holding an unlocked device can open the viewer, or run origin JS, and read every cached manifest — including after the staff member's session has expired or been revoked. Two proportionate improvements: (1) shrink exposure by tightening `offlineManifestExpiresAt` retention in `src/lib/offline-manifests.ts` (confirm the current window with the owner) and by having sign-out purge records with no pending events; (2) document explicitly in the module header that the at-rest encryption is device-theft mitigation only, so a future contributor doesn't extend the pattern to stronger claims. Do **not** add a PIN-derived key without an ADR and product sign-off — an un-openable manifest during a roll call is a safety failure (H-05), and manifests are safety-critical surfaces requiring a `dive-domain-expert` review; this is also medical-data-adjacent, so it needs a `security-reviewer` pass before merge.
- **Verification**: Test in `offline-manifest-store.test.ts`: after the sign-out purge, records without pending events are gone while one holding a pending roll-call event survives (the evidence-preservation rule must hold); expiry-window change covered by the existing clock-driven expiry tests.

---

## 6. ML & data

Auditor's baseline: the app has no LLM dependency today (new runtime dependency → ADR), a strict
external-HTTP seam pattern (`marine-forecast.ts`/`analytics.ts` + `DIVEDAY_DISABLE_EXTERNAL_HTTP`),
and existing deliberately-conservative heuristics (`demandRecommendation`, `KIND_SEVERITY`) that
should be extended, not replaced with models. At single-shop data scale, SQL aggregates and
transparent scoring beat trained models everywhere except language tasks (moderation, translation,
summarization), where the Claude API is the right tool. **Explicitly rejected as not worth
building now**: training any custom model (every surface is below the data volume where one beats
the existing heuristics), LLM-drafted replies to reviews (the reply feature itself doesn't exist),
LLM anything on cert gating/manifests/medical decisions (hard rule: assistive only — and the
assistive versions below are deliberately model-free), and dynamic pricing beyond the last-minute
rule table (Stripe owns arithmetic; trust risk exceeds upside for a delight-first product).

### Add departure-demand insights to the schedule builder

- **Priority**: high
- **Effort**: M
- **Prompt**: Build a demand-history signal for staff scheduling, grounded in data the app already has: `trips` (startsAt, capacity, status), `bookings` (active statuses `booked`/`checked_in`), and `trip_waitlist_entries`. Add a pure function in a new `src/lib/demand-history.ts` (with `demand-history.test.ts` first) that takes per-slot aggregates and returns codes like `{ code: "underserved_slot", weekday, timeband, avgFillRate, waitlistedTotal }`; add the SQL aggregates (fill rate and waitlist depth grouped by shop-local weekday × morning/afternoon band over the trailing 12 weeks, using `utcToWallTime` from `src/lib/zoned.ts` and `nowDate()` from `src/lib/clock.ts` — never `new Date()`) in a new `src/db/demand-history.ts`. Surface it as one quiet line in the staff schedule builder's route server component (`src/app/shop/[shopSlug]/schedule/`), reusing the existing conservative style of `src/lib/demand.ts` (`demandRecommendation`) — a signal only fires when a slot averaged ≥90% full or carried waitlists across ≥2 recent departures. This is deliberately statistics-not-ML: at a single shop's volume (tens of trips/month) a rolling aggregate is more trustworthy than any forecast model, and it must be presented as guidance, never auto-creating trips. All staff-facing words go through `staff.json` codes per the domain-layer-copy rule; run `pnpm check` and add the surface to `e2e/visual.spec.ts`.
- **Verification**: Unit tests cover the threshold edges (fires at 2 qualifying departures, not 1; empty history returns nothing). Seed data via `createTestDb()` + `src/db/seed.ts` shows the line on `/shop/[slug]/schedule`; `pnpm check` green; visual diff explained in the PR.

### Suggest last-minute deal parameters from past blast outcomes

- **Priority**: high
- **Effort**: M
- **Prompt**: The one-tap last-minute blast exists (`src/db/trip-promos.ts` `sendLastMinuteDealBlast`, history via `listTripLastMinutePromos`, Today surfaces `last_minute_fill` rows via `tripIdsNeverSentLastMinuteDeal`), but staff pick the discount percent blind. Add a pure advisor in a new `src/lib/last-minute-advisor.ts` that, given open-seat ratio, hours until departure, matching `last_minute_list_entries` count (reuse `lastMinuteEntryMatchesTripDate` in `src/lib/last-minute-list.ts`), and the shop's past blasts with their fill outcomes, returns a code-shaped suggestion `{ suggestedPercent, rationale: "many_seats_soon" | "few_seats" | ... }` — a transparent rule table (e.g. ≥50% empty inside 48h → 20–25%; <25% empty → 10%), clamped by `isValidLastMinuteDiscountPercent`. Compute past-blast outcomes in `src/db/trip-promos.ts` as a SQL aggregate: for each `sent` promo, seats booked between `createdAt` and `expiresAt` from `bookings`. Prefill (never auto-send) the discount field on the trip's last-minute-deal form under `src/app/shop/[shopSlug]/trips/**`, with the rationale rendered from `staff.json`. Do not build an ML price model — a shop has single-digit blasts of history; state in the module doc that the rule table is the honest ceiling until there are hundreds of blasts. Stripe still owns all discount arithmetic.
- **Verification**: Table-driven unit tests for every rationale branch and the clamp; a `src/db` test seeding two past blasts asserts the outcome aggregate; open the trip page in dev and confirm the prefilled percent; `pnpm check` green.

### Ship an assistive review-moderation and themes assistant (Claude API)

- **Priority**: high
- **Effort**: L
- **Prompt**: Staff moderate every commented review by hand (`src/db/reviews.ts` `listShopReviewsForStaff`/`setReviewPublished`, queue count in `countReviewsAwaitingModeration`, UI at `src/app/shop/[shopSlug]/reviews`). Add an assistive triage: a new seam module at `src/lib/review-assist/` that calls the Claude API (`@anthropic-ai/sdk`, structured JSON output) to classify each pending comment `{ flags: ("names_third_party" | "contact_info" | "safety_complaint" | "profanity")[], sentiment: "positive"|"mixed"|"negative" }` and, on demand, summarize the trailing 90 days of *published* comments into 3–5 recurring theme codes for the owner. Follow the repo's provider-seam rules exactly: injectable provider defaulting from environment (mirror `src/lib/marine-forecast.ts`), a no-op when `ANTHROPIC_API_KEY` is unset or `DIVEDAY_DISABLE_EXTERNAL_HTTP === "1"`, failures degrade to "no assist" — the moderation queue must work identically with the feature dark. Hard guardrails: the model never publishes or unpublishes anything (`setReviewPublished` remains staff-tap only), flags render as neutral chips whose words live in `staff.json`, and review comments sent to the API contain no diver identity beyond the comment text. This adds a runtime dependency, so write an ADR (`YYYYMMDD-review-assist-llm` id format) and request `security-reviewer` sign-off since it exports user-generated content to a third party.
- **Verification**: Unit tests with a fake provider cover flag mapping, provider-error fallback, and the disabled-env path; `pnpm test src/lib/review-assist --reporter=dot`; manually seed a review with a phone number in dev and see the chip; confirm the queue renders unchanged with the key unset; `pnpm check` green and ADR present.

### Build a translation-drafting script for the locale-coverage ratchet

- **Priority**: high
- **Effort**: M
- **Prompt**: `pnpm check:locale` enforces translation coverage across `src/i18n/locales/<locale>/diver.json` and `staff.json`, which makes every copy extraction a multi-locale chore. Write a dev-time script `scripts/draft-translations.mjs` that diffs each non-English locale file against `en-US`, sends only the missing key/value pairs to the Claude API (one batched request per locale, structured JSON output keyed identically), and writes the drafts back with a `--write` flag (default is a dry-run report, mirroring the `check-copy.mjs` flag conventions). Include the surrounding keys of each missing entry as context so tone matches DiveDay's dive-briefing voice, and instruct the model to preserve ICU placeholders like `{name}` verbatim, validating placeholder parity in the script and rejecting any drafted string whose placeholders differ. Guardrails: drafts land in the working tree for human review in the PR — never auto-committed; waiver/medical wording stays English pending H-01/H-03 (`docs/product/human-decisions.md`), so skip keys under those namespaces; the script reads `ANTHROPIC_API_KEY` from the environment and exits cleanly with a message when unset. Since this is dev tooling, add `@anthropic-ai/sdk` as a devDependency, but still record a short ADR because generated locale text changes what users read.
- **Verification**: Run the script dry against a locale with a deliberately deleted key and confirm the report; run `--write` and confirm `pnpm check:locale` goes green and placeholders survive; a unit-testable pure helper for placeholder-parity checking gets its own test file.

### Detect changed medical answers between a diver's waivers (assistive, never gating)

- **Priority**: medium
- **Effort**: M
- **Prompt**: Waivers store versioned medical questionnaire answers (`waiver_records` in `src/db/schema.ts`, shapes in `src/lib/medical.ts` — `needsPhysicianReview`, `flaggedMedicalPrompts`). Add a pure comparator `medicalAnswerChanges(previous, current)` in `src/lib/medical.ts` returning codes for each question whose answer flipped, distinguishing `yes_to_no` (the one worth a human glance — a previously disclosed condition now undisclosed) from `no_to_yes` (already handled by the physician-review gate). In `src/db/waivers.ts`, when a completed waiver supersedes an older completed one for the same person and shop, compute the diff against the most recent prior record — only comparing answers captured against the same `questionnaireId` (a questionnaire change is not a flip). Surface `yes_to_no` flips as a quiet informational note on the diver record and the roster's medical-review panel, worded in `staff.json` as "answered differently than last time", with the prior date. Absolute guardrails: this is statistics-free, model-free, and must never block boarding, alter `needsPhysicianReview`, create a readiness blocker, or auto-message the diver — it is a prompt for a human conversation only. This touches medical data on a safety-critical surface: write failure-path and adversarial tests (unknown question ids, mismatched questionnaire versions fail closed to "no diff reported") and request both `dive-domain-expert` and `security-reviewer` review.
- **Verification**: Unit tests in `src/lib/medical.test.ts` cover both flip directions, same-answers, and cross-questionnaire no-ops; a `src/db/waivers.test.ts` case with two completed waivers asserts the diff is attached; confirm no readiness/blocker code path imports the new function; `pnpm check` green.

### Recommend the diver's next course step on the recap page

- **Priority**: medium
- **Effort**: M
- **Prompt**: Certification paths exist as guidance (`src/db/course-paths.ts`, including the pure `nextPathStep`), and the recap page (`src/app/recap/[token]`, data in `src/db/recap.ts`) is the highest-intent diver moment the app owns. Add a query in `src/db/course-paths.ts` that, given a person id, joins their highest `certifications` level against each visible path's steps and returns the first step whose course they haven't taken and whose `minimum_certification_level` they meet — reusing `nextPathStep` for the ordering logic rather than duplicating it. Render at most one suggestion on the recap page as a low-key card linking to the public course page (`shop/[shopSlug]/courses/[slug]`), with copy in `src/i18n/locales/<locale>/diver.json` and a `DiverIntlProvider` already above it (verify — a missing provider blanks the whole page). This is a deterministic join, not collaborative filtering: with one shop's enrollment volume, "the next step of the path you're on" is strictly better than any learned recommender, and the module doc should say so. Guidance never gates: admission stays on the course's own `minimum_certification_level` check at booking time. Respect the bearer-token page rules in `docs/engineering/capability-telemetry-runbook.md` — no new data exposure beyond this booking's diver, and no structured data on the token page.
- **Verification**: `src/db/course-paths.test.ts` cases: uncertified diver → entry course, mid-path diver → next step, fully-certified → nothing, hidden path → nothing. E2e assertion on the recap spec that the card shows for the seeded diver; screenshot added to `e2e/visual.spec.ts`; `pnpm check` green.

### Instrument Today-queue outcomes before touching its ranking

- **Priority**: medium
- **Effort**: S
- **Prompt**: The Today ranking (`src/lib/today.ts` `KIND_SEVERITY`, `sortActions`, urgency windows) is hand-coded and well-reasoned; replacing it with learned ranking is unjustified without outcome data, so build the measurement first. Extend the typed event vocabulary in `src/lib/analytics.ts` with one event: `{ name: "today_action_opened"; kind: TodayActionKind; urgency: TodayUrgency; rank: number }`, emitted from the Today page's action taps alongside the existing `staff_recovery`/`blockers_surfaced` events (see `src/db/today.ts` and the Today route under `src/app/shop/[shopSlug]`). Keep it best-effort via `trackEvent` exactly as documented in that file — never awaited in a way that delays navigation, and silent under `DIVEDAY_DISABLE_EXTERNAL_HTTP`. Add a short note in the `src/lib/today.ts` module doc stating the tuning contract: severity constants may only be re-ordered with click-through/recovery evidence from these events, not by taste. Explicitly do not add any model, decay, or personalization now — the deliverable is the data seam plus the documented bar for future changes.
- **Verification**: Type-level exhaustiveness keeps the event union sound (`pnpm typecheck`); a unit test with an injected fake tracker asserts the event fires with the row's rank; `pnpm check` green.

### Score boarding risk as a transparent checklist, not a model

- **Priority**: low
- **Effort**: M
- **Prompt**: "No-show risk scoring" is the classic ML pitch here, but the honest version at this data scale is a visible checklist score: the signals that predict a roll-call problem already exist as rows — unresolved readiness blockers near departure (`src/lib/readiness.ts` / `src/db/readiness.ts`), a prior `roll_call_events` absence for the same person, and a booking made under a heuristic lead-time threshold. Add `boardingAttention(input): { level: "watch" | null, reasons: BoardingAttentionCode[] }` in a new `src/lib/boarding-attention.ts` — additive named reasons, no weights or probabilities, returning `watch` only when ≥2 reasons hold — with the reason-gathering SQL in `src/db/check-in.ts` feeding the existing check-in queue (`listCheckInQueue`). Render it as a neutral informational chip on the check-in queue row with words from `staff.json`. Guardrails: this is safety-adjacent, so it must never gate boarding, never reorder the manifest, and never appear on diver-facing surfaces; prior absence data is sensitive, so the chip shows reasons only on tap and the change gets a `dive-domain-expert` review. Document in the module why a trained classifier is rejected: a shop sees too few no-shows per season to fit anything, and an opaque score on a boarding surface violates the "boring code on safety surfaces" rule.
- **Verification**: Unit tests for each reason and the ≥2 threshold; a db test seeding a past `absent` roll-call event asserts the reason surfaces; check-in e2e spec still passes; `pnpm check` green.

### List lapsed regulars for staff win-back (SQL, staff-initiated)

- **Priority**: low
- **Effort**: M
- **Prompt**: Churn signals for a dive shop are diver-level and computable with one aggregate: a person whose merged history (`src/lib/prior-visits.ts` `mergeShopHistory` semantics — native `bookings` plus imported `prior_visits`) shows ≥3 lifetime visits but none in the trailing 12 months is a lapsed regular. Add `listLapsedRegulars(db, shopId, now)` in `src/db/divers.ts` (thresholds as named constants in a small pure helper in `src/lib/` with tests, clock via `nowDate()`), counting a prior visit only when `priorVisitStanding` says `recorded`, and excluding deleted people. Surface it as a filter or section on the staff divers list (`src/app/shop/[shopSlug]/divers`), showing last-visited date and a link to the diver record — from which staff can already add the person to the last-minute list (`src/db/last-minute-list.ts`), which is the consent-carrying channel for outreach. Hard guardrail: no automatic emailing — `sendNotificationBatch` must not be wired to this list; DiveDay surfaces the fact, the human decides the outreach, keeping the shop on the right side of marketing-consent rules. No ML: recency/frequency thresholds are the entire method, and the module doc should note that an RFM-style weighted score can come later only if shops ask for ordering within the list.
- **Verification**: db test seeds a 3-visit diver with an old last booking (frozen clock) and asserts inclusion; cancelled-status prior visits don't count toward the 3; the divers page renders the section in dev; `pnpm check` green plus a `security-reviewer` glance since it aggregates personal history.

---

## 7. Backend & data architecture

Auditor's baseline — explicitly checked and found sound (no task warranted): the booking capacity
transaction (`FOR UPDATE` on the trip row before the count, `src/db/bookings.ts:126`); payment
final-status regression guards (`src/db/payments.ts:21`); checkout completion idempotency and
promo-redemption dedupe; the notification outbox with idempotency keys, claim-based draining safe
for overlapping crons, and append-only attempt history; money as integer cents with DB check
constraints throughout; keyset pagination on divers and the schedule; waiver records
superseded-never-deleted with an integrity HMAC; append-only roll-call events with client-event
idempotency keys; and departure timezone handling via `timestamptz` + `wallTimeToUtc` +
`shops.timezone`.

### Guard order status transitions in the Stripe webhook mark functions

- **Priority**: high
- **Effort**: M
- **Prompt**: In `src/db/orders.ts`, `markOrderPaidByInvoiceId` (line 333) and `markOrderVoidedByInvoiceId` (line 347) are called from `src/app/api/webhooks/stripe/route.ts` and feed `applyOrderUpdate` (line 277), which re-reads the order inside a transaction but takes no `FOR UPDATE` lock and enforces no transition rules — it writes whatever status it is given. A replayed or out-of-order `invoice.voided` event will flip a `paid` (or `refunded`) order to `void`, and a replayed `invoice.paid` after `refundOrder` flips the order row back to `paid` (the booking-payment row is protected by `setBookingPaymentIfNotFinal` in `src/db/payments.ts`, but the `orders` row itself is not). Compare `voidOrder` (line 360), which correctly requires `status === "open"` — the webhook path lacks that guard. Add `.for("update")` to the re-read in `applyOrderUpdate` and an explicit allowed-transition table (e.g. `open→paid`, `open→void`, `paid→refunded`; a repeat of the same status is an idempotent no-op), logging a refusal code (codes, not sentences — domain-layer rule) when a webhook tries an illegal transition. No schema change needed.
- **Verification**: New cases in `src/db/orders.test.ts`: (1) `markOrderPaidByInvoiceId` replayed after `refundOrder` leaves status `refunded`; (2) `markOrderVoidedByInvoiceId` on a `paid` order leaves it `paid`; (3) a replayed `invoice.paid` on an already-paid order is a no-op success. Run `pnpm test src/db/orders.test.ts --reporter=dot`, then `pnpm check`.

### Add structured logging to the payment webhook and cron paths

- **Priority**: high
- **Effort**: M
- **Prompt**: There is no observability on the money path: `src/app/api/webhooks/stripe/route.ts` contains zero log statements — no event id, type, connected account, or handler outcome — so a `markCheckoutPaidBySessionId` returning `null` (session unknown, or refused as disqualified) is a silent 200 and the event vanishes untraceably. `package.json` has no logging/tracing dependency, and the few existing logs (`console.error` in `src/db/payments.ts:128,147`, `src/db/checkouts.ts:294`, `console.warn` in `src/lib/notifications/index.ts:663,706`) are ad-hoc shapes. Create a small `src/lib/log.ts` that emits one structured JSON line (`event`, `level`, plus a context object) over `console` — no new runtime dependency, so no ADR needed. Use it in the Stripe webhook route (log `event.id`, `event.type`, `event.account`, and each handler's outcome including `null`/refused results), in the Resend webhook route (`src/app/api/webhooks/resend/route.ts` — log the `applyProviderEmailEvent` result: applied/stale/unknown_message), and in `src/app/api/cron/reminders/route.ts` (log the per-scan summaries it already computes). Migrate the existing `console.error` call sites in `payments.ts`/`checkouts.ts` to the same helper. Log codes and ids only — never email addresses, names, or medical data.
- **Verification**: Unit test for `src/lib/log.ts` output shape; extend `src/lib/payments/webhook.test.ts` or add a route-level test asserting a log line is emitted per handled event (spy on the logger). Run `pnpm check`.

### Add per-person indexes on bookings and orders

- **Priority**: medium
- **Effort**: S
- **Prompt**: The `bookings` table in `src/db/schema.ts` (line 735) has only `bookings_trip_person_unique (trip_id, person_id)` and `bookings_trip_idx (trip_id)` — nothing leads with `person_id` or `shop_id`, so every per-diver lookup sequential-scans bookings: `getDiverProfile` in `src/db/divers.ts` (~line 485, `where shopId + personId`), `listPersonBookingPayments` in `src/db/payments.ts` (line 190, joins bookings on `personId`), and the diver-history joins in `src/db/waitlist.ts`/`src/db/recap.ts`. Similarly `orders` (schema line 1284) indexes `(shop_id, status)` and `(shop_id, booking_id)` but not `(shop_id, person_id)`, which `listOrdersForPerson` in `src/db/orders.ts` filters on for the same profile page. Add `bookings_shop_person_idx` on `(shop_id, person_id)` and `orders_shop_person_idx` on `(shop_id, person_id)`. This is a schema change: follow the **schema-change** skill — edit `src/db/schema.ts` only, then `pnpm db:generate`; never hand-edit `drizzle/`.
- **Verification**: `pnpm db:generate` produces a migration containing only the two `CREATE INDEX` statements; existing suites `pnpm test src/db/divers.test.ts --reporter=dot` and `pnpm test src/db/orders.test.ts --reporter=dot` stay green; `pnpm check` passes.

### Dedupe Stripe webhook events and cross-check the connected account

- **Priority**: medium
- **Effort**: M
- **Prompt**: `src/app/api/webhooks/stripe/route.ts` has no event-id ledger: idempotency currently depends entirely on each handler's state machine, and `account.updated` (line 103) is pure last-write-wins — two `account.updated` events delivered out of order can leave `charges_enabled` regressed to a stale value in `shop_stripe_accounts`, and that flag gates order creation. Add a `stripe_webhook_events` table (event id as unique key, plus type/account/received_at) via the **schema-change** skill (`pnpm db:generate`); at the top of `POST`, claim the event with an `onConflictDoNothing` insert and return 200 immediately when the row already exists (use `isUniqueConstraintViolation` from `src/db/client.ts` if racing). While there, add a defense-in-depth check that `event.account` matches the stored `stripeAccountId` on the checkout/order/tip row being marked (the handlers currently key on globally-unique Stripe ids alone). Keep the handlers' existing state-machine guards — the ledger is belt-and-suspenders, not a replacement.
- **Verification**: New test (route-level or a small `src/db` helper test) asserting the second delivery of the same event id performs no state change — e.g. mark checkout paid, flip the payment to `refunded` via `setBookingPayment`, replay the identical event, assert still `refunded`. Plus an out-of-order `account.updated` test once the ledger exists. Run `pnpm check`.

### Make applyProviderEmailEvent a single conditional update

- **Priority**: low
- **Effort**: S
- **Prompt**: `applyProviderEmailEvent` in `src/db/notifications.ts` (lines 511–537) does a read-then-write with no transaction or lock: it selects the delivery row, checks `statusAt > occurredAt` for staleness, then updates. Two Resend webhook deliveries landing concurrently (e.g. `delivered` and a later `bounced`) can interleave so the older event's status wins, and staff see "delivered" for a bounced waiver email. Replace it with one atomic `UPDATE notification_deliveries SET ... WHERE provider_message_id = $1 AND (provider_status_at IS NULL OR provider_status_at <= $2) RETURNING id`, then distinguish `unknown_message` (no row with that message id at all) from `stale` (row exists but the condition filtered it) with a follow-up existence check only on the empty-result path. No schema change. The webhook route in `src/app/api/webhooks/resend/route.ts` needs no change.
- **Verification**: Extend `src/db/notifications.test.ts`: apply a `delivered` event with `occurredAt` T2, then a `bounced` event with T1 < T2 — assert the result is `"stale"` and the stored status remains `delivered`; keep the existing `unknown_message` case green. Run `pnpm test src/db/notifications.test.ts --reporter=dot`.

### Fix DST drift when moving or duplicating multi-day trips

- **Priority**: medium
- **Effort**: M
- **Prompt**: `moveTrip` in `src/db/trips.ts` (lines 711–757) and `duplicateTrip` (line 833) shift `endsAt` and every `trip_schedule_days` row by the same absolute millisecond delta (`deltaMs = newStartsAt - oldStartsAt`). The new `startsAt` itself is correct — the schedule actions compute it with `wallTimeToUtc` from `src/lib/zoned.ts` — but when the moved span crosses a DST transition in the shop's timezone (e.g. a 3-day course moved from March 6 to March 13 across US spring-forward), day 2 and 3 land an hour off their published wall-clock time, and `endsAt` drifts the same way. Rework both functions to shift by preserving wall-clock time in the shop's timezone: fetch `shops.timezone`, convert each stored instant to shop-local wall time (helpers in `src/lib/zoned.ts` — extend it if a UTC→wall inverse is missing, with its own unit tests), apply the calendar-day delta, and convert back with `wallTimeToUtc`. Domain logic stays in `src/lib`/`src/db`; use `nowDate()` from `src/lib/clock.ts` for any time reads. No schema change.
- **Verification**: Failing-first regression tests in `src/db/trips.test.ts`: move a trip with schedule days across a DST boundary for a `America/New_York` shop and assert each day's wall-clock hour is preserved; same for `duplicateTrip`. Run `pnpm test src/db/trips.test.ts --reporter=dot`, then `pnpm check`.

### Wrap staff cancelBooking in one transaction

- **Priority**: low
- **Effort**: S
- **Prompt**: `cancelBooking` in `src/db/bookings.ts` (lines 401–413) updates the booking to `cancelled` and then calls `revokeBookingCapabilities` as a second, separate statement on `db` — if the process dies or the revoke throws between the two, the booking is cancelled while its bearer capabilities remain unrevoked (the code's own comment concedes it then relies solely on `verifyBookingCapability`'s status join failing closed, which the revoke exists to stop depending on). The self-service path already does this correctly: `selfCancelBooking` (line 444) runs both inside `db.transaction`. Wrap `cancelBooking`'s update + revoke in a `db.transaction(...)` the same way, passing the `tx` into `revokeBookingCapabilities` (see line 485 for the existing `tx as unknown as AppDb` pattern). Behavior is otherwise unchanged; no schema change. This touches token-flow code, so per AGENTS.md hard rules flag the PR for a `security-reviewer` pass.
- **Verification**: Test in `src/db/bookings.test.ts` asserting that after `cancelBooking` the booking is `cancelled` AND its capabilities rows are revoked atomically (e.g. inject a failing revoke via a mock/erroring tx and assert the booking status rolled back to `booked`). Run `pnpm test src/db/bookings.test.ts --reporter=dot`.

### Trim production cold-start work and configure the pg Pool

- **Priority**: low
- **Effort**: M
- **Prompt**: In `src/db/client.ts`, every production cold start of every serverless instance runs a transaction that takes the `pg_advisory_xact_lock`, then executes `seedIfEmpty`, `backfillDemoReportingData`, and `backfillLegacyNitroxOffering` (lines 79–100) — three scans of a 4,400-line seed module's checks — before the first request can be served, and concurrent cold instances serialize on that advisory lock. Also the `Pool` (line 72) is created with all defaults: no `max` (defaults to 10 connections per instance, which multiplies badly across serverless instances against Neon), no `idleTimeoutMillis`, no `connectionTimeoutMillis`. Two changes: (1) give the seed/backfill block a cheap fast-path — e.g. a single `SELECT` against a small marker (a settings row or the existing demo-shop slug) that skips the lock + backfills entirely when already done, keeping the current path for a genuinely fresh database; (2) configure the Pool (`max` ~5, `idleTimeoutMillis`, `connectionTimeoutMillis`), reading overrides from env via `src/lib`-level config, and document the choice in the code comment. Keep `createTestDb` untouched. No schema change unless you choose a marker table — if so, follow the **schema-change** skill.
- **Verification**: Existing `pnpm test src/db/seed.test.ts --reporter=dot` and `src/db/connection-string.test.ts` stay green; add a test asserting the fast-path skips the backfills when the marker is present (spy/counter on `seedIfEmpty`). Run `pnpm check` and boot `pnpm dev` once to confirm the PGlite branch still migrates and seeds.

---

## 8. Developer & agent experience

Auditor's baseline: the test infra is unusually well-engineered (frozen clock, PGlite template
snapshots, per-worker e2e servers, warm-up in global setup); the biggest wins are stale docs,
`task:context` coverage gaps, and e2e iteration cost. **Notable discovery**: the ~1,000-string
copy backlog is finished — both baselines are empty and `pnpm check:copy` reports 0 — but
AGENTS.md still tells every session the backlog exists (first task below). This also means the
"translation-drafting script" task in §6 serves ongoing locale maintenance, not backlog clearing.

### Update the stale copy-backlog story now the ratchet has hit zero

- **Priority**: high
- **Effort**: S
- **Prompt**: The copy-extraction backlog is complete: `scripts/copy-baseline.json` and `scripts/domain-strings-baseline.json` contain only their `//` note, and `node scripts/check-copy.mjs` reports "0 strings across 0 files still to extract". But `AGENTS.md` (the check:copy Hard rule) still says "~1,000 strings across 110 files are still to extract — that number is the honest state of it", and the docblock of `scripts/check-copy.mjs` (lines 10-14) still says "Around a thousand English strings are still compiled into src/app and src/components". Update both to state the new reality: the baseline is empty, so the ratchet now behaves as a full gate — any hard-coded copy anywhere under the guarded roots fails. Also soften `docs/product/shipped.md` line 41 to past tense. Replace numeric claims with a pointer to the baseline files so this class of drift cannot recur; do not change any enforcement behavior in the script.
- **Verification**: `pnpm check:repo` stays green; `grep -rn "1,000\|thousand.*extract" AGENTS.md scripts/check-copy.mjs` returns nothing present-tense; the `--report` and `--write` flags still behave identically.

### Add task:context areas for payments, notifications, reviews, and data portability

- **Priority**: high
- **Effort**: M
- **Prompt**: `scripts/task-context-data.mjs` covers 12 areas (waivers, certifications, rental-fit, manifests, nitrox, courses, today, design, brand-voice, database, bookings, auth) but AGENTS.md's route map shows large shipped domains with no area: payments/orders/refunds (`src/lib/payments/`, `src/db/orders.ts`, `payments.ts`, `checkouts.ts`, `refunds.ts`, `stripe-accounts.ts`), notifications (`src/lib/notifications/`, `src/db/notifications.ts`, `docs/engineering/resend-email-runbook.md`), reviews and promo codes (`src/lib/reviews.ts`, `src/lib/promo-codes.ts`, `src/db/reviews.ts`, `src/db/shop-promos.ts`, `src/db/trip-promos.ts`), and data portability (`src/db/export.ts`, `src/db/import.ts`, `e2e/export.spec.ts`, `e2e/import.spec.ts`). Add these areas following the existing shape (goal, docs, code, tests, invariants, validate), pulling invariants from the corresponding tests and ADRs, and citing focused validate commands like `pnpm test src/db/orders.test.ts --reporter=dot`. Also refresh stale goals in existing areas: "Build the M3 waiver flow", "Build M6 manifests", and "Build M7 nitrox fill logging" describe milestones that shipped (see `docs/product/shipped.md`) — reword to maintenance/extension goals. Every `docs` entry must exist on disk because `scripts/check-agents.mjs` enforces it. Mark payments and export/import invariants as security-sensitive per AGENTS.md's Hard rules.
- **Verification**: `pnpm task:context payments` (and each new area) prints a complete context sheet with no "(planned or not present yet)" annotations on files that exist; `pnpm check:agents` is green; running `pnpm task:context` with no argument lists the new areas.

### Add a no-rebuild e2e iteration script

- **Priority**: high
- **Effort**: S
- **Prompt**: `pnpm e2e <spec>` in `package.json` always runs `e2e:build` (a full `next build`) before Playwright, so every focused iteration on one spec pays minutes of rebuild; `playwright.config.ts` (line ~106) already documents that `playwright test` directly reuses whatever build is on disk, but no pnpm script or AGENTS.md row exposes that. Add an `e2e:run` script — `pnpm e2e:browser-check && playwright test` — plus a tiny guard (a few lines in `scripts/`, or inline) that fails with a clear message pointing at `pnpm e2e:build` when `.next/BUILD_ID` is missing, and warns (not fails) when any file under `src/` is newer than `.next/BUILD_ID`, so a stale build never silently produces confusing failures. Document it in the AGENTS.md Commands table as the iterate-fast path ("build once with `pnpm e2e:build`, then `pnpm e2e:run <spec> --reporter=line`") and mention it in `.claude/skills/debug/SKILL.md` and `.claude/skills/e2e-and-visual/SKILL.md`. Keep `pnpm e2e` unchanged as the full, correct-by-construction path. Remember the repo rule: never a literal `--` before forwarded args.
- **Verification**: After one `pnpm e2e:build`, `pnpm e2e:run e2e/nitrox.spec.ts --reporter=line` runs the spec without rebuilding (seconds of startup, not minutes); deleting `.next/BUILD_ID` makes `pnpm e2e:run` fail with the actionable message; `touch src/lib/trips.ts` produces the staleness warning; `pnpm check` stays green.

### Close the src/features blind spot in the copy safeguards

- **Priority**: medium
- **Effort**: S
- **Prompt**: The copy scanners have a coverage hole: `scripts/check-copy.mjs` guards only `["src/app", "src/components"]` (line 72) and `scripts/check-domain-strings.mjs` guards only `["src/lib", "src/db"]` (line 33), so a feature module under `src/features/` — an architecture the repo is actively growing (ADR 20260730-feature-module-contracts, first module `src/features/calendar-sync/`) — can return English sentences or even contain `.tsx` copy without either check firing. Add `src/features` to `guardedRoots` in `scripts/check-domain-strings.mjs` (feature modules sit on the lib/db side of the `app → features → lib/db` dependency rule, so the codes-not-sentences discipline applies) and update that file's docblock and the docblock in `check-copy.mjs` (lines 55-60) that describes the division of labor between the two scanners. Do not add baseline entries: the current `src/features` content should already be clean, so any hits are real leaks to fix in the same change.
- **Verification**: `pnpm check:domain-strings` stays green on the current tree; temporarily adding `export function f() { return { message: "Your calendar feed is ready to use" }; }` to a file under `src/features/calendar-sync/` makes it fail with the file:line sample output, and reverting restores green.

### Turn check:repo into one parallel runner with uniform output

- **Priority**: medium
- **Effort**: M
- **Prompt**: `pnpm check:repo` in `package.json` (line 35) chains ten separate `pnpm check:*` invocations with `&&`, so every run pays ten serial pnpm-plus-node startups and stops at the first failure, hiding any later failures a session would otherwise fix in the same pass. Write `scripts/check-repo.mjs` that spawns the ten existing check scripts (`check-env.mjs`, `check-architecture.mjs`, `check-clock.mjs`, `check-adrs.mjs`, `check-doc-links.mjs`, `check-agents.mjs`, `check-source-text.mjs`, `check-locale.mjs`, `check-copy.mjs`, `check-domain-strings.mjs`) concurrently with `node`, buffers each one's output, prints each check's existing one-line success or full failure block under a clear per-check header, and exits non-zero if any failed — reporting all failures, not just the first. Point the `check:repo` package.json script at it and keep every individual `check:*` alias unchanged for focused runs. Do not modify the check scripts themselves.
- **Verification**: `time pnpm check:repo` is measurably faster than the chained version and prints all ten success lines; introducing two independent violations (e.g. a `new Date()` in `src/lib/format.ts` and a hard-coded string in a `src/components` file) reports both in one run; reverting restores green.

### Make check-agents verify AGENTS.md route-map paths

- **Priority**: medium
- **Effort**: M
- **Prompt**: `scripts/check-agents.mjs` validates skills, reviewer agents, and task-context docs, but nothing validates the file paths in AGENTS.md itself — the primary navigation surface every session reads first — so a rename silently misroutes all future sessions (the stale ~1,000-string claim shows AGENTS.md does drift). Extend `check-agents.mjs` with a step that extracts backtick-wrapped repo paths from `AGENTS.md` (tokens matching `src/...`, `scripts/...`, `docs/...`, `e2e/...`, `.claude/...`) and asserts each exists on disk, skipping any token containing `*` or `<`, and treating bracketed segments like `[shopSlug]` literally since those directories exist verbatim. Follow the file's existing pattern: push a descriptive message into `problems` naming the missing path and the fix expectation. Keep the check tolerant of prose — only tokens that start with one of those prefixes count. Update the summary line to include the count of verified paths.
- **Verification**: `pnpm check:agents` passes on the current tree; temporarily editing an AGENTS.md route-map entry to `src/lib/does-not-exist.ts` fails with a message naming that path; reverting restores green.

### Add a changed-files unit test script

- **Priority**: low
- **Effort**: S
- **Prompt**: The repo has `pnpm test <file>` for focused runs and the full `pnpm test` (~1,449 tests, ~190s per the comment in `vitest.config.ts`), but nothing in between: a session that touched three modules must either hand-pick test files or pay the full suite. Add `"test:changed": "vitest run --changed origin/main --reporter=dot"` to `package.json` scripts, and document it in the AGENTS.md Commands table as the mid-iteration option ("run tests affected by your diff against main; still run full `pnpm check` before commit"). Confirm the flag works with vitest 4 and this config (threads pool, PGlite global setup) before documenting; if `origin/main` is not always fetched in worktrees, prefer `--changed HEAD~1`-style guidance in the doc row instead of baking a ref that can be missing. Do not weaken the Hard rule that `pnpm check` (full suite) remains the pre-commit bar.
- **Verification**: With an uncommitted edit to `src/lib/trips.ts`, `pnpm test:changed` runs only the affected test files and passes; with a clean tree it runs nothing or exits green quickly; `pnpm check` still runs the full suite.

### Deduplicate CI job setup with a composite action

- **Priority**: low
- **Effort**: M
- **Prompt**: All seven jobs in `.github/workflows/ci.yml` repeat the same four setup steps (checkout, `pnpm/action-setup@v6`, `actions/setup-node@v7` with node 22 + pnpm cache, `pnpm install --frozen-lockfile`), and the two Playwright jobs additionally duplicate the browser-cache block including its long `-shell` key comment — eight near-identical stanzas that must be edited in lockstep, which is exactly the drift the repo's safeguards elsewhere exist to prevent. Create `.github/actions/setup/action.yml` (composite) holding the pnpm/node/install steps, and a second `.github/actions/playwright-shell/action.yml` holding the `~/.cache/ms-playwright` cache plus `pnpm exec playwright install --only-shell chromium`, moving the existing explanatory comments into the composite files so the rationale is not lost. Keep `actions/checkout` in each job (the visual job needs its special `fetch-depth: 0` variant untouched) and keep all job-level `timeout-minutes`, shard matrices, artifact steps, and env blocks exactly as they are. This is a refactor only — the effective step sequence per job must be unchanged.
- **Verification**: Push to a branch and confirm all CI jobs run green with identical step behavior (install hits the pnpm cache, Playwright jobs hit the `-shell` browser cache); `git diff --stat` shows ci.yml shrinking substantially with no behavioral edits outside the extracted steps.

---

## Cross-cutting notes for whoever sequences this work

- **Overlapping files**: `src/app/globals.css` is touched by four a11y tasks and two UX tasks;
  `ScheduleBuilder.tsx` by one UX, one a11y, and one performance task; the root `layout.tsx`
  `lang` fix (§3) constrains the marketing-page caching task (§2) — land them with awareness of
  each other or in one slice per file. The Stripe webhook is touched by one security task
  (livemode) and two backend tasks (transition guards, event ledger) — natural single slice.
- **Two auditors independently flagged** the hard-coded `<html lang="en">` (a11y + SEO) and the
  silent/underspecified Stripe webhook handling (security + backend) — treat those as
  high-confidence findings.
- **Reviews required by repo rules**: every §5 task and several others (search route move,
  robots.txt, cancelBooking, medical-diff, review-assist LLM) need `security-reviewer`;
  medical/boarding/manifest-adjacent tasks need `dive-domain-expert`.
- **Line numbers are as of 2026-07-31** and will drift; treat them as anchors, not gospel —
  re-locate by symbol name.
