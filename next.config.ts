import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM assets that must load from node_modules at runtime,
  // not be inlined into the server bundle (ADR-0005). node-postgres (pg)
  // dynamically requires optional native/cloud drivers it doesn't use here;
  // keep it external too rather than have the bundler try to resolve them.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "sharp"],
  // TypeScript 7 is the native (Go) compiler and no longer exposes the JS
  // compiler API Next used for its in-build type check. Next drives it through
  // the TS CLI instead (tsgo), which this flag enables.
  experimental: {
    useTypeScriptCli: true,
    // Without a Neon connection string, local/CI builds use the embedded PGlite
    // fallback. Static-generation workers must not contend for that database.
    cpus: 1,
    staticGenerationMaxConcurrency: 1,
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

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
