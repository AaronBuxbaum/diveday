import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM assets that must load from node_modules at runtime,
  // not be inlined into the server bundle (ADR-0005).
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
