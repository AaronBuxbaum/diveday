import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The migration barrel mirrors the runtime schema used for generated SQL.
  schema: ["./src/db/migration-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: "./.pglite",
  },
});
