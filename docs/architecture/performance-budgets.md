# Performance budgets

Staff use DiveDay on ordinary phones, often on weak marina Wi-Fi or cellular, minutes before a boat
leaves. A page that has quietly bloated a dependency at a time is slowest exactly there. These
budgets make that regression a failed check instead of a field complaint.

## What is budgeted

**Shared first-load JavaScript** — the chunks that appear in **every** route's first load,
measured **gzipped**, since that is what crosses the wire. Taken as the intersection of
`firstLoadChunkPaths` across every entry in `.next/diagnostics/route-bundle-stats.json`.

- **Budget: ≤ 170 KB gzip.** Current: 163.7 KB (10 chunks shared by all 107 routes, 2026-10-13).
- **And no staff shell or Sentry SDK on it, whatever it weighs.** A floor chunk carrying the
  palette's `aria-keyshortcuts`, the row menu's `data-row-menu-open` or the SDK's `__SENTRY__` fails
  the guard (`FLOOR_MARKERS`). The staff palette rode the root 404 into every route at 13.8 KB while
  the total sat under its ceiling; a byte budget alone could not see it.

**2026-10-13: 228.8 to 163.7 KB** (code review 2026-10-13b, items 7 and 34). The root
`not-found.tsx` loads the staff palette through `next/dynamic` (`LazyCommandPalette`), the group
label moved to a leaf (`ui/group-label.tsx`) so the language picker no longer brings the ledger's
row menu, together 7.7 KB; and the browser Sentry SDK loads on idle (`deferSentry`), 57.4 KB. The
budget came down from 242 KB with it.

**This number moved on 2026-09-04 without the bundle moving**, because until then it measured
something else. The guard read `rootMainFiles` + `polyfillFiles` out of `build-manifest.json`, an
approximation adopted honestly (the note below said so) because Turbopack emitted no route→chunk
map. Next 16.3 emits one. Against it, the old set was wrong in both directions: it counted 38.6 KB
that is in no route's first load — the `noModule` legacy polyfill bundle, which no modern browser
fetches — and missed 15.0 KB across four chunks that every route does load, reporting 261.5 KB
where the floor was 237.8 KB.

The 24 KB error is the smaller half. The set it measured did not contain the route-level shared
chunks at all, so when zod reached all 75 routes through `web-vitals-client.tsx` in the root layout
— **83.5 KB gzip on every page** — this number did not move, and it did not move when zod was
removed either. It sat at ~261 KB against a 262 KB budget throughout, and was read as evidence that
the floor was under control. A budget that cannot see the regression it is named after is worse
than no budget.
- **Target: trend toward ≤ 150 KB.** The budget is a ceiling that fails CI; the target is where we
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
are intentionally out of scope for now: the shared baseline dominates the experience and is the
easiest to regress. (The old reason given here — that Turbopack emits no stable route→chunk map —
has expired; `route-bundle-stats.json` is exactly that, and is now what the guard reads. Per-route
budgets are a choice not to spend, no longer a thing that cannot be done.)

## How it runs

`pnpm perf:budget` (`scripts/perf-budget.mjs`) reads `.next/diagnostics/route-bundle-stats.json`
after a production build, gzips the shared chunks, and fails if the total exceeds the budget or a
shared chunk carries one of the floor markers. CI runs it in the
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

## Runtime caches: measured before they are trusted

The first `"use cache"` under `/s` is "Our year" (`publicShopYear`,
`src/app/s/[shopSlug]/_components/OurYear.tsx`), behind a `<Suspense>` so it is read at request
time. It runs on Next's default handler, an in-memory LRU per server instance; Next's own docs say
that on serverless such entries "typically don't persist across requests"
(`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md`, "Runtime caching
considerations").

**Decision (2026-10-13, code review 2026-10-13b item 19): measure, do not switch yet.**
On local or self-hosted Next.js, without a supplied handler, `remote` falls back to the same
in-memory LRU (`cacheHandlers.md`). On Vercel, the platform supplies a shared handler for
[`"use cache: remote"`](https://vercel.com/docs/caching/runtime-cache#using-use-cache-remote)
without application `cacheHandlers` configuration. That adds a network lookup and storage cost
to each read; it does not establish that switching "Our year" improves its performance. So the
cached scope stamps when it computed its
value (`cacheStamp()`) and each read logs one line, `{"event":"cache.read","cache":"our_year","outcome":"hit"|"miss","ageS":…}`
(`reportCacheRead`, `src/lib/observability/runtime-cache.ts`). Read a week of it:

```
fields outcome | filter event = "cache.read" and cache = "our_year" | stats count(*) by outcome
```

If misses dominate, the in-memory cache is doing nothing: use the platform's remote handler
(or none, and drop the directive) and switch the scope to `"use cache: remote"`; if hits
dominate, keep it and remove the logging. Either way, record the outcome here. **The next cache
under `/s` starts the same way**: a stamp and a `reportCacheRead`, or a reason here why not.

### Published dive-site catalog map

The catalog map uses `"use cache: remote"` through
`src/app/shop/[shopSlug]/dive-sites/catalog-map-cache.ts`. Its entry contains the complete raw
published map rows; language, depth units, shop links and authorization stay outside the cache.
The shop's own dive-site library is separate and is not included in this global entry. On Vercel
the entry is shared across function instances in a region; local Next.js uses its in-memory
fallback, so local reuse does not prove reuse across production instances.

**Publication invalidates by changing the key.** The catalog page's existing count query also
computes a deterministic digest of every currently joined template's ID, slug, current version
and immutable version-row ID. It reads no full briefings and adds no SQL statement. Pages,
proximity sorting and shop units do not enter that digest. A new publication, version change,
rename, replacement version row or removal from the published join changes it. A rolled-back
publication leaves it unchanged. Because the read derives the key from committed database state,
CLI and bootstrap publishers need no Next.js callback, and no invalidation runs before commit.
Published version briefings remain immutable: a correction publishes a newer version rather than
editing an existing snapshot.

The revision summary and a cache-miss row query are separate database statements. If a publication
commits between them, that request can cache newer rows under the older revision key. Later reads
see the committed revision and select its new entry; the catalog page and map do not form a
transaction-coordinated snapshot.

The revision is an input retained in the cached function's returned envelope. Older revisions are
unreachable from new catalog reads and expire or are evicted normally; publication does not purge
every old entry. `cacheLife("hours")` refreshes in the background after an hour and blocks for fresh
data after one day. The `dive-site-catalog-map` tag supports an operational purge, and Next.js also
separates keys by build/deployment identity. Cache eviction or a cold deployment can cause misses.

Each read reports `cache.read` as `dive_site_catalog_map` using the same timestamp observation as
"Our year". Inspect hit rate, entry age and database duration before claiming a production latency
improvement. Warm hits skip the full map-row query; authentication, catalog paging/counting and
the small revision aggregate still run. Caching does not shrink the client payload. The checked-in
catalog's 1,126 map rows projected to about 564 KB of JSON on 2026-10-21; actual cached serialization
must remain below Vercel's 2 MB item limit as the catalog grows.

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
V-02's outdoor field test (`docs/product/features/roadmap.md`) is where the manifest is exercised on a real
device on real marina Wi-Fi.
