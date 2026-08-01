import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import { securityHeaderRules } from "./src/lib/security-headers";

const isE2EBuild = process.env.DIVEDAY_E2E === "1";

const nextConfig: NextConfig = {
  // Baseline security headers (specialist-optimization-audit-20260731.md §5)
  // — see src/lib/security-headers.ts for the header set and rationale.
  async headers() {
    return securityHeaderRules();
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

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,
  },
});
