# 20260720-vitest-plugin-rsc-evaluation — Do not adopt vitest-plugin-rsc yet; keep Playwright for RSC flows

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

[20260719-msw-offline-sync-only](20260719-msw-offline-sync-only.md) kept Playwright as the
flow-coverage layer for our RSC + server-action surfaces because Vitest could not render async
Server Components or reproduce Next's request-scoped APIs (`connection()`, `notFound()`,
`redirect()`, `auth()`). `vitest-plugin-rsc` (Storybook's RSC-in-Vitest-browser-mode plugin, built
on `@vitejs/plugin-rsc`) is the tool that would, in principle, change that calculus: it runs a
component through the real RSC transform + Flight serialization inside a browser test, and ships a
`vitest-plugin-rsc/nextjs` adapter that emulates the App Router request context so a `page.tsx` can
be rendered directly. Before letting this reopen the "move e2e into Vitest" question, we evaluated it
firsthand against this repo's pinned `next@16.3.0-preview.6` / `react@19.2.7` / `vitest@4.1.10`.

## Decision

**Do not adopt `vitest-plugin-rsc` at this time. Keep Playwright as the RSC/server-action flow layer**
(the `20260719-msw-offline-sync-only` decision stands unchanged). The plugin's Next.js App Router
adapter — the only path that renders our actual pages — is incompatible with the `next@16.3.0-preview.6`
build we are pinned to, so it cannot displace any current Playwright spec.

What the firsthand spike established (latest published plugin, `vitest-plugin-rsc@0.2.3` pulling
`@vitejs/plugin-rsc@0.5.26`, `@vitest/browser-playwright@4.1.10`, browser mode on the sandbox
Chromium via `launchOptions.executablePath`):

- **Works** — the generic (non-Next) `renderServer` path renders **pure** and **async** Server
  Components through the real Flight pipeline in the browser, asserted with `vitest/browser`
  Playwright-style locators. Async components consuming our framework-free `src/lib/` logic
  (`capacityLabel`/`isFull`) render correctly. This is the one capability plain
  `@testing-library/react` genuinely lacks.
- **Blocked — full `page.tsx` rendering.** `vitest-plugin-rsc/nextjs`'s `renderServer({ url })`
  throws `TypeError: getDynamicParamFromSegment is not a function`. Root cause: the plugin calls
  Next's internal `createFlightRouterStateFromLoaderTree` positionally assuming
  `getDynamicParamFromSegment` is the 7th argument; `next@16.3.0-preview.6` shifted it to the 8th
  (inserting `cacheComponents`/`partialPrefetching`/`isBuildTimePrerendering`), so `searchParams`
  lands in the function slot and the call blows up. This is a hard version incompatibility in the
  plugin's use of Next internals, not a configuration gap.
- **Blocked — any component importing `next/link` / `next/navigation`** on the generic path fails
  with `Unexpectedly client reference export … is called on server` (reproduced with
  `ScheduleCalendar`, currently covered by `e2e/trips.spec.ts`). Our pages and most navigational
  components import these, so the generic path cannot cover them either.

Both blockers trace to the same root: `vitest-plugin-rsc@0.2.3` (the newest published version) does
not yet track `next@16.3.0`-preview internals. Everything our Playwright suite actually exercises —
pages wired to `getDb()`, `auth()`, `params`/`searchParams`, `notFound()`, and `next/link`
navigation — is on the broken path, so nothing can move today.

## Alternatives considered

- **Adopt now, migrate the presentational/async slice that works** — the working subset is Server
  Components with no `next/*` imports. That is not where our Playwright coverage lives (flows, DB,
  auth, routing), so it would delete zero specs while adding a browser-mode test lane and three dev
  dependencies. Net negative against the `New dependency → ADR`, boring-safety-surface, and
  context-economy guardrails.
- **Patch/monkeypatch the plugin's `createFlightRouterStateFromLoaderTree` call** to match the
  preview arity — shipping a runtime patch of Next internals is exactly the fragile
  shim `20260719-msw-offline-sync-only` rejected; it would rebreak on the next Next or plugin bump.
- **Move off the Next preview to a stable Next 16 the plugin matches** — out of scope and contrary
  to [20260718-typescript7-next-preview](20260718-typescript7-next-preview.md); the preview is a
  deliberate pin, not an accident to paper over.

## Consequences

- No dependency, config, or test-lane change lands; `pnpm check` / `pnpm e2e` are untouched and
  Playwright remains the single RSC-flow source of truth.
- We now have a concrete, reproducible record of *why* — so the next agent who proposes
  "vitest-plugin-rsc lets us drop Playwright" can read this instead of re-running the spike.
- **Revisit trigger:** a `vitest-plugin-rsc` release whose `nextjs` adapter renders a real `page.tsx`
  against our pinned Next (verify with a throwaway spike of one seeded page: launch browser mode,
  `renderServer({ url })` a `/shop/[shopSlug]/schedule` render backed by `createTestDb()`, assert the
  capacity states). If that passes, reopen `20260719-msw-offline-sync-only`: the highest-value
  migration would be the pure data→render assertions (capacity badges, empty states, staff-vs-diver
  view gating) that currently need a full browser flow, leaving genuine multi-step interactions on
  Playwright.
