# November 9 performance and testing audit implementation

Scope: the original P0–P2 findings plus all five explicitly requested second-pass findings in the [audit dashboard](https://diveday-performance-testing-audit.aaronbuxbaum.chatgpt.site). Original P3 (CI-03, TEST-04 and TEST-05) is intentionally excluded; the later CLARITY-02 P3 item is explicitly included at Aaron’s request. No migration, safety-gate removal, extra shards, timeout expansion or retry policy change.

## CI type gate (CI-01)

The required Next build remains the authoritative application checker, with freshly generated framework page/layout/route validation. Safeguards checks the independent service worker. Only when the existing change detector schedules that required build does safeguards omit its duplicate standalone application check. Otherwise safeguards runs installed Next 16.4.5's `next typegen` and the unchanged `pnpm typecheck` (application plus worker). Unknown build selection fails closed to this complete standalone gate. `CI result` requires both safeguards and the build when scheduled. Local `pnpm typecheck`, Vercel's existing behavior and the optimizer smoke build's checker are unchanged.

An isolated diagnostic probe rejected application and generated `RouteContext` errors in Next's build and worker errors in the independent worker check. It also caught a false premise: ordinary `next typegen` plus tsc accepted synchronous dynamic-page params that `next build --webpack` rejected. Therefore the build checker is **not** disabled or replaced by typegen; no copied internal validator or experimental strict-route opt-in is used. Next's configured native TypeScript CLI checks the whole tsconfig, unlike its older compiler-API path that filtered test diagnostics. The optimization removes the duplicate standalone app run, not any checked program. Build selection still determines the critical path, so no wall-clock saving is claimed without comparable CI samples.

## Fixture generation identity (TEST-01)

The conservative input manifest covers non-test source/configuration/migrations and the package/lock files. A local three-sample diagnostic measured 4,693 sequential file reads at 663, 774 and 781 ms per full hash. Repeating that work in isolated DB forks is avoidable; the first combined CI run passed one unit shard in 850 seconds and exhausted the existing fifteen-minute deadline in three others. This supports the diagnosis, not a claim that hashing was the sole source of variance.

Global setup validates/builds once and supplies its immutable generation identity through Vitest's supported provide/inject context. Workers still validate manifest identity, archive length and SHA256; direct/non-worker callers retain complete content hashing. Watch reruns await a new full fingerprint, but do not rebuild through the coordinator's potentially stale imported seed modules. Fresh isolated workers use a matching valid generation or seed from their freshly loaded code until a new invocation builds the new snapshot. Interrupted writers never publish partial generations. Explicit successful ensure refreshes in-process reader memoization, including repaired misses.

Content-addressed generations are removed only by the explicit idle maintenance command, never while readers/writers may still need them. Complete invalidation intentionally permits more cache misses. The CI timeout, shard count, worker topology and per-test isolation are unchanged. At subsequent head `92e956520b4a912893eca271484c2d511e569fc4`, unit test steps finished in 766 / 733 / 621 / 636 seconds, all within the unchanged job budget. Three passed; shard two reported one stale source-contract assertion (not a deadline), now retargeted to require the complete SQL-scope/shared-policy/shop-isolation chain. The full rehearsal/export-parity and request-window focused rerun passed 58 tests. The timing comparison also includes ordinary runner/cache variation and other changes, so it is not an isolated hashing speedup estimate.

## Shard calibration (CI-02)

Before implementation, read twelve complete successful main runs from November 8–9 through GitHub's actual jobs/step timestamps. All twelve used Ubuntu 24.04, four unit shards and V8 coverage. No non-coverage or macOS observations were present in that sample, so it cannot establish a cross-runner or coverage-mode correction. The table lists **unit-test step elapsed seconds**, not billed minutes or summed per-file costs.

| Run | Unit steps (seconds) | Slowest | Total |
| --- | --- | ---: | ---: |
| [42557306031](https://github.com/AaronBuxbaum/diveday/actions/runs/42557306031) | 457 / 773 / 753 / 526 | 773 | 2509 |
| [42546683067](https://github.com/AaronBuxbaum/diveday/actions/runs/42546683067) | 478 / 508 / 479 / 473 | 508 | 1938 |
| [42534417244](https://github.com/AaronBuxbaum/diveday/actions/runs/42534417244) | 551 / 772 / 757 / 477 | 772 | 2557 |
| [42523062735](https://github.com/AaronBuxbaum/diveday/actions/runs/42523062735) | 489 / 788 / 767 / 741 | 788 | 2785 |
| [42518605248](https://github.com/AaronBuxbaum/diveday/actions/runs/42518605248) | 578 / 598 / 483 / 482 | 598 | 2141 |
| [42516438994](https://github.com/AaronBuxbaum/diveday/actions/runs/42516438994) | 758 / 600 / 596 / 790 | 790 | 2744 |
| [42513002736](https://github.com/AaronBuxbaum/diveday/actions/runs/42513002736) | 765 / 763 / 746 / 588 | 765 | 2862 |
| [42510539796](https://github.com/AaronBuxbaum/diveday/actions/runs/42510539796) | 506 / 541 / 736 / 796 | 796 | 2579 |
| [42504298499](https://github.com/AaronBuxbaum/diveday/actions/runs/42504298499) | 777 / 522 / 610 / 689 | 777 | 2598 |
| [42456213576](https://github.com/AaronBuxbaum/diveday/actions/runs/42456213576) | 563 / 770 / 771 / 531 | 771 | 2635 |
| [42449355268](https://github.com/AaronBuxbaum/diveday/actions/runs/42449355268) | 787 / 809 / 599 / 807 | 809 | 3002 |
| [42449301677](https://github.com/AaronBuxbaum/diveday/actions/runs/42449301677) | 767 / 600 / 804 / 793 | 804 | 2964 |

This confirms variable imbalance, not causation by weights. The fastest-versus-slowest spread varies substantially; increasing shards without predictable costs is not justified.

New artifacts carry source SHA, run ID, timestamp, runner/Node/coverage stratum, shard identity, success status, cache hit and setup/import/body phases. Weekly refresh collects up to ten complete successful runs from the newest twenty candidates. It builds per-file median profiles only from compatible complete runs, rejects duplicate shards/tests, requires identical full test sets, reserves the newest run as a held-out replay, and adopts no stratum whose full-set critical-path replay is worse than the most recent single-run weights. Reports separate predicted critical path, aggregate work and worst-bin error. The sequencer uses a matching calibrated stratum, otherwise the existing committed map/scaled estimates. Every file still appears exactly once. New or renamed paths use estimates; held-out validation reports its common-path coverage.

No profile has been invented from old artifacts lacking metadata. The empty initial profile catalog preserves today's weights until enough eligible observations exist. This is instrumentation plus guarded calibration, not a measured speedup. Runner contention and phase cost remain separate from partition quality.

## Route and interaction measurements (PERF-01)

The shared 170 KB gzip floor and forbidden-module markers remain unchanged. `perf:budget` additionally sums distinct route first-load chunks for Today, manifest, public schedule and dive-site catalog. A test proves a route-local dependency fails its ceiling while leaving the shared intersection unchanged. Missing named routes/chunks fail closed. Route-specific ceilings are established from the verified build, with explicitly documented headroom rather than inherited shared-floor assumptions.

Initial ceilings use [CI build 129159418805](https://github.com/AaronBuxbaum/diveday/actions/runs/42616979577/job/129159418805) at exact source `db3280154219ca4817a64792c6bccededa939a8f`, Next 16.4.5 / Node 24.22.0 / Ubuntu 24.04, ordinary E2E image profile. Each cap rounds 105% of the observed gzip KB up to the next 5 KB. This gives roughly 5–7% route headroom without weakening the independent shared 170 KB ceiling (observed 168 KB).

| Route | Observed gzip KB | Ceiling gzip KB |
| --- | ---: | ---: |
| Today | 279.3 | 295 |
| Manifest | 246.7 | 260 |
| Public schedule | 224.1 | 240 |
| Dive-site catalog | 289.4 | 305 |

These are first-load distinct-chunk sums, not whole-session or compressed RSC transfer measurements. Deferred map chunks are measured by the interaction lane, not silently included in this metric.

`benchmarks/routes.spec.ts` reports fixed 390 px, 4× CPU, 100 ms latency and 1 Mbps samples for cold/warm documents and uncached real Next-link navigation and cached Back/Forward history restoration. It records transferred resource bytes, decoded JS and RSC bytes, elapsed navigation and browser long tasks separately. Payloads must belong to request identities started within the sample, rather than late responses from its predecessor; prior-window response counts are reported, not silently attributed to the new route. Resource and task start-time boundaries exclude earlier work. Every new-window payload still must be readable. Automatic Link prefetches are blocked with native CDP Fetch interception and counted. Benchmark-only native stubs replace the shared fixture’s Playwright map/font routes so routing cannot disable the HTTP cache; no real provider tile/font cost is claimed, while HTTP cache behavior is controlled independently, and a warm-document sample must observe at least one cached script resource. Cold document sampling clears the browser cache with caching enabled to populate the following warm sample. Inline RSC carrier bytes are reported only for document samples; client-navigation RSC counts only the target response body. Bytes from response bodies are **decoded**, not compressed network transfer; Resource Timing transfer size includes protocol overhead and cache effects. Accepted reference observations and exact-head artifact links are recorded in PR #4179’s verification section so the initial reference survives artifact expiry. Runtime thresholds are report-only until repeated fixed-fixture samples support them. No bytes/CPU/latency measures are interchangeable.

## Production image delivery (TEST-00)

The separate `Performance and optimized images` workflow runs weekly, manually, and for image/config/dependency/benchmark changes. It builds with `DIVEDAY_IMAGE_SMOKE=1` and the ordinary isolated E2E fixtures. Only this profile enables Next's real optimizer. It verifies candidate width, successful browser decode and bounded image bytes at 390 px and desktop widths, then requests the recap SVG-to-PNG card after the optimizer initializes sharp. It uses repository public demo fixtures, never customer uploads, external writes or pixel baselines. The ordinary deterministic screenshot build remains unoptimized. The build fingerprint includes the image profile so one artifact cannot pass as the other.

The extra build/lane intentionally spends compute to close a coverage gap. Its schedule and broad initial transfer ceiling are not evidence of a performance gain. No real production provider credentials are needed.


## Second-pass reliability and clarity additions

- **TEST-07:** coverage branch counts must be safe nonnegative integers with covered no greater than total. Current percentages and saved floors must be finite values in [0,100] before either comparison or write. Even an approved downward ratchet cannot absorb malformed evidence. Valid zero/zero branch counts still mean 100%; no safety floor is lowered.
- **TEST-08:** canary readiness and verdict use the same visible, same-origin/same-shop departure links inside `main`. Hidden/Activity/inert copies and links outside the schedule cannot release readiness. Visibility is not viewport intersection, so below-the-fold departures count. Visible empty state and HTTP failure diagnostics remain distinct.
- **TEST-09:** administrative CREATE/drain/DROP use a ten-second deadline paired with actual owned-socket cancellation, not a waiter-only race. Subject query/statement timeouts are unchanged so deliberate lock contenders remain real. Pool shutdown has a five-second force-disposal bound and reports checked-out leaks; the existing thirty-second teardown budget remains unchanged. Normal DROP still requires observed backend draining. If drain observation fails, bounded force cleanup is attempted and the original error is retained. The fixture registers cleanup before CREATE so a lost acknowledgement still gets best-effort removal. Local protocol fault peers exercise cancellation without production access; the real-Postgres CI lane remains the normal/contended integration proof.
- **CLARITY-01:** near-budget diagnostics now ask for readiness/work-size/contention diagnosis and fixes or splits, not wider flaky-test timeouts. A genuinely new long journey may have a documented measured initial budget. Calculations and annotation locations are unchanged.
- **CLARITY-02:** the retained manual worker trial is explicitly a repeatability probe of an already-completed rollout, with dated historical estimates. Current topology is read from the matrix/env, not duplicated in an obsolete comment. Main visual-plan prose defers to the active full matrix. No trial was dispatched.


## Seeded catalog payload evidence

A reproducible serialization test uses the current 1,126 geocoded built-in templates, en-US/meters labels and deterministic UUID-shaped IDs. It reconstructs the pre-change pin fields at 774cd6c8 and compares the compact projection. These are **JSON serialization bytes**, not measured RSC or production network bytes; the IDs are reproducible substitutes for database-generated IDs.

| Seeded representation | Raw JSON | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Prior fields | 529,077 | 150,490 | 114,606 |
| Compact global pins | 155,813 | 54,801 | 45,688 |

Descriptions and localized popup details are now selected-only, so a later detail request is a separate cost. Real RSC delivery, browser parsing and interaction baselines still come from the controlled browser lane; these serialization figures are not a speedup benchmark.
