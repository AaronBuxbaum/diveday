import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

// The column defaults to 'seed', so every row that existed before it did would read as seed
// data. A diver who registered themselves was already marked by `self_registered_at`; the
// migration carries that fact into `origin`, which the roster reads (roster-facts.ts).
const dir = readdirSync("drizzle").find((name) => name.endsWith("_person-origin"));

it("backfills origin from self_registered_at in the migration that adds the column", async () => {
  expect(dir).toBeDefined();
  const statements = readFileSync(path.join("drizzle", dir as string, "migration.sql"), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  const db = new PGlite();
  await db.exec(
    `CREATE TABLE people (id int PRIMARY KEY, self_registered_at timestamptz);
     INSERT INTO people VALUES (1, now()), (2, NULL), (3, now());`,
  );
  for (const statement of statements) await db.exec(statement);

  const { rows } = await db.query<{ id: number; origin: string }>(
    "SELECT id, origin FROM people ORDER BY id",
  );
  expect(rows).toEqual([
    { id: 1, origin: "self_registration" },
    { id: 2, origin: "seed" },
    { id: 3, origin: "self_registration" },
  ]);
  await db.close();
});
