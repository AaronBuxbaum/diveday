import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM assets that must load from node_modules at runtime,
  // not be inlined into the server bundle (ADR-0005). node-postgres (pg)
  // dynamically requires optional native/cloud drivers it doesn't use here;
  // keep it external too rather than have the bundler try to resolve them.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
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

export default nextConfig;
