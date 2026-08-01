# Performance budgets

Staff use DiveDay on ordinary phones, often on weak marina Wi-Fi or cellular, minutes before a boat
leaves. A page that has quietly bloated a dependency at a time is slowest exactly there. These
budgets make that regression a failed check instead of a field complaint.

## What is budgeted

**Shared first-load JavaScript** — the chunks every route pulls before it can paint (Next's
`rootMainFiles` plus polyfills), measured **gzipped**, since that is what crosses the wire.

- **Budget: ≤ 262 KB gzip.** Current: ~260 KB.
- **Target: trend toward ≤ 150 KB (excluding Sentry where possible).** The budget is a ceiling that fails CI; the target is where we
  want the number heading. Lower the budget when the number drops, rather than letting slack
  accumulate. We raised the budget to 260 KB to accommodate the static inclusion of the Sentry browser SDK (which is statically bundled on every route for error monitoring). We briefly raised it to 262 KB (2026-08-01) when enabling `cacheComponents` added React's `<Activity>`-based
  state-preservation runtime to the shared client bundle, then dropped it back to 260 KB the same
  day when `cacheComponents` itself was reverted (commit 100fcf8; see ADR
  `20260801-cache-components-activity-state.md`) — its Activity behavior broke a large share of the
  pre-existing e2e suite across unrelated surfaces. Raised it to 262 KB again the same day after
  merging `main`'s concurrent work (schedule/board split, courtesy-email unsubscribe) nudged the
  shared bundle to ~260.0 KB on its own — organic growth from unrelated features, not a single
  dependency to trim. We confirmed
  the Sentry client-bundle-reduction levers investigated separately (`bundleSizeOptimizations` in
  `next.config.ts`) are inert under this app's Turbopack build (webpack-only in the SDK today), so
  that avenue is not currently available to offset the SDK's own cost.

This is the floor cost paid on every staff surface — the Today queue, the manifest, the roster — so
it is both the largest single lever and the easiest to regress without noticing. Per-route budgets
are intentionally out of scope for now: the turbopack build does not emit a stable route→chunk map,
and the shared baseline dominates the experience.

## How it runs

`pnpm perf:budget` (`scripts/perf-budget.mjs`) reads `.next/build-manifest.json` after a production
build, gzips the shared chunks, and fails if the total exceeds the budget. CI runs it in the
`checks` job right after `pnpm build`. Run without a build it prints how to produce one and exits
zero, so it never fails a checkout that simply hasn't built.

## Not budgeted, but watched: server round trips per page

The budget above governs bytes. The other half of "slow at the dock" is how many database round
trips a page makes before it can answer, and no check enforces that — it is a review expectation,
recorded here so it is at least written down.

The pattern that keeps reappearing is a loop that queries per row. Two measured examples, both
fixed 2026-07-30:

- **Today** called the readiness engine once per departure in the window. Each call is about ten
  queries of its own, so a six-departure morning was roughly sixty round trips to render the shop's
  most-visited page. `listTripsReadiness` answers for every trip at once: median server response on
  the seeded demo went from **263 ms to 165 ms**.
- **The public trip page** asked for a dive site's creatures and moments once per dive — six round
  trips on a three-tank day, on the page a diver reaches straight from a marketing link.
  `listDiveSiteBriefingExtras` covers any number of dives in two.

When you add a query inside a `.map()` over rows, ask for the batched form instead. `src/db` already
carries several (`listTripsReadiness`, `tripScheduleDayCounts`, `tripCrewByTrip`,
`listDiveSiteBriefingExtras`); adding one more is cheaper than the round trips.

## When the budget fails

The shared floor regressed. In order of preference:

1. **Trim or defer a client dependency** — the usual cause is a new package pulled into a client
   component that could be server-only or dynamically imported.
2. **Push work server-side** — a server component ships no JS; prefer it unless the surface is
   genuinely interactive.
3. **Raise the budget deliberately** — if the growth is justified, bump
   `SHARED_FIRST_LOAD_BUDGET_KB` in `scripts/perf-budget.mjs` and note why here. A raised budget with
   no note is the thing this check exists to prevent.

## Field validation

The automated budget bounds bytes over the wire; it does not prove the page feels fast on a specific
phone. Real-user vitals flow to Vercel Speed Insights (`<SpeedInsights />` in the root layout);
V-02's outdoor field test (`docs/product/roadmap.md`) is where the manifest is exercised on a real
device on real marina Wi-Fi.
