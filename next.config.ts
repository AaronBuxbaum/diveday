import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { applyDevOrigin } from "./scripts/dev-origin.mjs";
import { LEGACY_PUBLIC_SHOP_REDIRECTS } from "./src/lib/public-routes";
import { securityHeaderRules } from "./src/lib/security-headers";
import { managedImageRemotePatterns } from "./src/lib/storage/blob-host";

const isE2EBuild = process.env.DIVEDAY_E2E === "1";
/**
 * A Vercel build that is not the one aliased to the production domain — a
 * preview, which is roughly three of every four builds this project runs
 * (2026-09-04: ~26 merges to `main` a day against ~65 branch commits).
 *
 * Narrow on purpose: `process.env.VERCEL` rather than "not production", so a
 * local `pnpm build` and CI's `e2e:build` keep exactly the behaviour they have.
 */
export const isVercelPreviewBuild =
  process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production";

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
    return [
      ...LEGACY_PUBLIC_SHOP_REDIRECTS.map((rule) => ({ ...rule, permanent: true })),
      // The counter's walk-in page folded into the departure door (#2816); a
      // bookmark or a printed link lands on the same door, in walk-in mode.
      {
        source: "/shop/:shopSlug/trips/:id/walk-in",
        destination: "/shop/:shopSlug/divers/new?surface=departure&tripId=:id&walkIn=true",
        permanent: true,
      },
    ];
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
  // `sharp` ships its libvips binary as one optional package per platform. The
  // traced closure — the set of files Vercel actually deploys, and the set its
  // 250 MB per-function limit measures — is counted off `.next/**/*.nft.json`
  // with every path resolved and stat'd.
  //
  // **Re-measured 2026-09-06 on Linux x64** (the platform CI and Vercel both
  // build on; a measurement taken on a Mac answers this question wrong):
  //
  //     147 traced closures
  //     worst function  /s/[shopSlug]/trips/[id]  —  821 files, 35.7 MB
  //     17.8 MB  @img/sharp-libvips-linux-x64   traced; the one that runs
  //      0.0 MB  @img/*-darwin-*                absent — see below
  //
  // **The four darwin globs below save nothing here, and that is fine.** This
  // comment used to credit them with "37.2 MB off every traced function",
  // measured while `pnpm-workspace.yaml` carried a `supportedArchitectures` key
  // forcing darwin+linux x arm64+x64 optional packages onto *every* install.
  // That key is gone (52e62f1, which took a cold install from 2.7 GB to
  // 1.4 GB), so pnpm now installs only what matches the machine: on this box
  // `node_modules/@img/` holds exactly `colour`, `sharp-libvips-linux-x64` and
  // `sharp-linux-x64`, the `.pnpm` store holds no others, and **zero
  // `@img/*darwin*` paths appear in any trace**. A glob cannot exclude a file
  // that was never installed.
  //
  // So they are **insurance, not a saving**: they are what stops a build on a
  // Mac — the one machine where those packages *do* install — from shipping an
  // unreachable native into a Linux function. Nothing resolves them at runtime
  // either way, since `sharp` selects its native by `process.platform` at
  // require time. They cost nothing and they are deliberately kept; do not
  // delete them because they currently match nothing, which is the one wrong
  // turn this paragraph exists to prevent.
  //
  // **`pnpm-lock.yaml` is not evidence.** It still lists every platform's
  // package — darwin, linuxmusl, win32, wasm32 — because that is *resolution*,
  // and 52e62f1 left the lockfile byte-identical. Read an installed
  // `node_modules/@img/` and `node_modules/.pnpm/`, never the lockfile.
  //
  // `linux-arm64` is deliberately **not** excluded, and the two halves of that
  // are worth keeping straight, because this file has now been wrong about it
  // in both directions:
  //
  //   * The Function architecture is not a project setting on Vercel's side.
  //     `getDefaultLambdaArchitecture` in `@vercel/build-utils` switches on the
  //     **build machine's** `process.arch` and returns `x86_64` for everything
  //     that is not arm — so what we get is "whatever CPU Vercel happened to
  //     build on", not a dashboard value.
  //   * We cannot declare it either. `functions[glob].architecture` does exist
  //     in `@vercel/build-utils`' own `functionsSchema` (`"x86_64" | "arm64"`),
  //     which is what a 2026-09-04 commit checked and pinned on — but that
  //     schema runs inside a build that has already been accepted. The
  //     deployment API validates `vercel.json` against the published schema at
  //     https://openapi.vercel.sh/vercel.json first, and that one has no
  //     `architecture` field at all: it rejects the file outright with
  //     "`functions.src/app/**` should NOT have additional property
  //     `architecture`", so the pin never reached a build. It is gone.
  //
  // Without the pin the architecture is again inferred rather than declared,
  // which puts the arm64 exclusion back on the wrong side of the trade. On an
  // x86_64 build machine it buys nothing: `pnpm-workspace.yaml` no longer
  // forces `supportedArchitectures`, so the install matches the machine and
  // `@img/sharp-linux-arm64` is not there to trace. On an arm64 one it would
  // strip the binary that actually runs, which is the failure the original
  // comment feared — a function that cannot decode a JPEG. A no-op in the good
  // case and a breakage in the bad one is not a saving.
  //
  // The store path and the hoisted symlink are both traced, so both shapes are
  // listed. `**` as the key is every route (picomatch, `contains: true`).
  //
  // PGlite's WASM payload is the same shape of waste, one layer in. `init()` in
  // `src/db/client.ts` branches on `DATABASE_URL`: with one it builds a
  // node-postgres `Pool`, and the embedded-database branch is never taken. The
  // *module* still loads, because the import at the top of that file is static —
  // but `new PGlite()` never runs, so the 17.40 MiB of `.wasm`, `.data` and
  // extension tarballs beside it are never opened. Re-confirmed 2026-09-06:
  // 40 such files totalling **17.40 MiB** sit in the store, and the exclusion
  // below keeps every one of them out of **all 147** traced closures.
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
    // **Satori, in staff closures that render no image** (issue #1355).
    //
    // `@vercel/og` is 3.07 MiB of renderer, bundled font and WASM, and Next
    // attaches a **metadata module** to every page entry in that module's
    // segment subtree — so a card in the *root* segment reaches every closure
    // in the app, and a settings form traces the rasterizer.
    //
    // Both root importers are gone now. Issue #1361 made the two root icons
    // committed PNGs (`src/app/icon.png`, `apple-icon.png`,
    // `public/icon-192.png`, `public/icon-512.png`), and issue #1709 moved the
    // root card off the convention to `src/app/link-card/route.tsx` — a route
    // handler is its own closure and is attached to nothing.
    //
    // **Measured on a build, 2026-10-10 (issue #1817)**: with this key, 17 of
    // 190 closures trace the module; without it, 18. The eighteenth is
    // `/shop/[shopSlug]/reports/card`, the staff year card, which renders an
    // `ImageResponse` and needs it; no other staff closure traces it either
    // way. So the key no longer keeps the renderer out of any staff closure
    // that would otherwise carry it — its one remaining effect is #1710's,
    // below. Deleting it is #1710's call, deferred with H-85 until after
    // pilot. Re-count after any change here with
    // `grep -l "@vercel/og" $(find .next -name "*.nft.json") | wc -l`.
    //
    // The seventeen: the five image routes (`link-card`, `pwa-icon-maskable`,
    // and the `opengraph-image` cards at `/recap/[token]`, `/s/[shopSlug]` and
    // `/s/[shopSlug]/trips/[id]`) and the twelve pages under `/recap/[token]`
    // and `/s/[shopSlug]` those cards' metadata modules attach to, each
    // reaching only its own subtree. `src/app/_og/card.test.tsx` refuses a new
    // card in the root segment, which would put it back in every closure.
    //
    // **`/shop/**` and never `/shop`.** These keys are matched with picomatch
    // and `contains: true`, so they match a *substring* of the route: the bare
    // key would also match `/api/integrations/shopify/callback`, which has
    // nothing to do with staff pages. The trailing slash is what makes it a
    // path segment rather than five letters.
    //
    // **One route under `/shop/` does render an image, and this key strips the
    // module out from under it**: `/shop/[shopSlug]/reports/card`, the staff
    // year card. Confirmed on a build — its `.nft.json` carries no
    // `@vercel/og` with the key, and does without it — and an
    // `outputFileTracingIncludes` entry for the same route does **not** win
    // over this exclusion. Issue #1710 holds the fix.
    //
    // The marketing and diver-facing pages cannot be excluded the same way:
    // substring matching means a `/s/**` key would also match
    // `/s/[shopSlug]/opengraph-image`, which genuinely needs the module, and
    // these keys have no negation.
    "/shop/**": ["node_modules/**/next/dist/compiled/@vercel/og/**"],
    // **sharp's natives, out of the cron functions** (#2486). `process-image.ts`
    // loads sharp with `await import("sharp")` on the first upload, never at
    // import, so a cron closure reaches it only through a path that resizes an
    // image, and none does. Without this the tracer still follows the dynamic
    // import and ships the 18.7 MB libvips into every cron function. Scoped to
    // `/api/cron/**` and not `**`: uploads, the photo actions and the
    // opengraph-image routes need the linux native (see `next-config.test.ts`).
    "/api/cron/**": [
      "node_modules/.pnpm/@img+sharp-libvips-linux*/**",
      "node_modules/.pnpm/@img+sharp-linux*/**",
      "node_modules/@img/sharp-libvips-linux*/**",
      "node_modules/@img/sharp-linux*/**",
    ],
  },
  cacheComponents: true,
  partialPrefetching: true,
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
    // **The optimizer fetches from the distribution we deployed, and nowhere
    // else** (issue #1358).
    //
    // These three patterns were `*.s3.*.amazonaws.com`, `*.s3.amazonaws.com`
    // and `*.cloudfront.net`, each over `/**` — every public bucket and every
    // distribution on the internet. `/_next/image?url=…&w=…&q=…` downloads,
    // decodes, re-encodes and serves whatever it is pointed at, which made this
    // the app's most expensive request available to anyone with a URL and no
    // account, and made DiveDay's origin the apparent fetcher of it.
    //
    // `managedImageRemotePatterns` is the same list `isManagedStorageUrl`
    // already keeps (src/lib/storage/blob-host.ts): the CloudFront domain from
    // `MEDIA_PUBLIC_URL_BASE`, plus the two virtual-hosted forms of
    // `MEDIA_BUCKET_NAME` for a deployment that overrides the base back to the
    // bucket. Same three shapes as before, named rather than wildcarded — so a
    // URL the storage seam would refuse to store is one the optimizer will not
    // fetch. Read there for what an unconfigured environment gets, and why an
    // empty allowlist is the right answer rather than a fallback wildcard.
    //
    // Read from the environment when this file is loaded — at build time on
    // Vercel, where it is baked into `images-manifest.json`, and again at boot
    // under `next start`. `MEDIA_PUBLIC_URL_BASE` reaches both local and Vercel
    // builds (config/env-registry.mjs), so a production build has it; one
    // without it already served 403s from the direct bucket endpoint — the
    // registry's own `absent:` note — so pinning costs that deployment nothing
    // it had.
    //
    // **Origin-scoping is not the whole story, and this is the part to know.**
    // Next's optimizer follows a 3xx by recursing into the redirect target with
    // only its private-IP guard re-applied — the new URL is never re-tested
    // against these patterns. Under the old `*.cloudfront.net` that made it a
    // one-hop open proxy to anywhere; now it takes control of the shop's own
    // bucket or distribution, which is a different threat entirely. Two further
    // doors that bypass this list rather than widening it: `images.domains` is
    // ORed with these patterns, and `assetPrefix` pushes its own host in here
    // with no `pathname` at all. Both are unset, and `src/test/next-config.test.ts`
    // is what keeps them that way.
    //
    // The CSP's `img-src` (src/lib/content-security-policy.ts) stays wildcarded
    // on purpose and is not the same decision: it is built in the edge layer,
    // which cannot read this configuration, and it is a backstop rather than an
    // allowlist.
    remotePatterns: managedImageRemotePatterns(),
  },
  // TypeScript 7 is the native (Go) compiler and no longer exposes the JS
  // compiler API Next used for its in-build type check. Next drives it through
  // the TS CLI instead (tsgo), which this flag enables.
  //
  // Keep the refusal gate decided in #1377, but don't overlap the checker with
  // Turbopack's retained compile memory on Vercel's 8 GB builder. The Vercel
  // build script runs `next typegen` and `pnpm typecheck` in separate processes
  // before migrations and the production build; only that build skips Next's
  // duplicate pass.
  // Local `pnpm build` and CI keep their existing checks.
  ...(process.env.VERCEL === "1" ? { typescript: { ignoreBuildErrors: true } } : {}),
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

