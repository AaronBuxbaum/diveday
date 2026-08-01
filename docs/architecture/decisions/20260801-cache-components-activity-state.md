# 20260801-cache-components-activity-state — Audit `/shop/**` staff surfaces for `cacheComponents`'s `<Activity>` state preservation

- **Status:** Superseded (commit 100fcf8, 2026-08-01) — `cacheComponents: true` was reverted the
  same day. CI on PR #286 failed 22+ pre-existing e2e specs across unrelated surfaces (sign-in,
  divers, dive-sites, export, manifest, booking, courses, waivers): Activity's `display:none`
  route retention (below) is real and matches this ADR's analysis, but Playwright's
  `getByLabel`/`getByText` locators don't reliably filter it out, so the *existing* e2e suite —
  written before Activity existed — breaks broadly. Migrating that suite to be Activity-aware
  (Next ships a dedicated `@next/playwright` `instant()` helper and an "optimizer" skill for this)
  is substantial, dedicated work — a bigger architectural commitment than the "cache 7 marketing
  pages" task that turned the flag on ever asked for. The staff-surface findings and fixes below
  remain in the tree (they're good defensive state handling on their own merits) and are active
  again: `cacheComponents: true` is back on, per the migration plan this ADR called for —
  20260801-cache-components-e2e-activity-migration.md, now Accepted and landed. That ADR's
  Outcome section also settled the `getByLabel`/`getByText` discrepancy this ADR's status line
  flagged from the original CI failure: both were real, plus `getByRole`, contrary to Next's own
  docs — the e2e fixture now patches all three the same way.
- **Status (original):** Accepted
- **Date:** 2026-08-01

## Context

Commit d8e7b32 ("Enable cacheComponents and cache marketing pages per locale") turned on
`nextConfig.cacheComponents` app-wide so the public marketing pages ("use cache", keyed on the
negotiated locale) could cache. That commit did not add an ADR for the flag itself, and the flag
has a second, unrelated effect it never called out: per Next's docs, `cacheComponents: true`
unconditionally enables React `<Activity>`-based component-state preservation across
client-side navigation for the *whole app*, not just the cached marketing routes.

Concretely: a component instance at the same route/key can now silently keep its local React
`useState`/`useRef` across a navigate-away-and-back, where it previously would have unmounted and
remounted fresh. React's `<Activity>` semantics run a hidden boundary's effects as cleanup-on-hide,
effect-on-reshow — so a `useEffect(() => {...}, [])` mount effect *does* re-fire on a reshow, but
any state that effect doesn't explicitly reset (a `useState`, or a `useRef` mutated only inside a
different effect) survives untouched.

AGENTS.md requires safety-critical surfaces (manifests, roll call, cert gating, medical flags) to
get "boring code, failure-path and adversarial tests" — this flag change was never audited against
that bar for `/shop/**`, the staff surface where roll call, cert/waiver gating, and refunds live. A
dive-domain-expert review did that audit and found six concrete instances where the preserved-state
behavior breaks safety or correctness. This ADR records the audit, the findings, and the fixes.

## Decision

Keep `cacheComponents: true` — the marketing-page caching it enables is the reason it was turned
on, and disabling it would give that up. Instead, treat "does this component's local state stay
correct if React keeps the instance alive across a revisit" as a review question for every
un-keyed `useState`/`useRef` under a staff route, and fix the six instances the audit found:

1. **`src/components/ui/InlineConfirm.tsx`** (blocking finding). `armed` is now reset by an effect
   keyed on `usePathname()` (`next/navigation`). It fires on the leading edge of any (re)navigation,
   including an Activity-preserved show/hide cycle, so a "Remove booking" (fires an automatic
   Stripe refund the Undo banner can't claw back) or "Confirm this is [diver]" (the H-13 identity
   attestation) control can never resurface already armed one tap from firing. Used from
   `src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx`.

