# 20260801-cache-components-e2e-activity-migration — Make the e2e suite Activity-safe before re-enabling `cacheComponents`

- **Status:** Accepted — Phases 1-4 landed; `cacheComponents: true` is back on. See "Outcome"
  below for what Phase 2's full-suite proof actually found: the `getByRole`/`getByLabel`
  discrepancy this ADR flagged rather than resolved (see Context) turned out real, and three
  genuine (non-locator) bugs, not just strict-mode noise.
- **Date:** 2026-08-01

## Context

Commit d8e7b32 turned on `nextConfig.cacheComponents` to cache seven marketing pages
(`/`, `/pricing`, `/product`, `/about`, `/switching`, `/switching/[competitor]`,
`/switching/spreadsheet`) per negotiated locale via `"use cache"`. The flag is app-wide, not
per-route: per `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md`
("Navigation with Activity"), it also unconditionally turns on React `<Activity>`-based state
preservation for client-side navigation everywhere — the previous route is set to
`<Activity mode="hidden">` instead of unmounting, so back-navigation is instant. The doc is
explicit that the retention window is a heuristic, not a fixed count ("Next.js uses heuristics to
keep a few recently visited routes 'hidden', while older routes are removed from the DOM"); an
earlier draft of this ADR asserted a specific number ("up to 3") that isn't in the documented
contract and shouldn't be relied on. Real visitors never see the hidden tree.

**Verified against the bundled docs (`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`,
"Testing" section) rather than assumed:** hidden Activity content keeps `display:none` but stays
in the DOM, and the actual Playwright risk is narrower than "every locator breaks." `getByRole`,
`getByLabel`, and `getByPlaceholder` query the accessibility tree, which already excludes hidden
elements — the docs call this out explicitly ("`getByRole` is robust to Activity... It queries the
accessibility tree, which excludes hidden elements") and show it as the *recommended* pattern, not
a hazard to guard against. `getByText` and a raw `.locator()` call (CSS/text selector used as a
final matcher, not just a scoping ancestor before a chained `getByRole`) are the ones that don't
filter automatically and are the documented risk: the docs' own example labels
`page.locator('.product-card').first().click()` "Avoid — may match hidden elements in Activity
boundaries" and recommends `.filter({ visible: true })` instead.

That materially narrows the fix. Against this repo's suite: `grep -c getByText e2e/*.spec.ts`
totals **346 call sites across 46 spec files** (versus 1,434 `getByRole`/`getByLabel` call sites
that the docs say are already safe), plus some share of **227 raw `.locator()` calls**, not all of
which are leaf matchers — many chain into a `.getByRole()`/`.getByLabel()` immediately after and
inherit that safety; each needs a one-time look during Phase 1 to sort "scoping ancestor" (safe)
from "leaf matcher" (needs `.filter({ visible: true })`).

**One discrepancy this ADR flags rather than resolves:** commit 100fcf8's revert message describes
the original CI failures as hitting `getByLabel` as well as `getByText` ("Playwright's
`getByLabel`/`getByText` locators don't reliably filter it out"), which doesn't match the bundled
docs' claim that `getByLabel` is accessibility-tree-based and already visibility-safe. This ADR
does not have a way to adjudicate that from static analysis alone — Phase 2 (the full suite run
with the flag actually on) is what settles it empirically, and if `getByLabel` genuinely breaks
too despite the docs, Phase 1's fixture wrapper should cover it as well, not just `getByText`.

Every spec in the suite imports its `test`/`expect` from one place, `e2e/fixtures.ts`
(`docs/engineering/testing.md` — "Every spec imports `test`/`expect` from `e2e/fixtures.ts`, not
`@playwright/test` directly"). That existing choke point is what makes this tractable regardless
of which locators end up needing the fix: it belongs in the fixture, not in per-spec call sites.

Commit 100fcf8 reverted the flag the same day: CI on PR #286 failed 22+ pre-existing e2e specs
across unrelated surfaces (sign-in, divers, dive-sites, export, manifest, booking, courses,
waivers) on this failure mode. ADR 20260801-cache-components-activity-state.md (now Superseded)
did the AGENTS.md-required safety audit of `/shop/**` for a *different* Activity hazard —
component-local `useState`/`useRef` silently surviving a hide/reshow cycle — and landed six
defensive fixes that are still in the tree, inert until the flag is back on. That ADR's closing
line: "Kept for the day this app deliberately re-adopts `cacheComponents` with its own e2e
migration plan." This ADR is that plan.

**`@next/playwright`'s `instant()` helper, evaluated and not a fit for this problem.** Commit
100fcf8's message cited "Next's own `instant()` helper and an 'optimizer' skill for exactly this
problem," which this ADR originally repeated without having read the source. Having now installed
dependencies and read `node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`
directly: `@next/playwright`'s `instant(page, callback)` is real and does exist on npm, but it
solves a different problem — scoping assertions to only the static shell during a navigation, to
catch a route that stops rendering instantly. It has nothing to do with hidden-Activity-tree
locator matching; adopting it doesn't address Phase 1 below. It may be worth adding later, in
Phase 3, as a regression guard on the *reason* the marketing pages are being cached (that they stay
instant), but that is a separate, optional addition, not a substitute for the locator-safety work.

## Decision

Land the Activity-safe testing convention *before* re-enabling the flag, as its own PR, proven
green against the flag turned on locally — then re-enable the flag in a second PR once that bar
is met.

**Phase 1 — Activity-safe locators at the fixture choke point.**
`getByRole`/`getByLabel`/`getByPlaceholder` are already visibility-safe per the bundled docs — do
not touch them. In `e2e/fixtures.ts`, wrap the `page` fixture's `getByText` so it resolves only
against the currently-visible route tree, using the pattern the docs themselves recommend:
`page.getByText(text).filter({ visible: true })`, applied once at fixture construction so every
spec's existing `getByText` call sites are unchanged. Then do a one-time pass over the 227 raw
`.locator()` call sites: leave alone any that only scope a subsequent `.getByRole()`/`.getByLabel()`
chain (that chain's own visibility-safety already applies), and add the same `.filter({ visible: true })`
to any used as a final matcher (a direct `.click()`, `.fill()`, `.textContent()`, or count/visibility
assertion on the raw locator). If Phase 2 shows `getByRole`/`getByLabel` breaking too (see the
discrepancy noted in Context), extend the same fixture wrapper to them — the fixture is still the
one place to make that change regardless of which locators end up needing it.

Exceptions: a spec that legitimately asserts on a *hidden* element (e.g. `toBeHidden()`, or an
`aria-hidden` dialog backdrop) should reach for a documented escape hatch — an
`untypedPage`/`page.locator(...)` without the wrapper, exported alongside `page` from the same
fixture — rather than lose the default safety.

**Phase 2 — full-suite proof, flag on, uncommitted.**
Turn `cacheComponents: true` back on locally (do not merge net-new marketing-page caching yet)
and run `pnpm e2e` full suite. Triage failures into two buckets:
- Locator strict-mode violations the Phase 1 wrapper didn't catch — this is also where the
  `getByLabel` discrepancy from Context gets settled: if `getByLabel` failures show up despite the
  docs' claim, that's real signal to widen Phase 1's fixture wrapper, not a surprise to explain away.
- Genuine Activity-preserved-state bugs, the same class ADR 20260801-cache-components-activity-state.md
  found for `/shop/**`. That audit was scoped to staff routes only; Activity is app-wide, so this
  phase must repeat the audit's method (an unkeyed `useState`/`useRef` in a client component
  survives a hide/reshow) across the public/bearer-token surfaces that audit didn't cover:
  marketing pages, `/onboard`, `/forgot-password`, `/sign-in`, and every bearer-token page
  (`/waivers/[token]`, `/ready/[token]`, `/recap/[token]`, `/verify/[token]`,
  `/reset-password/[token]`, `/calendar/[token]`). Get a `dive-domain-expert` review pass on any
  finding that touches a safety-critical surface per AGENTS.md, same as the original audit.

**Phase 3 — re-enable, in its own PR.**
Once Phase 2 is fully green, re-apply commit d8e7b32's `cacheComponents: true` + marketing-page
`"use cache"` hoisting (it reverted cleanly against current `main`, so it can be reapplied rather
than re-authored) alongside the Phase 1 fixture change and any Phase 2 fixes. Run `pnpm visual`
and inspect every diff: Activity's `display:none` trees are unpainted, so `fullPage` screenshots
should be unaffected, but this is a claim to verify, not assume — check at least one capture that
follows a client-side navigation (e.g. a spec that navigates staff pages in sequence) for a
stray hidden-tree artifact before trusting the rest of the baseline set.

**Phase 4 — make it the standing convention.**
Update `docs/engineering/testing.md` and the `e2e-and-visual` skill to state the Activity-safe
locator rule as a permanent convention (not a one-time migration), so a spec written after this
lands doesn't regress to a bare `@playwright/test` import. If a `pnpm check:architecture`-style
guard is cheap to add (flagging a spec file that imports `test`/`expect` from `@playwright/test`
instead of `./fixtures`, the existing rule `docs/engineering/testing.md` already states in prose),
add it — same spirit as the "recommendation, not built here" closing note in the superseded ADR.

## Alternatives considered

- **Rewrite all 346 `getByText` call sites (plus the risky share of the 227 raw `.locator()`
  calls) by hand** — rejected; same outcome as the fixture wrapper with a many-file diff instead
  of a one-file one, and any spec written afterward would need to remember the pattern by hand
  instead of getting it for free through the shared fixture.
- **Wrap `getByRole`/`getByLabel` too, preemptively, alongside `getByText`** — rejected for Phase
  1; the bundled docs say they're already visibility-safe, and wrapping code that doesn't need it
  is unjustified surface area. Revisit only if Phase 2 proves the docs wrong for this app (see the
  `getByLabel` discrepancy in Context).
- **Scope `cacheComponents` to only the marketing routes** — not available; restated from the
  superseded ADR, this is an app-wide Next build flag with no per-route opt-out for the Activity
  behavior specifically (`instant = false`, used elsewhere in d8e7b32, opts a route out of
  prerendering, not out of Activity).
- **Cache the marketing pages a different way (e.g. `Cache-Control` headers, ISR `revalidate`)
  instead of `"use cache"`** — avoids the whole Activity/testing problem, at the cost of losing
  per-locale-keyed caching and the finer invalidation `"use cache"` gives. Worth returning to if
  this migration is deprioritized, but it is not the path this ADR recommends, since the six
  `/shop/**` fixes already paid down are only valuable if `cacheComponents` actually comes back.
- **Ship the fixture wrapper and the flag re-enable as one PR** — rejected; splitting means Phase
  1 is independently reviewable e2e-infrastructure work with no product behavior change, and a
  Phase 2 failure doesn't block on re-reviewing the fixture change too.

## Consequences

- Once landed, `cacheComponents` (or any future Next feature riding on the same Activity
  mechanism) can be turned on without a suite-wide fire drill — new specs get Activity safety by
  default through the fixture, no per-spec discipline required.
- The fixture wrapper changes how every existing `getByText` call resolves (and any raw
  `.locator()` leaf matcher touched during the Phase 1 triage pass); Phase 1 needs a full local
  `pnpm e2e` green run against the *current* `cacheComponents: false` state as its own acceptance
  bar (proving it doesn't change behavior when Activity is off) before Phase 2 turns the flag on
  to prove the actual fix. Because `getByRole`/`getByLabel` are left untouched, this is a narrower
  blast radius than wrapping every locator method would have been.
- Phase 2's full-app Activity audit (beyond the six `/shop/**` fixes already in the tree) is the
  real unknown-sized cost here — size it before committing to a re-enable date; the six known
  fixes were staff-surface-only and marketing/bearer-token surfaces have not been audited at all.
- Escape hatch: if the fixture-level `.filter({ visible: true })` does not fully eliminate
  strict-mode violations for some specs (e.g. two logically-distinct but simultaneously-visible
  instances of the same text within one live route), those become named, commented per-spec
  exceptions — not a reason to abandon the flag or the fixture approach.

## Outcome

All four phases landed, `cacheComponents: true` is back on. What Phase 2's full-suite proof
actually found, against the plan above:

- **The `getByRole`/`getByLabel` discrepancy (Context) resolved in favor of "yes, they need the
  filter too."** Contrary to the bundled docs, both threw real "resolved to N elements" strict-mode
  failures against this app — not flakes, confirmed by inspecting the matched elements' markup
  against the source in each case (e.g. `getByLabel("Name")` matching both a trip page's
  `BookingPartyFields` input and a hidden previous route's `LastMinuteListForm` input after a
  client-side navigation from the public schedule list to a trip page). The fixture wrapper was
  widened to patch `getByRole`/`getByLabel`/`getByPlaceholder` the same way as `getByText`, and the
  patching logic was pulled out into an exported `makeActivitySafe(page)` helper so a spec that
  opens a second actor's page via `browser.newContext()`/`context.newPage()` — a separate `Page`
  instance the `page` fixture never touches — can apply the same patch explicitly.
  `pnpm check:e2e-fixtures` now flags an unwrapped `.newPage()` call.
- **Three genuine bugs surfaced, not just locator gaps** — exactly the second bucket Phase 2's plan
  anticipated ("Genuine Activity-preserved-state bugs"), though none were state-preservation bugs
  in the sense the sister ADR catalogued. All three were re-verified as fixed against a full local
  `pnpm e2e` run with the flag on before landing:
  1. `e2e/self-service-reschedule.spec.ts` — a closed `<select>`'s `<option>` children never get a
     layout box in Chromium, so `.filter({ visible: true })` (added during the Phase 1 triage pass)
     zero-matched every option and hung the test forever. Same category as the `<script>`/`<meta>`
     exceptions noted elsewhere in the triage; this one was missed in Phase 1 and caught by CI on
     the first real run, not locally — see the escape-hatch guidance above, now also documented in
     the e2e-and-visual skill.
  2. `src/app/sign-in/page.tsx` — `instant = false` is a **dev-time validation opt-out only**
     (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`
     says so explicitly) and has zero effect on production rendering. Every page across this app
     that carries `instant = false` under the (incorrect) assumption that it forces genuinely
     dynamic, request-scoped rendering is still eligible for a Partial-Prerendered shell with an
     implicit dynamic hole around any unwrapped `searchParams`/`headers`/`cookies` read. For
     sign-in specifically, that hole raced a `redirect("/sign-in?error=1")` fired from the
     wrong-password path and lost — `net::ERR_ABORTED`, confirmed via `page.on("response"/
     "requestfailed")` tracing — leaving the form stuck on "Signing in…" forever. Fixed with a real
     `<Suspense>` boundary around the dynamic part, per the documented migration pattern.
  3. `src/app/shop/[shopSlug]/dive-sites/new/page.tsx` — the exact same bug, confirmed independently:
     a `createAction` redirect to `.../new?error=invalid` after a rejected form (this repo's
     `dive-sites.spec.ts` CR-020 SSRF-block test) never rendered the error banner. Same fix, same
     shape (outer sync shell, inner async body in `<Suspense>`), 3/3 clean fresh-server runs
     afterward. This is the confirmation, not just a theory, that the class of bug is real and
     `grep`-findable: **11 more pages carry the identical shape** — `instant = false`, an unwrapped
     `searchParams` read, and a `redirect(...)` inside a `"use server"` action in the same file —
     `waivers/[token]`, `shop/[shopSlug]/staffing`, `shop/[shopSlug]/waivers`,
     `shop/[shopSlug]/waivers/signatures`,
     `shop/[shopSlug]/orders/new`, `shop/[shopSlug]/settings/team`,
     `shop/[shopSlug]/schedule/[id]`, `shop/[shopSlug]/divers`, `shop/[shopSlug]/promos`,
     `shop/[shopSlug]/reports`, `shop/[shopSlug]/dive-sites/[id]`. None of these are proven broken
     by a current test — the race is probabilistic, not guaranteed on every redirect, so a page
     without a failing test today isn't a page confirmed safe — left as the tracked follow-up
     below rather than restructured blind. (`shop/[shopSlug]/trips/new` was on this list too; CI
     caught it live — `e2e/schedule-trip.spec.ts`'s end-before-start test — and it got the same fix
     as sign-in/dive-sites-new in the same pass that landed this ADR's Outcome section.)
  4. `src/app/switching/[competitor]/page.tsx` — `notFound()` for an unregistered competitor slug
     was called from inside a Suspense-wrapped child, so the shell had already streamed a 200 by
     the time the child resolved. Moved the params resolution and `notFound()` check to the top of
     the page component, before any Suspense boundary. This fixes the *content* — Next's own
     not-found boundary now renders on the very first byte for a repeat visit — but does **not**
     fix the raw HTTP status of a cold hit; see the corrected write-up below, found later when CI
     caught `e2e/marketing.spec.ts`'s own unlisted-competitor 404 check on the first real run
     against this branch.
- **The fifth case turned out to be two cases, not one, and item 4 above was wrong about fully
  fixing the second.** `e2e/course-paths.spec.ts`'s hidden-path-404 check could not be fixed the
  same way as `switching/[competitor]` and is a known, documented Next 16 limitation — but so, it
  turns out, is `switching/[competitor]` itself for any *unregistered* slug, despite item 4's
  `notFound()`-above-Suspense fix and its "confirmed 404 status across multiple fresh server
  starts" claim. That claim was true only because every local re-check after the first request hit
  a warm path: `generateStaticParams` covers the registered guides, but an unregistered slug like
  `checkfront` falls back to a dynamic render, and cacheComponents' Partial Prerendering
  unconditionally serves an optimistic 200 "App Shell" for a dynamic-param combination without
  static coverage, upgrading it in the background once `notFound()` resolves. Verified directly
  with repeated `curl` against a fresh production build: the **first** hit to a never-before-seen
  unregistered slug answers 200 (`x-nextjs-postponed: 1`); every hit after that — once the
  postponed render has resolved and cached — answers a correct 404. `course-paths` never gets a
  warm path at all in practice (paths are created by shop staff at any time, so no build-time list
  could ever be exhaustive), which is why its cold-miss 200 is the *only* behavior it ever shows,
  and why the discrepancy wasn't caught by item 4's own re-checks — they were unknowingly warm.
  There is no per-route opt-out either way: `dynamicParams = false` throws a hard build error under
  `nextConfig.cacheComponents` ("not compatible... Please remove it"), and `experimental_ppr` is
  removed entirely (`cacheComponents.md`: "no longer necessary and have been removed"). The
  practical impact is narrow in both cases: inspecting the rendered document confirms it correctly
  lands on Next's own not-found boundary (`<html id="__next_error__">`, `<meta name="robots"
  content="noindex">`) — nothing about the hidden path or the unregistered slug leaks to a real
  visitor or a robots-respecting crawler, only the raw first-byte HTTP status of a cold hit is
  wrong. Both tests were updated to assert on that rendered content instead of
  `response.status()`. Revisit if a future Next version adds a real per-route Partial Prerendering
  opt-out.
- **Recommendation, not built here:** restructure the 11 listed pages the same way (outer sync
  shell, inner async body in `<Suspense>`) — the pattern is now proven three times, not
  theoretical. Prioritize by how often each page's redirect path actually fires in practice:
  form-validation failures (`orders/new`, `settings/team`, `dive-sites/[id]`, `promos`) over rarer
  paths. A `pnpm check:architecture`-style guard that flags a page with `instant = false`, an
  unwrapped `searchParams` read, and a `redirect(...)` call inside a `"use server"` action in the
  same file would catch the next instance of this class at review time — the same `grep` used to
  find the 11 above (`instant = false` + `searchParams` + `redirect(` in one `page.tsx`) is a
  reasonable starting point for that check's rule.