const sentryConfig = withSentryConfig(nextConfig, {
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
    // **Preview builds have never had symbolication and still paid for it.**
    // `SENTRY_AUTH_TOKEN` is a Production-only Vercel variable, deliberately
    // (docs/engineering/monitoring-runbook.md says so at the line that sets
    // it), so a preview build has no token, uploads nothing, and therefore
    // never runs the `filesToDeleteAfterUpload` pass below either. What it does
    // do is make Turbopack emit the maps: the 1,680 files and 173 MB of server
    // maps counted in the comment under this one, generated on every preview,
    // uploaded nowhere, deleted never, and shipped into the deployment as
    // output nothing will ever fetch.
    //
    // Turning them off on previews costs nothing that existed: an unsymbolicated
    // preview stack trace is what a preview already produced. Production is
    // untouched — it has the token, and its maps are the ones a real incident
    // is read through.
    disable: isE2EBuild || isVercelPreviewBuild,
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

  // Request Sentry's debug, tracing and replay exclusions; their current
  // production bundle impact has not been measured (#3227).
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeTracing: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
    excludeReplayWorker: true,
  },

  // Scheduled handlers report Sentry cron check-ins explicitly with
  // `Sentry.captureCheckIn`; see docs/engineering/monitoring-runbook.md.
  // Automatic Vercel cron instrumentation is not configured here. Revalidate
  // it against the current Sentry SDK and build before enabling it.
});

export default function config(phase: string) {
  applyDevOrigin(phase);
  return sentryConfig;
}
