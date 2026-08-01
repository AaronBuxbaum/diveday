# 20260801-cache-components-e2e-activity-migration — Make the e2e suite Activity-safe before re-enabling `cacheComponents`

- **Status:** Proposed
- **Date:** 2026-08-01

## Context

Commit d8e7b32 turned on `nextConfig.cacheComponents` to cache seven marketing pages
(`/`, `/pricing`, `/product`, `/about`, `/switching`, `/switching/[competitor]`,
`/switching/spreadsheet`) per negotiated locale via `"use cache"`. The flag is app-wide, not
per-route: per Next's docs it also unconditionally turns on React `<Activity>`-based state
preservation for client-side navigation everywhere, keeping up to 3 previously-visited routes'
DOM trees alive as `display:none` instead of unmounting them, so back-navigation is instant.
Real visitors never see the hidden tree. Playwright's `getByLabel`/`getByText`/`getByRole` do —
by default they resolve against the whole document, hidden trees included, so a hidden
previous-route's "Sign in" button and the current route's own "Sign in" button both match a
strict-mode locator and the call throws "resolved to 2 elements."

Commit 100fcf8 reverted the flag the same day: CI on PR #286 failed 22+ pre-existing e2e specs
across unrelated surfaces (sign-in, divers, dive-sites, export, manifest, booking, courses,
waivers) on exactly that failure mode. ADR 20260801-cache-components-activity-state.md (now
Superseded) did the AGENTS.md-required safety audit of `/shop/**` for a *different* Activity
hazard — component-local `useState`/`useRef` silently surviving a hide/reshow cycle — and landed
six defensive fixes that are still in the tree, inert until the flag is back on. That ADR's
closing line: "Kept for the day this app deliberately re-adopts `cacheComponents` with its own
e2e migration plan." This ADR is that plan.

Scale of the testing-strategy problem: `grep -c 'getByLabel\|getByText\|getByRole' e2e/*.spec.ts`
totals **1,776 call sites across all 50 spec files** — every spec in the suite uses these
locators, and every spec imports its `test`/`expect` from one place, `e2e/fixtures.ts`
(`docs/engineering/testing.md` — "Every spec imports `test`/`expect` from `e2e/fixtures.ts`, not
`@playwright/test` directly"). That existing choke point is what makes this tractable: the fix
belongs in the fixture, not in 1,776 call sites across 50 files.

## Decision

Land the Activity-safe testing convention *before* re-enabling the flag, as its own PR, proven
green against the flag turned on locally — then re-enable the flag in a second PR once that bar
is met.

**Phase 1 — Activity-safe locators at the fixture choke point.**
In `e2e/fixtures.ts`, wrap the `page` fixture so `getByRole`/`getByLabel`/`getByText` resolve
only against the currently-visible route tree, not any Activity-hidden previous one. Playwright's
locator engine supports intersecting two locators with `.and()`; a `:visible` pseudo-class
locator (`page.locator(":visible")`) is a per-element visibility filter that composes with any
`getBy*` result. Concretely, in the `test.extend` for the `page` fixture, wrap each of the three
methods so `page.getByRole(role, opts)` returns `page.getByRole(role, opts).and(page.locator(":visible"))`
(same for `getByLabel`/`getByText`), applied once at fixture construction. Every spec's existing
call sites are unchanged — no 1,776-site rewrite. Before writing this by hand, read
`node_modules/next/dist/docs` for `@next/playwright` (referenced in commit 100fcf8 as Next's own
"instant() helper and an optimizer skill" for exactly this problem) — if Next ships an official
fixture wrapper by implementation time, prefer it over the bespoke one above and drop this phase
to "adopt it in `e2e/fixtures.ts`."

Exceptions: a spec that legitimately asserts on a *hidden* element (e.g. `toBeHidden()`, or an
`aria-hidden` dialog backdrop) should reach for a documented escape hatch — an
`untypedPage`/`page.locator(...)` without the wrapper, exported alongside `page` from the same
fixture — rather than lose the default safety.

**Phase 2 — full-suite proof, flag on, uncommitted.**
Turn `cacheComponents: true` back on locally (do not merge net-new marketing-page caching yet)
and run `pnpm e2e` full suite. Triage failures into two buckets:
- Locator strict-mode violations the Phase 1 wrapper didn't catch (e.g. a raw `page.locator()`
  call, or a spec that intentionally wants two matches and needs `.first()`/`.filter()` — those
  already exist independent of Activity and are unaffected).
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
guard is cheap to add (flagging a spec file that imports `getByRole`/`getByLabel`/`getByText`
from `@playwright/test` instead of `./fixtures`), add it — same spirit as the "recommendation, not
built here" closing note in the superseded ADR.

## Alternatives considered

- **Rewrite all 1,776 call sites directly** — rejected; same outcome as the fixture wrapper with
  a 50-file diff instead of a one-file one, and any spec written afterward would need to remember
  the pattern by hand instead of getting it for free through the shared fixture.
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
- The fixture wrapper is a global behavior change to how every existing spec's locators resolve;
  Phase 1 needs a full local `pnpm e2e` green run against the *current* `cacheComponents: false`
  state as its own acceptance bar (proving it doesn't change behavior when Activity is off) before
  Phase 2 turns the flag on to prove the actual fix.
- Phase 2's full-app Activity audit (beyond the six `/shop/**` fixes already in the tree) is the
  real unknown-sized cost here — size it before committing to a re-enable date; the six known
  fixes were staff-surface-only and marketing/bearer-token surfaces have not been audited at all.
- Escape hatch: if the fixture-level `:visible` intersection does not fully eliminate strict-mode
  violations for some specs (e.g. two logically-distinct but simultaneously-visible instances of
  the same role/label within one live route), those become named, commented per-spec exceptions —
  not a reason to abandon the flag or the fixture approach.
