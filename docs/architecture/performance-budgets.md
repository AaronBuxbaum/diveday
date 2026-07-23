# Performance budgets

Staff use DiveDay on ordinary phones, often on weak marina Wi-Fi or cellular, minutes before a boat
leaves. A page that has quietly bloated a dependency at a time is slowest exactly there. These
budgets make that regression a failed check instead of a field complaint.

## What is budgeted

**Shared first-load JavaScript** — the chunks every route pulls before it can paint (Next's
`rootMainFiles` plus polyfills), measured **gzipped**, since that is what crosses the wire.

- **Budget: ≤ 190 KB gzip.** Current: ~164 KB.
- **Target: trend toward ≤ 150 KB.** The budget is a ceiling that fails CI; the target is where we
  want the number heading. Lower the budget when the number drops, rather than letting slack
  accumulate.

This is the floor cost paid on every staff surface — the Today queue, the manifest, the roster — so
it is both the largest single lever and the easiest to regress without noticing. Per-route budgets
are intentionally out of scope for now: the turbopack build does not emit a stable route→chunk map,
and the shared baseline dominates the experience.

## How it runs

`pnpm perf:budget` (`scripts/perf-budget.mjs`) reads `.next/build-manifest.json` after a production
build, gzips the shared chunks, and fails if the total exceeds the budget. CI runs it in the
`checks` job right after `pnpm build`. Run without a build it prints how to produce one and exits
zero, so it never fails a checkout that simply hasn't built.

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