2. **`src/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton.tsx`**. Its `result`
   (`useActionState`) has no external setter, so it can't be cleared by an effect. The checkpoint
   switcher (`manifest/page.tsx`'s `?checkpoint=` links, `scroll={false}`) is the same route/key
   across "Departure"/"After dive 1"/"After dive 2", so a stale refusal banner could otherwise
   misattribute to the wrong checkpoint. Fixed by keying the two render call sites in
   `manifest/page.tsx` on `${checkpoint}` (e.g. `key={`board-${checkpoint}`}`), forcing a full
   remount — and a fresh `useActionState` — on every checkpoint switch.

3. **`src/app/shop/[shopSlug]/schedule/_components/ScheduleBuilder.tsx`**. `open` (which
   add/move/copy panel is expanded) now resets to `null` on the same `usePathname()`-keyed effect
   pattern as `InlineConfirm` — this route has no dynamic id, so it was the clearest case of a
   surface that could resurface expanded with stale defaults after a revisit.

4. **`src/app/shop/[shopSlug]/settings/import/ImportWizard.tsx`**. `fileName`/`csvText`/`prepared`
   (the parsed CSV preview, including the hidden field a submit would commit) reset on the same
   `usePathname()`-keyed effect. Import/export is flagged security- and data-sensitive by AGENTS.md;
   a stale preview surviving a revisit could otherwise be committed against a file the staffer no
   longer has open.

5. **`src/app/shop/[shopSlug]/trips/[id]/_components/CrewSection.tsx`**. Already had a correct
   resync effect (`useEffect(() => setLocalCrew(...), [crewIds, staff])`) driven by the server's own
   data rather than a navigation signal — the more precise reset trigger where the caller has one.
   `assignError` was not in that effect's scope, so a stale banner from Trip A's crew section could
   keep showing after navigating to Trip B's. Folded into the same effect/dependency array.

6. **`src/components/MilestoneHaptics.tsx` / `src/components/SubSurfaceRipple.tsx`**. Both hold
   unkeyed mutable refs (`prevPct`/`isInitial`, `prevComplete`) that assume a monotonic same-trip,
   same-checkpoint lifecycle and are rendered once per manifest page. Neither has a natural
   "reset" signal of its own (they don't read the trip or checkpoint), so the fix is at the call
   site in `manifest/page.tsx`: `key={`${tripId}-${checkpoint}`}` on both, forcing a full remount —
   and fresh refs — on a trip or checkpoint switch, instead of a false completion ripple/haptic
   buzz firing off another trip's numbers.

Fixes 1, 3, and 4 share one pattern: an effect keyed on `usePathname()` that resets to the
component's own idle default, because there's no more specific server-truth signal available to
key off. Fixes 2 and 6 use `key={...}` at the render call site because the state involved
(`useActionState`'s result; unkeyed refs with no reset hook) can't be cleared from inside the
component. Fix 5 folds the reset into an existing server-truth resync effect, which is preferable
to a `usePathname()` effect whenever one already exists — it fires exactly when the server's own
data actually changed, not on every navigation.

## Alternatives considered

- **Turn off `cacheComponents`** — rejected; it's required for the `"use cache"` marketing-page
  caching this flag exists for, and the state-preservation behavior is fixable per-surface rather
  than an all-or-nothing tradeoff.
- **Scope `cacheComponents` to only the marketing routes** — not available; per Next's docs this is
  an app-wide build flag, not a per-route opt-in.
- **A blanket `<Activity mode="visible">` opt-out wrapper around all of `/shop/**`** — rejected;
  Next does not expose a documented way to opt a subtree out of the app-wide Activity behavior
  short of restructuring routing, and it would also give up any legitimate benefit (e.g. a
  scroll-position or in-progress-typing preservation a staffer might reasonably want) for every
  staff surface, not just the six with an actual bug.
- **Reset via `key={pathname}` on the component itself instead of an internal effect** — considered
  for findings 1/3/4; rejected in favor of an internal `usePathname()` effect so the reset is part
  of the component's own contract and can't be forgotten by a future caller that renders it without
  the key.

## Consequences

- The six fixes are narrowly scoped and tested (Vitest, in each file's own `*.test.tsx`); they do
  not change any of these components' server-authoritative behavior, only what stale client state a
  revisit can carry forward.
- Two reset idioms now coexist under `src/app/shop/**` and `src/components/`: a `usePathname()`-keyed
  internal effect for state a component can reset itself, and a `key={...}` at the render call site
  for state it cannot (an unresettable hook, or a ref with no reset entry point). Both are
  documented at each component's own definition.
- **Recommendation, not built here:** a shared `useResetOnNavigate()`-style primitive (wrapping the
  `usePathname()` effect pattern used three times above) would remove the duplicated boilerplate and
  give future staff-route components one obvious import instead of a pattern to remember. A
  `pnpm check:architecture`-style safeguard that flags an un-keyed `useState`/`useRef` in a client
  component under a dynamic `src/app/shop/[shopSlug]/**` route with no adjacent reset effect would
  catch the next instance of this class of bug at review time instead of at a domain-expert audit.
  Neither is built as part of this change — revisit if a seventh instance of this pattern turns up,
  or before the next `cacheComponents`-adjacent flag change broadens Activity's reach further.
