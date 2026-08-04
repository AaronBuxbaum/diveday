import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { LEGACY_PUBLIC_SHOP_REDIRECTS } from "./src/lib/public-routes";
import { securityHeaderRules } from "./src/lib/security-headers";

const isE2EBuild = process.env.DIVEDAY_E2E === "1";

const nextConfig: NextConfig = {
  // Baseline security headers (specialist-optimization-audit-20260731.md §5)
  // — see src/lib/security-headers.ts for the header set and rationale.
  async headers() {
    return securityHeaderRules();
  },
  /**
   * The diver-facing shop surfaces moved out of the staff `/shop` namespace
   * into `/s/<shopSlug>` (ADR 20260803-public-shop-namespace). Every old URL
   * 308s to its new home — a permanent redirect, because a QR code printed on
   * a shop counter, a booking link in a diver's inbox, and an `?embed=1`
   * iframe already pasted into a shop's own website are all out of our reach
   * forever. Next carries the query string through, so `?embed=1`, `?month=`,
   * and `?booking=<token>` all survive the hop, and these run *ahead of* the
   * proxy (docs: app/api-reference/file-conventions/proxy — headers, then
   * redirects, then proxy), so the auth layer never sees the old paths at all.
   */
  async redirects() {
    return LEGACY_PUBLIC_SHOP_REDIRECTS.map((rule) => ({ ...rule, permanent: true }));
  },
  // PGlite ships WASM assets that must load from node_modules at runtime,
  // not be inlined into the server bundle (ADR-0005). node-postgres (pg)
  // dynamically requires optional native/cloud drivers it doesn't use here;
  // keep it external too rather than have the bundler try to resolve them.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "sharp"],
  cacheComponents: true,
  images: {
    // Every photo this app stores (certification cards, course media, recap
    // photos, dive-site briefings) lands in Vercel Blob behind a per-store
    // subdomain of this suffix (`BLOB_PUBLIC_HOSTNAME_SUFFIX`,
    // src/lib/storage/blob-host.ts) — `*` matches exactly that one subdomain
    // segment. Anything else (a shop-pasted third-party URL that predates
    // upload-based media, or a legacy Commons URL a dive-site row still
    // carries) is rendered unoptimized or as a plain `<img>` rather than
    // widened to a blanket pattern here.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },
  // TypeScript 7 is the native (Go) compiler and no longer exposes the JS
  // compiler API Next used for its in-build type check. Next drives it through
  // the TS CLI instead (tsgo), which this flag enables.
  experimental: {
    useTypeScriptCli: true,
    // Static-generation workers only need to be serialized when they'd share
    // one file-backed PGlite database (src/db/client.ts): a real DATABASE_URL
    // (production/preview) is a pooled connection built for concurrent
    // callers, and PGLITE_DATA_DIR=memory (e2e:build) gives every worker
    // process its own private, in-memory database — the same per-process
    // isolation ADR 20260720-e2e-parallel-prod-fleet.md already relies on for
    // the runtime e2e/visual server fleet. Only the local-dev fallback (no
    // DATABASE_URL, file-backed .pglite so data survives across `pnpm dev`
    // restarts) is genuinely single-connection and must stay capped.
    ...(!process.env.DATABASE_URL && process.env.PGLITE_DATA_DIR !== "memory"
      ? { cpus: 1, staticGenerationMaxConcurrency: 1 }
      : {}),
    // Next's 1 MB default is below the 5 MB the storage seam and its UI promise
    // (docs/architecture/decisions/20260718-card-image-storage.md and friends).
    // 16 MB covers the worst single Server Action body this app sends today: the
    // course editor's hero photo (5 MB) plus MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION
    // (src/lib/storage/limits.ts) new gallery photos at 5 MB each, plus multipart
    // overhead (CR-011, docs/architecture/decisions/20260723-upload-transport-limit.md).
    serverActions: { bodySizeLimit: "16mb" },
  },
};

export default withSentryConfig(nextConfig, {
  org: "diveday",
  project: "diveday",

  // E2E builds run in isolated test environments and must not upload build
  // telemetry or source maps. Production builds keep Sentry's normal release
  // behavior; this guard only applies to the deterministic local/CI fleet.
  telemetry: isE2EBuild ? false : undefined,
  sourcemaps: { disable: isE2EBuild },

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Bundle-size treeshaking: strips the Sentry SDK's debug/tracing/replay
  // code, which we never use (`tracesSampleRate: 0`, no `replayIntegration`
  // call — see instrumentation-client.ts). Set for when it applies, but
  // verify before crediting it with any KB: as of @sentry/nextjs 10.69.0 this
  // (and the older `webpack.treeshake` option) is wired only for webpack
  // builds via `webpack.DefinePlugin` — Sentry's own docs say so explicitly
  // ("this guide... does not apply to Turbopack builds"), and this repo's
  // `next build` uses Turbopack (Next 16 default), whose
  // `constructTurbopackConfig`/`generateValueInjectionRules` in this SDK
  // version inject build values for the tunnel route and Vercel Crons but
  // nothing for bundle-size excludes. Measured here: adding this block plus
  // dropping `enableLogs` below did not move the shared first-load number
  // (259.9 KB gzip, unchanged) — confirmed by also diagnostically deleting
  // the whole `Sentry.init` call, which dropped it to 167.5 KB, so Sentry's
  // true footprint (~92 KB) is real but not reachable through this option
  // today. Leaving it set anyway: harmless now, and it should start working
  // for free if/when Sentry ships Turbopack parity for this feature.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },

  // Cron monitoring is NOT configured here. `webpack.automaticVercelMonitors:
  // true` used to be set at this spot and never once produced a check-in;
  // removing it rather than leaving it set, because unlike
  // `bundleSizeOptimizations` above it cannot start working "for free" later —
  // the strategy it selects is structurally wrong for our only cron. Verified
  // by reading the installed @sentry/nextjs 10.69.0, not from memory:
  //
  //   * `maybeGetVercelCronsConfig` (config/withSentryConfig/
  //     getFinalConfigObjectUtils.js) maps `webpack.automaticVercelMonitors` to
  //     the legacy `"wrapper"` strategy, and `maybeConstructTurbopackConfig`
  //     (…/getFinalConfigObjectBundlerUtils.js) forwards the crons config to
  //     Turbopack's value injection *only* when the strategy is `"spans"`. So
  //     under this repo's Turbopack build (Next 16 default) nothing is injected
  //     at all — the same Turbopack/webpack split as the bundle-size option
  //     above, confirmed independently for this option rather than inherited.
  //   * Even under webpack it would not have helped: the wrapper loader is
  //     applied only to files under `pages/api/**` (config/webpack.js), which is
  //     what Sentry's stock "does not yet work with App Router route handlers"
  //     note meant. Our only cron *is* an App Router route handler.
  //   * The newer `_experimental.vercelCronsMonitoring: true` does reach
  //     Turbopack (`"spans"` strategy → `_sentryVercelCronsConfig` injected into
  //     instrumentation.*), but it hangs the check-in off root-span attributes
  //     (server/vercelCronsMonitoring.js, via handleOnSpanStart). This app runs
  //     `tracesSampleRate: 0` (instrumentation.ts), so there is no recording
  //     span to carry them — it is not an option here either.
  //   * Both also short-circuit on `!process.env.VERCEL`, so neither ever
  //     produced anything locally or in CI.
  //
  // The daily tick therefore checks itself in explicitly, from
  // src/app/api/cron/reminders/route.ts. That has the further advantage of
  // being visible in the handler a reader is already looking at.
});
