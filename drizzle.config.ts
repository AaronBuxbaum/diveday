import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The migration barrel keeps staged physical storage until its drop release.
  schema: ["./src/db/migration-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: "./.pglite",
  },
});
