import { defineConfig } from "drizzle-kit";

// Applies committed migrations from drizzle/ to the real Neon database.
// Never used for `db:generate` — that always diffs against the PGlite config
// so schema authoring stays daemon-free. Run manually after a schema change
// lands in production (see docs/architecture/decisions/20260718-vercel-neon-hosting.md).
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "drizzle.config.prod.ts requires DATABASE_URL_UNPOOLED or DATABASE_URL (Neon direct connection preferred for DDL).",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
});
