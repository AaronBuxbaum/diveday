import { withSentryConfig } from "@sentry/nextjs/config";
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
  // The two AWS SDK clients are here for a different reason: keeping them out
  // of the bundler's graph rather than out of the output. `@aws-sdk/client-sesv2`
  // is reachable from the **root layout** (`publicAppUrl` -> `@/lib/notifications`,
  // whose index statically imports `./ses`), so it was in the module closure of
  // all 127 route entries, and `client-sns` in 16. Between them that is 1,183
  // modules appearing in 446 of the 1,537 server chunks — 8.1x duplication,
  // against 2.7x for first-party code — and in `next dev` Turbopack holds every
  // one of them per entrypoint, in memory, with no eviction. Externalizing costs
  // nothing at runtime (both are resolved from node_modules on the server, like
  // pglite above) and is what stops the graph being re-materialized per route.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "pg",
    "sharp",
    "@aws-sdk/client-sesv2",
    "@aws-sdk/client-sns",
  ],
  // Vercel runs Linux. It has never run macOS, and it never will.
  //
  // `sharp` ships its libvips binary as one optional package per platform, and
  // pnpm installs all of them so the lockfile resolves on a developer's Mac as
  // well as on a runner. Every one then lands in the *traced* closure, which is
  // the set of files Vercel actually deploys and the set its 250 MB
  // per-function limit measures. Counted off `.next/**/*.nft.json` with every
  // path resolved and stat'd, the worst function — `/s/[shopSlug]/trips/[id]`,
  // 1,020 files — was **110.5 MB**, and four platform builds of one image
  // library were 71.9 MB of it:
  //
  //     19.4 MB  @img/sharp-libvips-darwin-x64     <- excluded below
  //     17.8 MB  @img/sharp-libvips-linux-x64         the one that runs
  //     17.4 MB  @img/sharp-libvips-linux-arm64       kept, see below
  //     17.3 MB  @img/sharp-libvips-darwin-arm64   <- excluded below
  //
  // Dropping the two darwin pairs takes 37.2 MB off *every* traced function.
  // Nothing resolves them at runtime: `sharp` selects its native by
  // `process.platform` at require time, so on a Linux function the darwin
  // packages are never opened — which is exactly why they are safe to exclude
  // and were never noticed.
  //
  // `linux-arm64` stays, deliberately. It is another 17.4 MB and the same
  // argument would remove it, but only if the Function architecture is pinned
  // to x64 — that is a project setting on Vercel's side, not a fact this file
  // can read, and getting it wrong is a function that cannot decode a JPEG
  // rather than a slightly larger one. Worth taking once somebody confirms the
  // setting; not worth guessing.
  //
  // The store path and the hoisted symlink are both traced, so both shapes are
  // listed. `**` as the key is every route (picomatch, `contains: true`).
  //
  // PGlite's WASM payload is the same shape of waste, one layer in. `init()` in
  // `src/db/client.ts` branches on `DATABASE_URL`: with one it builds a
  // node-postgres `Pool`, and the embedded-database branch is never taken. The
  // *module* still loads, because the import at the top of that file is static —
  // but `new PGlite()` never runs, so the 17.40 MiB of `.wasm`, `.data` and
  // extension tarballs beside it are never opened. Measured off the traces:
  // present, byte-identical, in **126 of the 142** closures.
  //
  //     9.62 MiB  pglite.wasm
  //     6.00 MiB  pglite.data
  //     1.10 MiB  pgcrypto.tar.gz
  //     0.38 MiB  initdb.wasm
  //     0.30 MiB  36 more extension tarballs
  //
  // Only the payload is excluded, deliberately: the JS stays traced, so the
  // static import still resolves at cold start and no code moves. Excluding the
  // whole package would buy 2.80 MiB more and require making five imports in
  // `client.ts` dynamic — which is a real change with a real failure mode, for
  // 14% more off a budget that has 71% headroom.
  //
  // What this does cost: a production deploy with `DATABASE_URL` *unset* would
  // fail on a missing `.wasm` instead of quietly opening an ephemeral local
  // database that vanishes with the instance. That is the better failure.
  //
  // Type declarations are the third: `.d.ts` files are compiler input and are
  // never read by a running function.
  outputFileTracingExcludes: {
    "**": [
      "node_modules/.pnpm/@img+sharp-darwin-*/**",
      "node_modules/.pnpm/@img+sharp-libvips-darwin-*/**",
      "node_modules/@img/sharp-darwin-*/**",
      "node_modules/@img/sharp-libvips-darwin-*/**",
      "node_modules/.pnpm/@electric-sql+pglite@*/node_modules/@electric-sql/pglite/dist/*.wasm",
      "node_modules/.pnpm/@electric-sql+pglite@*/node_modules/@electric-sql/pglite/dist/*.data",
      "node_modules/.pnpm/@electric-sql+pglite@*/node_modules/@electric-sql/pglite/dist/*.tar.gz",
      "node_modules/**/*.d.ts",
      "node_modules/**/*.d.cts",
      "node_modules/**/*.d.mts",
    ],
  },
  cacheComponents: true,
  images: {
    // The e2e build serves every photo's original bytes instead of running
    // them through the optimizer. Sharp's lossy re-encodes are not
    // bit-reproducible between runs (threaded encoders), so an optimized
    // photo diffs by a few channel values on every CI run — which made the
    // course-page captures a permanent visual-regression coin flip while the
    // layout never moved. Same principle as DIVEDAY_CLOCK: freeze the
    // nondeterminism at the harness boundary, change nothing in production.
    //
    // **What it costs, which went unwritten for a year** (issue #1350): with
    // the optimizer off, `generateImgAttrs` returns `{ srcSet: undefined,
    // sizes: undefined }`. So every `sizes` attribute in the app is invisible
    // to the suite that exists to see surfaces — there is no srcset to select
    // from, no capture can move, and the attribute is not even in the DOM for
    // a Playwright assertion to read. PR #1347 took a fetched candidate from
    // 1080px to 384px and reg-suit reported 0 differences across 732 surfaces
    // with a baseline resolved. `pnpm check:image-sizes` covers that gap with
    // arithmetic instead of pixels; this line is why it has to.
    unoptimized: isE2EBuild,
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
        hostname: "*.s3.*.amazonaws.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.s3.amazonaws.com",
        pathname: "/**",
      },
      {
        // Where media is actually read from since AWS-8's reading half landed:
        // the bucket blocks all public access and grants GetObject only to this
        // distribution, so `MEDIA_PUBLIC_URL_BASE` is a CloudFront domain and
        // every stored `*_image_url` is one too (issue #1013). The two S3
        // patterns above stay for a deployment that overrides the base back to
        // the bucket endpoint. Vercel Blob's host is gone with the provider.
        protocol: "https",
        hostname: "*.cloudfront.net",
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
  // `deleteSourcemapsAfterUpload` defaults to true under Turbopack, but the
  // pattern it builds (`createFilesToDeleteAfterUploadPattern`) globs
  // `<dist>/static/**` and nothing else — while the same version's
  // `createSourcemapUploadAssetPatterns` uploads `server/**` *and*
  // `static/chunks/**`. So the server maps were generated, uploaded, and then
  // left behind: 1,680 files, 173 MB, more than twice the 47 MB of server code
  // they annotate, four of them over 10 MB each. `filesToDeleteAfterUpload`
  // overrides that default pattern outright, so naming both trees is what
  // actually removes them once Sentry has them.
  sourcemaps: {
    disable: isE2EBuild,
    // `.css.map` too: Sentry symbolicates JavaScript, never stylesheets, so the
    // two that survived its own strip pass are 141,995 bytes of deployed static
    // output that nothing will ever fetch — a browser requests a CSS map only
    // with devtools open.
    filesToDeleteAfterUpload: [".next/**/*.js.map", ".next/**/*.mjs.map", ".next/**/*.css.map"],
  },

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
