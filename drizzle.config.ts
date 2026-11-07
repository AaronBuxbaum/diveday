import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The runtime schema is the source for generated SQL.
  schema: ["./src/db/schema/index.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",
  dbCredentials: {
    url: "./.pglite",
  },
});
