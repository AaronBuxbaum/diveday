import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // One module per domain under src/db/schema/; index.ts re-exports them all.
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: "./.pglite",
  },
});
