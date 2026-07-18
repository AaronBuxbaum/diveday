import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // Parallel branches must not race to claim the same sequential migration
  // number. Existing numeric migrations remain valid; new ones use time.
  migrations: {
    prefix: "timestamp",
  },
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: "./.pglite",
  },
});
