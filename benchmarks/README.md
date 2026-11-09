# Runtime performance and image delivery

This is a maintained Playwright lane, separate from the functional and visual specs in `e2e/`.
The [performance workflow](../.github/workflows/performance-smoke.yml) runs it weekly, on relevant
pull requests, and on manual dispatch. Keep this directory outside `e2e/` so ordinary functional
runs do not also run throttled measurements.

- `routes.spec.ts` measures cold/warm documents, uncached Next-link navigation and cached history
  restoration under a fixed phone/network/CPU profile. Timings and payload sizes are reported,
  not regression thresholds; assertions enforce valid samples and cache attribution.
- `image-delivery.spec.ts` checks optimized image decoding and delivery at phone/desktop widths,
  followed by recap-card rasterization in the same server process.
- `network-policy.ts` supplies cache-preserving external stubs and request-window attribution;
  [unit coverage](../src/test/benchmark-network.test.ts) holds those contracts.

## Run

From the repository root with dependencies and the Playwright browser installed:

```sh
DIVEDAY_IMAGE_SMOKE=1 E2E_WORKERS=1 pnpm e2e:build
DIVEDAY_IMAGE_SMOKE=1 E2E_WORKERS=1 pnpm exec playwright test --config playwright.benchmarks.config.ts
```

The [configuration](../playwright.benchmarks.config.ts) inherits the normal isolated servers,
authentication and clock fixtures. Results and JSON attachments go to gitignored
`benchmark-results/`; CI retains the run artifact for 30 days. The
[performance implementation record](../docs/engineering/performance-audit-implementation.md)
explains the measurements and their limits. Static JavaScript budgets remain a separate
`pnpm perf:budget` check.

Keep reusable probes here and transient results in run artifacts. Before moving or retiring a
probe, update its workflow selection, configuration, imports and measurement documentation in
the same change; a completed performance fix does not make its regression probe obsolete.
